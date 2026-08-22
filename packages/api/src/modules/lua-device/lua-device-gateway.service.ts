import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import type { LuaDeviceLimits } from "@buildingai/db/entities/lua-device.entity";
import {
    LuaDeviceConnection,
    LuaDeviceRun,
    LuaDeviceRunLog,
    LuaPhysicalDevice,
} from "@buildingai/db/entities/lua-device.entity";
import { In, MoreThan, Repository } from "@buildingai/db/typeorm";
import { HttpErrorFactory } from "@buildingai/errors";
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { HttpUpgradeRouter } from "@common/ws/http-upgrade-router";
import { createHash, randomUUID } from "crypto";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import type { CreateLuaDeviceRunDto } from "./lua-device.dto";
import { calculateLuaChunkCrc32, extractLuaHelloIdentities } from "./lua-device-protocol";
import { encodeWavToOpusFrames, type OpusSpeakPayload } from "./wav-to-opus";

const MAX_MESSAGE_BYTES = 80 * 1024;
const HELLO_TIMEOUT_MS = 10_000;
const CHUNK_ACK_TIMEOUT_MS = 5_000;
const MAX_CHUNK_RETRIES = 3;
const TERMINAL_STATUSES = ["succeeded", "failed", "stopped", "timed_out"] as const;

type Envelope = {
    v: 1;
    type: string;
    id: string;
    ts: string;
    reply_to?: string;
    data: Record<string, unknown>;
};

type ClientState = {
    ready: boolean;
    helloTimer: NodeJS.Timeout;
    alive: boolean;
    protocol: "lap" | "legacy";
    deviceId?: string;
    bootId?: string;
    connectionId?: string;
    macAddress?: string;
    clientId?: string;
    headerDeviceId?: string;
    headerClientId?: string;
    pending: Map<string, PendingRequest>;
};

type PendingRequest = {
    runId: string;
    type: string;
    envelope: string;
    retryCount: number;
    chunkIndex?: number;
    retryTimer?: NodeJS.Timeout;
};

type OnlineClient = { socket: WebSocket; state: ClientState };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
    return typeof value[key] === "string" ? value[key] : undefined;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
    return typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] : undefined;
}

function sha256(value: Buffer | string): string {
    return createHash("sha256").update(value).digest("hex");
}

function headerValue(request: IncomingMessage, name: string): string | undefined {
    const raw = request.headers[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function identityKey(value?: string | null): string {
    return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

@Injectable()
export class LuaDeviceGatewayService implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly logger = new Logger(LuaDeviceGatewayService.name);
    private readonly server = new WebSocketServer({
        noServer: true,
        maxPayload: MAX_MESSAGE_BYTES,
    });
    private readonly clients = new Map<string, OnlineClient>();
    private readonly states = new WeakMap<WebSocket, ClientState>();
    private readonly speakPayloads = new Map<string, OpusSpeakPayload>();
    private heartbeatTimer?: NodeJS.Timeout;

    constructor(
        private readonly upgradeRouter: HttpUpgradeRouter,
        @InjectRepository(LuaPhysicalDevice)
        private readonly deviceRepository: Repository<LuaPhysicalDevice>,
        @InjectRepository(LuaDeviceConnection)
        private readonly connectionRepository: Repository<LuaDeviceConnection>,
        @InjectRepository(LuaDeviceRun)
        private readonly runRepository: Repository<LuaDeviceRun>,
        @InjectRepository(LuaDeviceRunLog)
        private readonly logRepository: Repository<LuaDeviceRunLog>,
    ) {}

    onApplicationBootstrap(): void {
        this.upgradeRouter.register(this.websocketPath, this.handleUpgrade);
        this.server.on("connection", this.handleConnection);
        this.heartbeatTimer = setInterval(() => this.heartbeat(), 25_000);
        this.heartbeatTimer.unref();
        this.logger.log(`Device WebSocket gateway mounted at ${this.websocketPath}`);
    }

    async onApplicationShutdown(): Promise<void> {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        for (const client of this.clients.values()) client.socket.close(1001, "server shutdown");
        this.server.close();
    }

    get websocketPath(): string {
        const prefix = (process.env.VITE_APP_WEB_API_PREFIX || "/api").replace(/\/$/, "");
        return `${prefix}/device-ws/v1`;
    }

    async listDevices() {
        const devices = await this.deviceRepository.find({
            order: { updatedAt: "DESC" },
        });
        return devices.map((device) => this.serializeDevice(device));
    }

    async listAllDevices() {
        return this.listDevices();
    }

    async listRuns(userId: string, deviceId: string) {
        const device = await this.requireDevice(deviceId);
        const runs = await this.runRepository.find({
            where: { createBy: userId, deviceId: device.deviceId },
            order: { createdAt: "DESC" },
            take: 50,
        });
        return runs.map((run) => this.serializeRun(run));
    }

    async getRun(userId: string, deviceId: string, runId: string) {
        return this.serializeRun(await this.requireOwnedRun(userId, deviceId, runId));
    }

    async getRunLogs(userId: string, deviceId: string, runId: string, after: number) {
        await this.requireOwnedRun(userId, deviceId, runId);
        return this.logRepository.find({
            where: { runId, sequence: MoreThan(after) },
            order: { sequence: "ASC" },
            take: 500,
        });
    }

    async createRun(userId: string, deviceId: string, dto: CreateLuaDeviceRunDto) {
        const device = await this.requireDevice(deviceId);
        deviceId = device.deviceId;
        const source = Buffer.from(dto.source, "utf8");
        const paramsJson = JSON.stringify(dto.params);
        const params = Buffer.from(paramsJson, "utf8");
        const limits = device.limits;
        const maxSource = Math.min(65_536, limits?.maxScriptBytes ?? 65_536);
        const maxParams = Math.min(16_384, limits?.maxParamsBytes ?? 16_384);
        if (source.length > maxSource) throw HttpErrorFactory.badRequest("Lua 源码超过设备限制");
        if (params.length > maxParams) throw HttpErrorFactory.badRequest("运行参数超过设备限制");

        const requiredCapabilities = dto.requiredCapabilities ?? ["lua"];
        if (device.capabilities.length > 0) {
            const unsupported = requiredCapabilities.filter(
                (capability) => !device.capabilities.includes(capability),
            );
            if (unsupported.length > 0) {
                throw HttpErrorFactory.badRequest(`设备不支持能力：${unsupported.join(", ")}`);
            }
        }
        const timeoutMs = dto.timeoutMs ?? 10_000;
        const maxTimeout = Math.min(60_000, device.runtime?.maxRunTimeoutMs ?? 60_000);
        if (timeoutMs > maxTimeout) throw HttpErrorFactory.badRequest("运行超时超过设备限制");

        const client = this.findClient(deviceId);
        await this.replaceStaleActiveRun(deviceId, client);
        const canDispatch = Boolean(client);
        if (!canDispatch) {
            this.logger.warn(
                `Lua run queued: no live script socket for ${deviceId} (online=${[...this.clients.keys()].join(",") || "none"})`,
            );
        }
        const run = await this.runRepository.save(
            this.runRepository.create({
                deviceId,
                createBy: userId,
                moduleId: dto.moduleId,
                projectId: dto.projectId,
                name: dto.name.trim(),
                source: dto.source,
                sourceSha256: sha256(source),
                params: dto.params,
                paramsJson,
                paramsSha256: sha256(params),
                requiredCapabilities,
                status: canDispatch ? "preparing" : "queued",
                timeoutMs,
                chunkBytes: Math.min(1024, limits?.maxChunkBytes ?? 1024),
                nextChunkIndex: 0,
            }),
        );
        if (canDispatch) await this.sendPrepare(run);
        return this.serializeRun(run);
    }

    async speak(
        userId: string,
        deviceId: string,
        opts: {
            audio: Buffer;
            volume?: number;
            wait?: boolean;
            durationMs?: number;
            projectId?: string;
            name?: string;
        },
    ) {
        const device = await this.requireDevice(deviceId);
        deviceId = device.deviceId;
        if (opts.audio.length < 44) throw HttpErrorFactory.badRequest("音频数据无效");
        if (opts.audio.length > 512 * 1024) throw HttpErrorFactory.badRequest("音频超过 512KiB");

        let encoded: OpusSpeakPayload;
        try {
            encoded = encodeWavToOpusFrames(opts.audio, opts.volume ?? 80);
        } catch (error) {
            const message = error instanceof Error ? error.message : "WAV 转 Opus 失败";
            throw HttpErrorFactory.badRequest(message);
        }

        const client = this.findClient(deviceId);
        await this.replaceStaleActiveRun(deviceId, client);
        const canDispatch = Boolean(client);
        const durationMs = encoded.durationMs || opts.durationMs || 0;
        const params = {
            kind: "speak",
            format: "opus",
            sampleRate: encoded.sampleRate,
            frameDuration: encoded.frameDurationMs,
            frameCount: encoded.frames.length,
            volume: opts.volume ?? 80,
            wait: opts.wait !== false,
            durationMs,
        };
        const paramsJson = JSON.stringify(params);
        const payloadHash = sha256(Buffer.concat(encoded.frames));
        const run = await this.runRepository.save(
            this.runRepository.create({
                deviceId,
                createBy: userId,
                projectId: opts.projectId,
                name: (opts.name ?? "speech").slice(0, 100),
                source: "",
                sourceSha256: payloadHash,
                params,
                paramsJson,
                paramsSha256: sha256(paramsJson),
                requiredCapabilities: [],
                status: canDispatch ? "running" : "queued",
                timeoutMs: Math.min(60_000, Math.max(15_000, durationMs + 10_000)),
                chunkBytes: 0,
                nextChunkIndex: 0,
            }),
        );
        this.speakPayloads.set(run.id, encoded);
        if (canDispatch) await this.sendSpeak(run);
        return this.serializeRun(run);
    }

    async stopRun(userId: string, deviceId: string, runId: string) {
        const run = await this.requireOwnedRun(userId, deviceId, runId);
        if (TERMINAL_STATUSES.includes(run.status as (typeof TERMINAL_STATUSES)[number])) {
            return this.serializeRun(run);
        }
        deviceId = run.deviceId;
        if (run.status === "queued") {
            run.status = "stopped";
            run.finishedAt = new Date();
            run.error = { code: "RUN_STOPPED", message: "任务在下发前已取消" };
            await this.runRepository.save(run);
            return this.serializeRun(run);
        }
        const client = this.findClient(deviceId);
        if (!client) {
            run.status = "stopping";
            run.error = { code: "STOP_PENDING", message: "设备离线，停止请求将在重连后发送" };
        } else if (client.state.protocol === "lap") {
            this.sendLap(client.socket, { v: 1, type: "cancel", id: run.id });
            run.status = "stopping";
        } else {
            this.send(client, "run.stop", { run_id: run.id, reason: "user_request" }, run.id);
            run.status = "stopping";
        }
        await this.runRepository.save(run);
        return this.serializeRun(run);
    }

    async waitForRun(userId: string, deviceId: string, runId: string, maxWaitMs?: number) {
        const first = await this.requireOwnedRun(userId, deviceId, runId);
        const deadline =
            Date.now() + (maxWaitMs ?? Math.min(70_000, (first.timeoutMs || 15_000) + 10_000));
        let run = first;
        while (Date.now() < deadline) {
            if (TERMINAL_STATUSES.includes(run.status as (typeof TERMINAL_STATUSES)[number])) {
                return this.serializeRun(run);
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 250));
            run = await this.requireOwnedRun(userId, run.deviceId, runId);
        }
        throw HttpErrorFactory.badRequest("等待 CubeCat 执行结果超时");
    }

    private readonly handleUpgrade = (
        request: IncomingMessage,
        socket: Duplex,
        head: Buffer,
    ): void => {
        this.server.handleUpgrade(request, socket, head, (websocket) => {
            this.server.emit("connection", websocket, request);
        });
    };

    private readonly handleConnection = (socket: WebSocket, request: IncomingMessage): void => {
        const state: ClientState = {
            ready: false,
            alive: true,
            protocol: "legacy",
            pending: new Map(),
            headerDeviceId: headerValue(request, "device-id"),
            headerClientId: headerValue(request, "client-id"),
            helloTimer: setTimeout(
                () => socket.close(4401, "hello timeout"),
                HELLO_TIMEOUT_MS,
            ),
        };
        state.helloTimer.unref();
        this.states.set(socket, state);
        socket.on("pong", () => (state.alive = true));
        socket.on("message", (data, binary) => void this.handleMessage(socket, data, binary));
        socket.on("close", (code) => void this.handleClose(socket, code));
        socket.on("error", (error) => this.logger.warn(`Device socket error: ${error.message}`));
        (state as ClientState & { remoteAddress?: string }).remoteAddress =
            request.socket.remoteAddress;
    };

    private async handleMessage(socket: WebSocket, raw: RawData, binary: boolean): Promise<void> {
        if (binary) return this.closeProtocol(socket, "binary frames are not supported");
        const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        if (bytes.length > MAX_MESSAGE_BYTES)
            return this.closeProtocol(socket, "message too large");
        let envelope: Envelope;
        try {
            const parsed: unknown = JSON.parse(bytes.toString("utf8"));
            if (
                !isRecord(parsed) ||
                parsed.v !== 1 ||
                typeof parsed.type !== "string" ||
                typeof parsed.id !== "string"
            ) {
                throw new Error("invalid envelope");
            }
            const data = isRecord(parsed.data) ? { ...parsed.data } : parsed;
            if (typeof parsed.protocol === "string" && typeof data.protocol !== "string") {
                data.protocol = parsed.protocol;
            }
            if (isRecord(parsed.device)) {
                data.device = isRecord(data.device)
                    ? { ...parsed.device, ...data.device }
                    : parsed.device;
            }
            envelope = {
                v: 1,
                type: parsed.type,
                id: parsed.id,
                ts:
                    typeof parsed.ts === "string"
                        ? parsed.ts
                        : new Date().toISOString(),
                data,
                reply_to: typeof parsed.reply_to === "string" ? parsed.reply_to : undefined,
            };
        } catch {
            return this.closeProtocol(socket, "invalid JSON envelope");
        }
        const state = this.states.get(socket);
        if (!state) return;
        if (!state.ready) {
            if (envelope.type !== "hello") return this.closeProtocol(socket, "hello required");
            await this.registerConnection(socket, state, envelope);
            return;
        }
        try {
            await this.handleDeviceMessage(socket, state, envelope);
        } catch (error) {
            this.logger.error(`Device message ${envelope.type} failed`, error);
            this.send(
                socket,
                "error",
                {
                    code: "INTERNAL_ERROR",
                    message: "message processing failed",
                    retryable: true,
                },
                undefined,
                envelope.id,
            );
        }
    }

    private async registerConnection(socket: WebSocket, state: ClientState, envelope: Envelope) {
        const data = envelope.data;
        const deviceObj = isRecord(data.device) ? data.device : {};
        const identities = extractLuaHelloIdentities({
            data,
            headerDeviceId: state.headerDeviceId,
            headerClientId: state.headerClientId,
        });
        const deviceId = identities.deviceId?.toLowerCase();
        const bootId = stringField(data, "boot_id") || randomUUID();
        const firmwareVersion = (
            stringField(data, "firmware_version") ||
            stringField(deviceObj, "firmware") ||
            "unknown"
        ).replace(/[^A-Za-z0-9.+-]/g, "-").slice(0, 32);
        const isLap =
            stringField(data, "protocol") === "lua-agent" ||
            stringField(deviceObj, "protocol") === "lua-agent";
        if (!deviceId || deviceId.length < 8 || deviceId.length > 64) {
            return socket.close(4401, "invalid hello");
        }
        state.protocol = isLap ? "lap" : "legacy";
        let device = await this.deviceRepository.findOne({ where: { deviceId } });
        if (!device) {
            device = this.deviceRepository.create({
                deviceId,
                displayName: `ESP32 ${deviceId.slice(0, 8)}`,
                capabilities: [],
            });
        }

        clearTimeout(state.helloTimer);
        state.ready = true;
        state.deviceId = deviceId;
        state.bootId = bootId;
        state.macAddress = identities.macAddress?.toLowerCase();
        state.clientId = identities.clientId?.toLowerCase();
        state.connectionId = randomUUID();
        const previous = this.findClient(deviceId);
        if (previous && previous.socket !== socket) previous.socket.close(4000, "replaced");
        this.clients.set(deviceId, { socket, state });

        device.bootId = bootId;
        device.firmwareVersion = firmwareVersion;
        device.lastSeenAt = new Date();
        const luaInfo = isRecord(deviceObj.lua) ? deviceObj.lua : {};
        const helloCaps = [
            ...(Array.isArray(data.capabilities) ? data.capabilities : []),
            ...(Array.isArray(luaInfo.capabilities) ? luaInfo.capabilities : []),
            ...(Array.isArray(luaInfo.caps) ? luaInfo.caps : []),
            "lua",
        ].filter((item): item is string => typeof item === "string");
        device.capabilities = [...new Set(helloCaps)];
        device.limits = this.parseLimits(data.limits);
        const macAddress = state.macAddress;
        const clientId = state.clientId;
        device.runtime = isRecord(data.runtime)
            ? {
                  executionModel: stringField(data.runtime, "execution_model") || "main_once",
                  apiVersion:
                      stringField(data.runtime, "api_version") ||
                      (state.protocol === "lap" ? "claw4.v1" : "xiaozhi.v1"),
                  transferStorage: stringField(data.runtime, "transfer_storage") || "ram",
                  maxRunTimeoutMs: numberField(data.runtime, "max_run_timeout_ms") || 60_000,
                  ...(macAddress ? { macAddress } : {}),
                  ...(clientId ? { clientId } : {}),
              }
            : {
                  executionModel: "main_once",
                  apiVersion: state.protocol === "lap" ? "claw4.v1" : "xiaozhi.v1",
                  transferStorage: "ram",
                  maxRunTimeoutMs: 60_000,
                  ...(macAddress ? { macAddress } : {}),
                  ...(clientId ? { clientId } : {}),
              };
        this.logger.log(
            `Lua device ${deviceId} connected protocol=${state.protocol} mac=${macAddress ?? "-"} client=${clientId ?? "-"}`,
        );
        await this.deviceRepository.save(device);
        await this.connectionRepository.save(
            this.connectionRepository.create({
                connectionId: state.connectionId,
                deviceId,
                bootId,
                remoteAddress: (state as ClientState & { remoteAddress?: string }).remoteAddress,
                connectedAt: new Date(),
            }),
        );
        if (state.protocol === "lap") {
            this.sendLap(socket, {
                v: 1,
                type: "hello_ok",
                id: envelope.id,
                session: state.connectionId,
            });
        } else {
            this.send(
                socket,
                "hello.welcome",
                {
                    connection_id: state.connectionId,
                    heartbeat_interval_ms: 20_000,
                    server_limits: {
                        max_script_bytes: 65_536,
                        max_params_bytes: 16_384,
                        max_chunk_bytes: 1_024,
                        max_message_bytes: MAX_MESSAGE_BYTES,
                    },
                },
                undefined,
                envelope.id,
            );
        }
        await this.resumePendingRun(deviceId);
    }

    private async handleDeviceMessage(
        socket: WebSocket,
        state: ClientState,
        envelope: Envelope,
    ) {
        if (!state.deviceId) return;
        state.alive = true;
        switch (envelope.type) {
            case "ping":
                this.sendLap(socket, {
                    v: 1,
                    type: "pong",
                    id: envelope.id,
                    ts_ms: Date.now(),
                });
                return;
            case "pong":
            case "hello_ok":
                return;
            case "result":
                await this.handleLapResult(state.deviceId, envelope);
                return;
            case "device.status":
                await this.deviceRepository.update(
                    { deviceId: state.deviceId },
                    { lastSeenAt: new Date() },
                );
                return;
            case "run.ready":
                this.clearPending(state, envelope.reply_to);
                await this.handleRunReady(state.deviceId, envelope);
                return;
            case "run.chunk.ack":
                this.clearPending(state, envelope.reply_to);
                await this.handleChunkAck(state.deviceId, envelope);
                return;
            case "run.accepted":
                this.clearPending(state, envelope.reply_to);
                await this.handleRunAccepted(state.deviceId, envelope);
                return;
            case "run.stopping":
                this.clearPending(state, envelope.reply_to);
                await this.updateRunStatus(state.deviceId, envelope, "stopping");
                return;
            case "run.log":
                await this.handleRunLog(state.deviceId, envelope);
                return;
            case "run.finished":
                await this.handleRunFinished(socket, state.deviceId, envelope);
                return;
            case "error":
                await this.handleDeviceError(state, envelope);
                this.clearPending(state, envelope.reply_to);
                return;
            default:
                this.send(
                    socket,
                    "error",
                    {
                        code: "UNSUPPORTED_MESSAGE",
                        message: `unsupported message type: ${envelope.type}`,
                        retryable: false,
                    },
                    undefined,
                    envelope.id,
                );
        }
    }

    private async handleRunReady(deviceId: string, envelope: Envelope) {
        const run = await this.findDeviceRun(deviceId, stringField(envelope.data, "run_id"));
        if (!run) return;
        const next = numberField(envelope.data, "next_chunk_index");
        const total = Math.ceil(Buffer.byteLength(run.source, "utf8") / run.chunkBytes);
        if (!Number.isInteger(next) || next! < 0 || next! > total) return;
        run.nextChunkIndex = next!;
        run.status = "transferring";
        await this.runRepository.save(run);
        await this.sendNextChunk(run);
    }

    private async handleChunkAck(deviceId: string, envelope: Envelope) {
        const run = await this.findDeviceRun(deviceId, stringField(envelope.data, "run_id"));
        if (!run) return;
        const next = numberField(envelope.data, "next_chunk_index");
        if (!Number.isInteger(next) || next! < run.nextChunkIndex) return;
        run.nextChunkIndex = next!;
        await this.runRepository.save(run);
        await this.sendNextChunk(run);
    }

    private async handleRunAccepted(deviceId: string, envelope: Envelope) {
        const run = await this.findDeviceRun(deviceId, stringField(envelope.data, "run_id"));
        if (!run || TERMINAL_STATUSES.includes(run.status as never)) return;
        run.status = "running";
        run.startedAt ??= new Date();
        run.error = null;
        await this.runRepository.save(run);
    }

    private async updateRunStatus(
        deviceId: string,
        envelope: Envelope,
        status: LuaDeviceRun["status"],
    ) {
        const run = await this.findDeviceRun(deviceId, stringField(envelope.data, "run_id"));
        if (!run || TERMINAL_STATUSES.includes(run.status as never)) return;
        run.status = status;
        await this.runRepository.save(run);
    }

    private async handleRunLog(deviceId: string, envelope: Envelope) {
        const run = await this.findDeviceRun(deviceId, stringField(envelope.data, "run_id"));
        const sequence = numberField(envelope.data, "sequence");
        const level = stringField(envelope.data, "level");
        const text = stringField(envelope.data, "text");
        if (!run || !Number.isInteger(sequence) || sequence! < 1 || !level || !text) return;
        try {
            await this.logRepository.save(
                this.logRepository.create({
                    runId: run.id,
                    sequence: sequence!,
                    level: level.slice(0, 8),
                    text: text.slice(0, 1024),
                }),
            );
        } catch (error) {
            if ((error as { code?: string }).code !== "23505") throw error;
        }
    }

    private async handleRunFinished(socket: WebSocket, deviceId: string, envelope: Envelope) {
        const run = await this.findDeviceRun(deviceId, stringField(envelope.data, "run_id"));
        if (!run) return;
        const status = stringField(envelope.data, "status");
        if (!TERMINAL_STATUSES.includes(status as (typeof TERMINAL_STATUSES)[number])) return;
        if (!TERMINAL_STATUSES.includes(run.status as never)) {
            run.status = status as LuaDeviceRun["status"];
            run.result = envelope.data.result;
            run.error = isRecord(envelope.data.error)
                ? {
                      code: stringField(envelope.data.error, "code") || "LUA_RUNTIME_ERROR",
                      message: stringField(envelope.data.error, "message") || "Lua 运行失败",
                      line: numberField(envelope.data.error, "line"),
                  }
                : null;
            run.finishedAt = new Date();
            await this.runRepository.save(run);
        }
        this.send(socket, "run.finished.ack", { run_id: run.id }, undefined, envelope.id);
        await this.resumePendingRun(deviceId);
    }

    private async handleDeviceError(state: ClientState, envelope: Envelope) {
        if (!envelope.reply_to) return;
        const pending = state.pending.get(envelope.reply_to);
        if (!pending) return;
        const run = await this.findDeviceRun(state.deviceId!, pending.runId);
        if (!run || TERMINAL_STATUSES.includes(run.status as never)) return;
        const retryable = envelope.data.retryable === true;
        run.status = retryable ? "waiting_for_device" : "failed";
        run.error = {
            code: stringField(envelope.data, "code") || "DEVICE_ERROR",
            message: stringField(envelope.data, "message") || "设备拒绝任务",
        };
        if (!retryable) run.finishedAt = new Date();
        await this.runRepository.save(run);
    }

    private isSpeakRun(run: LuaDeviceRun): boolean {
        if (isRecord(run.params) && run.params.kind === "speak") return true;
        return run.name === "speech" && !run.source;
    }

    private async sendSpeak(run: LuaDeviceRun) {
        const client = this.findClient(run.deviceId);
        const audio = this.speakPayloads.get(run.id);
        if (!audio) {
            run.status = "failed";
            run.error = { code: "AUDIO_MISSING", message: "播报音频已丢失，请重新运行节点" };
            run.finishedAt = new Date();
            await this.runRepository.save(run);
            return;
        }
        if (!client) {
            this.logger.warn(`speak ${run.id} not dispatched: ${run.deviceId} is offline`);
            return;
        }
        if (client.state.protocol !== "lap") {
            run.status = "failed";
            run.error = { code: "UNSUPPORTED", message: "当前设备协议不支持直接播报" };
            run.finishedAt = new Date();
            await this.runRepository.save(run);
            this.speakPayloads.delete(run.id);
            return;
        }
        const params = isRecord(run.params) ? run.params : {};
        const sent = this.sendLap(client.socket, {
            v: 1,
            type: "speak",
            id: run.id,
            format: "opus",
            sample_rate: audio.sampleRate,
            frame_duration: audio.frameDurationMs,
            frame_count: audio.frames.length,
            volume: numberField(params, "volume") ?? 80,
            wait: params.wait !== false,
            duration_ms: numberField(params, "durationMs") ?? audio.durationMs,
        });
        if (!sent) {
            run.status = "waiting_for_device";
            run.error = { code: "SOCKET_CLOSED", message: "脚本通道已断开，等待重连" };
            await this.runRepository.save(run);
            return;
        }
        for (const frame of audio.frames) {
            if (client.socket.readyState !== WebSocket.OPEN) break;
            client.socket.send(frame, { binary: true });
        }
        run.status = "running";
        run.startedAt ??= new Date();
        run.error = null;
        await this.runRepository.save(run);
        this.logger.log(
            `speak ${run.id} dispatched to ${run.deviceId} opus frames=${audio.frames.length} durationMs=${audio.durationMs}`,
        );
    }

    private async sendPrepare(run: LuaDeviceRun) {
        if (this.isSpeakRun(run)) {
            await this.sendSpeak(run);
            return;
        }
        const client = this.findClient(run.deviceId);
        if (!client) {
            this.logger.warn(`Lua run ${run.id} not dispatched: ${run.deviceId} is offline`);
            return;
        }
        if (client.state.protocol === "lap") {
            const sent = this.sendLap(client.socket, {
                v: 1,
                type: "run",
                id: run.id,
                script: run.source,
                entry: "main",
                args: run.params,
                timeout_ms: run.timeoutMs,
                capabilities: this.toLapCapabilities(run.requiredCapabilities),
            });
            if (!sent) {
                run.status = "waiting_for_device";
                run.error = { code: "SOCKET_CLOSED", message: "脚本通道已断开，等待重连" };
                await this.runRepository.save(run);
                return;
            }
            run.status = "running";
            run.startedAt ??= new Date();
            run.error = null;
            await this.runRepository.save(run);
            this.logger.log(
                `Lua run ${run.id} dispatched to ${run.deviceId} bytes=${Buffer.byteLength(run.source, "utf8")} timeoutMs=${run.timeoutMs}`,
            );
            return;
        }
        const sourceLength = Buffer.byteLength(run.source, "utf8");
        const totalChunks = Math.ceil(sourceLength / run.chunkBytes);
        this.send(
            client,
            "run.prepare",
            {
                run_id: run.id,
                script: {
                    name: run.name,
                    encoding: "utf-8/base64-chunks",
                    byte_length: sourceLength,
                    sha256: run.sourceSha256,
                    chunk_bytes: run.chunkBytes,
                    total_chunks: totalChunks,
                },
                params: run.params,
                params_sha256: run.paramsSha256,
                required_capabilities: run.requiredCapabilities,
                entry: "main",
                timeout_ms: run.timeoutMs,
                run_mode: "replace",
            },
            run.id,
        );
        run.status = "preparing";
        await this.runRepository.save(run);
    }

    private async sendNextChunk(run: LuaDeviceRun) {
        const client = this.findClient(run.deviceId);
        if (!client) return;
        const source = Buffer.from(run.source, "utf8");
        const totalChunks = Math.ceil(source.length / run.chunkBytes);
        if (run.nextChunkIndex >= totalChunks) {
            this.send(
                client,
                "run.commit",
                { run_id: run.id, byte_length: source.length, sha256: run.sourceSha256 },
                run.id,
            );
            return;
        }
        const offset = run.nextChunkIndex * run.chunkBytes;
        const chunk = source.subarray(offset, Math.min(offset + run.chunkBytes, source.length));
        this.send(
            client,
            "run.chunk",
            {
                run_id: run.id,
                index: run.nextChunkIndex,
                total_chunks: totalChunks,
                offset,
                data_b64: chunk.toString("base64"),
                crc32: calculateLuaChunkCrc32(chunk),
            },
            run.id,
        );
    }

    private async resumePendingRun(deviceId: string) {
        const run = await this.runRepository.findOne({
            where: {
                deviceId,
                status: In([
                    "queued",
                    "preparing",
                    "transferring",
                    "waiting_for_device",
                    "stopping",
                ]),
            },
            order: { createdAt: "ASC" },
        });
        if (!run) return;
        if (run.status === "stopping") {
            const client = this.findClient(deviceId);
            if (client?.state.protocol === "lap") {
                this.sendLap(client.socket, { v: 1, type: "cancel", id: run.id });
            } else if (client) {
                this.send(client, "run.stop", { run_id: run.id, reason: "user_request" }, run.id);
            }
            return;
        }
        await this.sendPrepare(run);
    }

    private async handleClose(socket: WebSocket, code: number) {
        const state = this.states.get(socket);
        if (!state) return;
        clearTimeout(state.helloTimer);
        if (state.deviceId && this.clients.get(state.deviceId)?.socket === socket) {
            this.clients.delete(state.deviceId);
            await this.runRepository.update(
                { deviceId: state.deviceId, status: In(["preparing", "transferring", "running"]) },
                { status: "waiting_for_device" },
            );
        }
        for (const pending of state.pending.values()) {
            if (pending.retryTimer) clearTimeout(pending.retryTimer);
        }
        state.pending.clear();
        if (state.connectionId) {
            await this.connectionRepository.update(
                { connectionId: state.connectionId },
                { disconnectedAt: new Date(), closeCode: code },
            );
        }
    }

    private heartbeat() {
        for (const [deviceId, client] of this.clients) {
            if (!client.state.alive) {
                client.socket.terminate();
                this.clients.delete(deviceId);
                continue;
            }
            client.state.alive = false;
            client.socket.ping();
        }
    }

    private send(
        target: WebSocket | OnlineClient,
        type: string,
        data: Record<string, unknown>,
        runId?: string,
        replyTo?: string,
    ): string {
        const socket = target instanceof WebSocket ? target : target.socket;
        const id = randomUUID();
        const envelope: Envelope = { v: 1, type, id, ts: new Date().toISOString(), data };
        if (replyTo) envelope.reply_to = replyTo;
        const serialized = JSON.stringify(envelope);
        if (runId) {
            const state = this.states.get(socket);
            if (state) {
                const pending: PendingRequest = {
                    runId,
                    type,
                    envelope: serialized,
                    retryCount: 0,
                    chunkIndex: type === "run.chunk" ? numberField(data, "index") : undefined,
                };
                state.pending.set(id, pending);
                if (type === "run.chunk") this.armChunkRetry(socket, id, pending);
            }
            if (state && state.pending.size > 100) {
                const oldest = state.pending.keys().next().value;
                if (oldest) this.clearPending(state, oldest);
            }
        }
        if (socket.readyState === WebSocket.OPEN) socket.send(serialized);
        return id;
    }

    private clearPending(state: ClientState, id?: string) {
        if (!id) return;
        const pending = state.pending.get(id);
        if (!pending) return;
        if (pending.retryTimer) clearTimeout(pending.retryTimer);
        state.pending.delete(id);
    }

    private armChunkRetry(socket: WebSocket, messageId: string, pending: PendingRequest) {
        pending.retryTimer = setTimeout(() => {
            const state = this.states.get(socket);
            const current = state?.pending.get(messageId);
            if (!state || current !== pending || socket.readyState !== WebSocket.OPEN) return;
            if (pending.retryCount >= MAX_CHUNK_RETRIES) {
                this.clearPending(state, messageId);
                void this.markChunkDeliveryWaiting(socket, pending);
                return;
            }
            pending.retryCount += 1;
            socket.send(pending.envelope);
            this.armChunkRetry(socket, messageId, pending);
        }, CHUNK_ACK_TIMEOUT_MS);
        pending.retryTimer.unref();
    }

    private async markChunkDeliveryWaiting(socket: WebSocket, pending: PendingRequest) {
        const state = this.states.get(socket);
        if (!state?.deviceId) return;
        const run = await this.findDeviceRun(state.deviceId, pending.runId);
        if (
            !run ||
            !["preparing", "transferring"].includes(run.status) ||
            (pending.chunkIndex !== undefined && run.nextChunkIndex !== pending.chunkIndex)
        ) {
            return;
        }
        run.status = "waiting_for_device";
        run.error = { code: "CHUNK_ACK_TIMEOUT", message: "设备未确认源码分片" };
        await this.runRepository.save(run);
        socket.terminate();
    }

    private closeProtocol(socket: WebSocket, message: string) {
        this.send(socket, "error", { code: "INVALID_MESSAGE", message, retryable: false });
        socket.close(4400, message.slice(0, 120));
    }

    private async findDeviceRun(deviceId: string, runId?: string) {
        if (!runId) return null;
        const run = await this.runRepository.findOne({ where: { id: runId } });
        if (!run) return null;
        if (run.deviceId === deviceId) return run;
        const caller = this.findClient(deviceId);
        const owner = this.findClient(run.deviceId);
        if (caller && owner && caller.socket === owner.socket) return run;
        return null;
    }

    private async requireDevice(deviceId: string) {
        const normalized = deviceId.toLowerCase();
        let device = await this.deviceRepository.findOne({
            where: { deviceId: normalized },
        });
        if (!device) {
            const client = this.findClient(normalized);
            if (client?.state.deviceId) {
                device = await this.deviceRepository.findOne({
                    where: { deviceId: client.state.deviceId },
                });
            }
        }
        if (!device) throw HttpErrorFactory.notFound("物理设备不存在");
        return device;
    }

    private async requireOwnedRun(userId: string, deviceId: string, runId: string) {
        const run = await this.runRepository.findOne({
            where: { id: runId, createBy: userId },
        });
        if (!run) throw HttpErrorFactory.notFound("Lua 运行任务不存在");
        if (run.deviceId === deviceId.toLowerCase()) return run;
        if (identityKey(run.deviceId) === identityKey(deviceId)) return run;
        const caller = this.findClient(deviceId);
        const owner = this.findClient(run.deviceId);
        if (caller && owner && caller.socket === owner.socket) return run;
        throw HttpErrorFactory.notFound("Lua 运行任务不存在");
    }

    private async handleLapResult(deviceId: string, envelope: Envelope) {
        const run = await this.findDeviceRun(deviceId, envelope.id);
        if (!run) return;
        const payload = envelope.data;
        const statusName = stringField(payload, "status");
        const ok = payload.ok === true || statusName === "done";
        let status: LuaDeviceRun["status"] = "failed";
        if (ok) status = "succeeded";
        else if (statusName === "timeout") status = "timed_out";
        else if (statusName === "cancelled") status = "stopped";
        if (!TERMINAL_STATUSES.includes(run.status as never)) {
            run.status = status;
            run.result = payload.value ?? null;
            const errorObj = isRecord(payload.error) ? payload.error : null;
            run.error =
                !ok && errorObj
                    ? {
                          code: stringField(errorObj, "code") || "LUA_RUNTIME_ERROR",
                          message: stringField(errorObj, "message") || "Lua 运行失败",
                      }
                    : !ok
                      ? {
                            code: statusName || "LUA_RUNTIME_ERROR",
                            message: stringField(payload, "output") || "Lua 运行失败",
                        }
                      : null;
            run.finishedAt = new Date();
            await this.runRepository.save(run);
        }
        this.speakPayloads.delete(run.id);
        await this.resumePendingRun(deviceId);
    }

    private findClient(deviceId: string): OnlineClient | undefined {
        const direct = this.clients.get(deviceId);
        if (direct) return direct;
        const wanted = new Set(
            [deviceId, ...deviceId.split(/[:\s]/)].map(identityKey).filter((key) => key.length >= 8),
        );
        if (!wanted.size) return undefined;
        for (const client of this.clients.values()) {
            const keys = [
                client.state.deviceId,
                client.state.macAddress,
                client.state.clientId,
                client.state.headerDeviceId,
                client.state.headerClientId,
            ]
                .map(identityKey)
                .filter((key) => key.length >= 8);
            if (keys.some((key) => wanted.has(key))) return client;
        }
        return undefined;
    }

    private async replaceStaleActiveRun(deviceId: string, client?: OnlineClient) {
        const activeRun = await this.runRepository.findOne({
            where: {
                deviceId,
                status: In([
                    "preparing",
                    "transferring",
                    "running",
                    "stopping",
                    "waiting_for_device",
                ]),
            },
            order: { createdAt: "ASC" },
        });
        if (!activeRun) return;
        if (!client) return;
        this.logger.warn(
            `Replacing stale Lua run ${activeRun.id} status=${activeRun.status} on ${deviceId}`,
        );
        if (client.state.protocol === "lap") {
            this.sendLap(client.socket, { v: 1, type: "cancel", id: activeRun.id });
        } else {
            this.send(client, "run.stop", { run_id: activeRun.id, reason: "replaced" }, activeRun.id);
        }
        activeRun.status = "failed";
        activeRun.error = { code: "REPLACED", message: "被新的脚本任务替换" };
        activeRun.finishedAt = new Date();
        await this.runRepository.save(activeRun);
    }

    private sendLap(socket: WebSocket, payload: Record<string, unknown>): boolean {
        if (socket.readyState !== WebSocket.OPEN) {
            this.logger.warn(
                `LAP ${String(payload.type)} dropped readyState=${socket.readyState}`,
            );
            return false;
        }
        socket.send(JSON.stringify(payload));
        return true;
    }

    private toLapCapabilities(required: string[] | null | undefined): string[] {
        const caps = new Set<string>(["log", "http"]);
        for (const cap of required ?? []) {
            if (
                cap === "camera" ||
                cap === "uart" ||
                cap === "http" ||
                cap === "log" ||
                cap === "tts"
            ) {
                caps.add(cap);
            }
        }
        return [...caps];
    }

    private serializeDevice(device: LuaPhysicalDevice) {
        const live = this.findClient(device.deviceId)?.state;
        const macAddress = live?.macAddress || device.runtime?.macAddress;
        const clientId = live?.clientId || device.runtime?.clientId;
        return {
            id: device.id,
            deviceId: device.deviceId,
            displayName: device.displayName,
            online: Boolean(live),
            macAddress,
            clientId,
            firmwareVersion: device.firmwareVersion,
            bootId: device.bootId,
            capabilities: device.capabilities,
            limits: device.limits,
            runtime: device.runtime,
            lastSeenAt: device.lastSeenAt,
            createdAt: device.createdAt,
            updatedAt: device.updatedAt,
        };
    }

    private serializeRun(run: LuaDeviceRun) {
        const { source: _source, paramsJson: _paramsJson, ...safe } = run;
        return safe;
    }

    private parseLimits(value: unknown): LuaDeviceLimits | null {
        if (!isRecord(value)) return null;
        return {
            maxScriptBytes: numberField(value, "max_script_bytes") || 65_536,
            maxParamsBytes: numberField(value, "max_params_bytes") || 4_096,
            maxChunkBytes: numberField(value, "max_chunk_bytes") || 1_024,
            maxMessageBytes: numberField(value, "max_message_bytes") || MAX_MESSAGE_BYTES,
            maxLogBytes: numberField(value, "max_log_bytes") || 1_024,
        };
    }

}

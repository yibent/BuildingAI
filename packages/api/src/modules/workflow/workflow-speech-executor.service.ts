import { getProviderForSpeech } from "@buildingai/ai-sdk";
import { SecretService } from "@buildingai/core/modules";
import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import { AiModel } from "@buildingai/db/entities";
import { Repository } from "@buildingai/db/typeorm";
import { HttpErrorFactory } from "@buildingai/errors";
import { getProviderSecret } from "@buildingai/utils";
import type { SpeechExecutorInput } from "@flowgram.ai/runtime-js";
import { Injectable } from "@nestjs/common";
import { experimental_generateSpeech as generateSpeech } from "ai";

import { LuaDeviceGatewayService } from "../lua-device/lua-device-gateway.service";
import { WorkflowRuntimeDeviceService } from "./workflow-runtime-device.service";

function asText(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === undefined || value === null) return "";
    return String(value);
}

function asNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
        return Number(value);
    }
    return undefined;
}

@Injectable()
export class WorkflowSpeechExecutorService {
    constructor(
        private readonly luaDeviceGatewayService: LuaDeviceGatewayService,
        private readonly runtimeDeviceService: WorkflowRuntimeDeviceService,
        private readonly secretService: SecretService,
        @InjectRepository(AiModel)
        private readonly aiModelRepository: Repository<AiModel>,
    ) {}

    async execute(input: SpeechExecutorInput): Promise<Record<string, unknown>> {
        if (!input.userId) throw HttpErrorFactory.unauthorized("语音播报节点需要登录后执行");
        if (
            input.runtimeContext?.runtimeTarget &&
            input.runtimeContext.runtimeTarget !== "device"
        ) {
            throw HttpErrorFactory.badRequest("语音播报节点需要在工程设置中把运行目标设为 CubeCat 设备");
        }
        const deviceId = await this.runtimeDeviceService.resolveLuaDeviceId(
            input.userId,
            input.runtimeContext,
        );

        const text =
            asText(input.inputs.content).trim() ||
            asText(input.inputs.text).trim() ||
            asText(input.node.data?.text).trim();
        if (!text) throw HttpErrorFactory.badRequest("请填写播报内容");

        const voice = asText(input.node.data?.voice).trim() || "Cherry";
        const speed = asNumber(input.node.data?.speed) ?? 1;
        const volume01 = asNumber(input.node.data?.volume);
        const volume = Math.max(0, Math.min(100, Math.round((volume01 ?? 1) * 100)));
        const waitForComplete = input.node.data?.waitForComplete !== false;
        const modelId = asText(input.node.data?.modelId).trim();

        // TTS is synthesized here and played with LAP `speak` + Opus frames.
        // Do not send Lua (`require("speech")` no longer exists on CubeCat).
        const { audio, durationMs } = await this.synthesize(text, modelId, voice, speed);
        const run = await this.luaDeviceGatewayService.speak(input.userId, deviceId, {
            audio,
            volume,
            wait: waitForComplete,
            durationMs,
            projectId: input.runtimeContext?.projectId,
            name: "speech",
        });
        const completed = await this.luaDeviceGatewayService.waitForRun(
            input.userId,
            deviceId,
            run.id,
            70_000,
        );
        if (completed.status !== "succeeded") {
            throw HttpErrorFactory.badRequest(completed.error?.message ?? "设备播报失败");
        }
        const result = completed.result;
        if (result && typeof result === "object" && !Array.isArray(result)) {
            return result as Record<string, unknown>;
        }
        return { success: true, durationMs };
    }

    private async synthesize(
        text: string,
        modelId: string,
        voice: string,
        speed: number,
    ): Promise<{ audio: Buffer; durationMs: number }> {
        const model = await this.resolveTtsModel(modelId);
        if (!model.provider.bindSecretId) {
            throw HttpErrorFactory.badRequest("TTS 供应商尚未配置密钥");
        }
        const secret = await this.secretService.getConfigKeyValuePairs(model.provider.bindSecretId);
        const providerId =
            model.provider.provider === "qwen" ? "tongyi" : model.provider.provider;
        const getSpeech = getProviderForSpeech(providerId, {
            apiKey: getProviderSecret("apiKey", secret),
            baseURL: getProviderSecret("baseUrl", secret) || undefined,
        });
        const { model: speechModel } = getSpeech(model.model);
        const result = await generateSpeech({
            model: speechModel,
            text,
            voice,
            speed,
            outputFormat: "wav",
        });
        const audio = result.audio as { uint8Array?: Uint8Array; format?: string };
        const bytes = audio.uint8Array;
        if (!bytes?.length) throw HttpErrorFactory.internal("通义 TTS 没有返回音频");
        return {
            audio: Buffer.from(bytes),
            durationMs: wavDurationMs(bytes) || Math.max(800, text.length * 80),
        };
    }

    private async resolveTtsModel(modelId: string) {
        if (modelId) {
            const selected = await this.aiModelRepository.findOne({
                where: { id: modelId, isActive: true },
                relations: ["provider"],
            });
            if (!selected?.provider?.isActive) {
                throw HttpErrorFactory.badRequest("选择的 TTS 模型不存在或未启用");
            }
            return selected;
        }
        const models = await this.aiModelRepository.find({
            where: { isActive: true, modelType: "tts" },
            relations: ["provider"],
            order: { createdAt: "DESC" },
        });
        const tongyi = models.find(
            (item) =>
                item.provider?.isActive &&
                (item.provider.provider === "tongyi" ||
                    item.model.toLowerCase().includes("qwen")),
        );
        const fallback = models.find((item) => item.provider?.isActive);
        const model = tongyi ?? fallback;
        if (!model) {
            throw HttpErrorFactory.badRequest(
                "请先在模型供应商中启用通义千问 TTS（例如 qwen3-tts-flash）",
            );
        }
        return model;
    }
}

function wavDurationMs(bytes: Uint8Array): number {
    if (bytes.length < 44) return 0;
    const view = Buffer.from(bytes);
    if (view.toString("ascii", 0, 4) !== "RIFF" || view.toString("ascii", 8, 12) !== "WAVE") {
        return 0;
    }
    let offset = 12;
    while (offset + 8 <= view.length) {
        const id = view.toString("ascii", offset, offset + 4);
        const size = view.readUInt32LE(offset + 4);
        if (id === "fmt " && size >= 16) {
            const byteRate = view.readUInt32LE(offset + 16);
            if (byteRate > 0) return Math.round((view.length / byteRate) * 1000);
            return 0;
        }
        offset += 8 + size + (size % 2);
    }
    return 0;
}

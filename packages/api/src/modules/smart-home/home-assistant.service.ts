import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import {
    HomeAssistantAuthMode,
    HomeAssistantDevice,
    HomeAssistantInstance,
    HomeAssistantInstanceStatus,
    type HomeAssistantLightState,
} from "@buildingai/db/entities";
import { Repository } from "@buildingai/db/typeorm";
import { HttpErrorFactory } from "@buildingai/errors";
import { Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import {
    HomeAssistantCloudClient,
    normalizeHomeAssistantBaseUrl,
    type HomeAssistantTokenSet,
} from "./home-assistant.cloud";
import {
    HOME_ASSISTANT_SYNC_DOMAINS,
    HOME_ASSISTANT_TOKEN_REFRESH_MARGIN_MS,
    homeAssistantCategoryLabel,
} from "./home-assistant.constants";
import type {
    HomeAssistantLightCommandDto,
    QueryHomeAssistantDevicesDto,
    UpsertHomeAssistantInstanceDto,
} from "./home-assistant.dto";
import { buildLightServiceCall, normalizeLightState } from "./home-assistant.light";

export type PublicHomeAssistantInstance = {
    id: string;
    label: string;
    baseUrl: string;
    authMode: "token" | "password";
    username: string | null;
    haVersion: string | null;
    locationName: string | null;
    status: string;
    deviceCount: number;
    lastSyncAt: string | null;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
};

export type PublicHomeAssistantDevice = {
    id: string;
    instanceId: string;
    provider: "homeassistant";
    entityId: string;
    uniqueId: string | null;
    name: string;
    domain: string;
    category: string;
    categoryLabel: string;
    areaId: string | null;
    areaName: string | null;
    online: boolean;
    state: HomeAssistantLightState;
    attributes: Record<string, unknown>;
    lastStateAt: string | null;
    createdAt: string;
    updatedAt: string;
};

@Injectable()
export class HomeAssistantService {
    private readonly encryptionKey = createHash("sha256")
        .update(
            process.env.HOME_ASSISTANT_ENCRYPTION_KEY ||
                process.env.JWT_SECRET ||
                "BuildingAI-home-assistant-development-key",
        )
        .digest();

    constructor(
        @InjectRepository(HomeAssistantInstance)
        private readonly instanceRepository: Repository<HomeAssistantInstance>,
        @InjectRepository(HomeAssistantDevice)
        private readonly deviceRepository: Repository<HomeAssistantDevice>,
    ) {}

    async getInstance(userId: string): Promise<PublicHomeAssistantInstance | null> {
        const instance = await this.instanceRepository.findOne({ where: { ownerUserId: userId } });
        if (!instance) return null;
        const deviceCount = await this.deviceRepository.count({ where: { instanceId: instance.id } });
        return this.toPublicInstance(instance, deviceCount);
    }

    async upsertInstance(
        userId: string,
        dto: UpsertHomeAssistantInstanceDto,
    ): Promise<PublicHomeAssistantInstance> {
        const baseUrl = normalizeHomeAssistantBaseUrl(dto.baseUrl);
        const authMode = dto.authMode || "token";
        const existing = await this.instanceRepository.findOne({ where: { ownerUserId: userId } });
        const tokens = await this.issueTokens(baseUrl, authMode, dto, existing);
        const client = new HomeAssistantCloudClient(baseUrl, tokens.accessToken);
        let config: { location_name?: string; version?: string };
        try {
            config = await client.ping();
        } catch (error) {
            throw HttpErrorFactory.badRequest(this.errorMessage(error, "无法连接到 Home Assistant"));
        }

        let instance = existing;
        if (!instance) {
            instance = this.instanceRepository.create({ ownerUserId: userId });
        }
        instance.label = dto.label?.trim() || instance.label || "Home Assistant";
        instance.baseUrl = baseUrl;
        instance.authMode = authMode;
        instance.username = authMode === "password" ? dto.username?.trim() || null : null;
        instance.accessTokenEncrypted = this.encrypt(tokens.accessToken);
        instance.refreshTokenEncrypted = tokens.refreshToken ? this.encrypt(tokens.refreshToken) : null;
        instance.accessTokenExpiresAt = tokens.expiresAt || null;
        instance.haVersion = config.version || null;
        instance.locationName = config.location_name || null;
        instance.status = HomeAssistantInstanceStatus.ACTIVE;
        instance.lastError = null;
        instance = await this.instanceRepository.save(instance);
        await this.syncInstance(instance);
        const saved = await this.requireInstance(userId);
        const deviceCount = await this.deviceRepository.count({ where: { instanceId: saved.id } });
        return this.toPublicInstance(saved, deviceCount);
    }

    async updateInstance(userId: string, label: string): Promise<PublicHomeAssistantInstance> {
        const instance = await this.requireInstance(userId);
        instance.label = label.trim() || instance.label;
        await this.instanceRepository.save(instance);
        const deviceCount = await this.deviceRepository.count({ where: { instanceId: instance.id } });
        return this.toPublicInstance(instance, deviceCount);
    }

    async removeInstance(userId: string): Promise<void> {
        const instance = await this.requireInstance(userId);
        await this.deviceRepository.delete({ instanceId: instance.id });
        await this.instanceRepository.delete({ id: instance.id });
    }

    async sync(userId: string): Promise<PublicHomeAssistantInstance> {
        const instance = await this.requireInstance(userId);
        await this.syncInstance(instance);
        const saved = await this.requireInstance(userId);
        const deviceCount = await this.deviceRepository.count({ where: { instanceId: saved.id } });
        return this.toPublicInstance(saved, deviceCount);
    }

    async listDevices(
        userId: string,
        filters: QueryHomeAssistantDevicesDto = {},
    ): Promise<PublicHomeAssistantDevice[]> {
        const instance = await this.instanceRepository.findOne({ where: { ownerUserId: userId } });
        if (!instance) return [];
        let devices = await this.deviceRepository.find({
            where: { instanceId: instance.id },
            order: { category: "ASC", areaName: "ASC", name: "ASC" },
        });
        if (filters.category) {
            devices = devices.filter((device) => device.category === filters.category);
        }
        if (filters.areaId) {
            devices = devices.filter((device) => (device.areaId || "unassigned") === filters.areaId);
        }
        const keyword = filters.keyword?.trim().toLowerCase();
        if (keyword) {
            devices = devices.filter((device) =>
                [device.name, device.entityId, device.areaName]
                    .filter(Boolean)
                    .some((value) => String(value).toLowerCase().includes(keyword)),
            );
        }
        return devices.map((device) => this.toPublicDevice(device));
    }

    async getDevice(userId: string, deviceId: string): Promise<PublicHomeAssistantDevice> {
        return this.toPublicDevice(await this.requireDevice(userId, deviceId));
    }

    async refreshDevice(userId: string, deviceId: string): Promise<PublicHomeAssistantDevice> {
        const device = await this.requireDevice(userId, deviceId);
        const client = await this.clientFor(userId);
        const payload = await client.getState(device.entityId);
        this.applyState(device, payload);
        await this.deviceRepository.save(device);
        return this.toPublicDevice(device);
    }

    async controlDevice(
        userId: string,
        deviceId: string,
        command: HomeAssistantLightCommandDto,
    ): Promise<PublicHomeAssistantDevice> {
        const device = await this.requireDevice(userId, deviceId);
        const client = await this.clientFor(userId);
        if (device.domain === "light") {
            const call = buildLightServiceCall(device.entityId, command);
            await client.callService(call.domain, call.service, call.data);
        } else if (device.domain === "switch") {
            await client.callService("switch", command.on === false ? "turn_off" : "turn_on", {
                entity_id: device.entityId,
            });
        } else {
            throw HttpErrorFactory.badRequest("该设备类型尚未提供控制，目前优先支持灯光");
        }
        try {
            const payload = await client.getState(device.entityId);
            this.applyState(device, payload);
        } catch {
            if (command.on !== undefined) device.state = { ...device.state, on: command.on };
            if (command.brightness !== undefined) {
                device.state = { ...device.state, brightness: command.brightness };
            }
            if (command.color) device.state = { ...device.state, color: command.color };
            if (command.colorTemp !== undefined) {
                device.state = { ...device.state, colorTemp: command.colorTemp };
            }
            device.lastStateAt = new Date();
        }
        await this.deviceRepository.save(device);
        return this.toPublicDevice(device);
    }

    private async syncInstance(instance: HomeAssistantInstance): Promise<void> {
        try {
            const client = await this.clientForOwner(instance);
            const states = await client.listStates();
            const allowed = new Set<string>(HOME_ASSISTANT_SYNC_DOMAINS);
            const incoming = states.filter((item) => {
                const entityId = String(item.entity_id || "");
                const domain = entityId.split(".")[0] || "";
                return allowed.has(domain);
            });
            const existing = await this.deviceRepository.find({ where: { instanceId: instance.id } });
            const byEntity = new Map(existing.map((device) => [device.entityId, device]));
            const seen = new Set<string>();

            for (const payload of incoming) {
                const entityId = String(payload.entity_id || "");
                if (!entityId) continue;
                seen.add(entityId);
                const domain = entityId.split(".")[0] || "other";
                let device = byEntity.get(entityId);
                if (!device) {
                    device = this.deviceRepository.create({
                        instanceId: instance.id,
                        entityId,
                    });
                }
                device.uniqueId =
                    typeof payload.attributes?.unique_id === "string"
                        ? payload.attributes.unique_id
                        : device.uniqueId;
                device.name =
                    (typeof payload.attributes?.friendly_name === "string" &&
                        payload.attributes.friendly_name) ||
                    entityId;
                device.domain = domain;
                device.category = domain;
                this.applyState(device, payload);
                await this.deviceRepository.save(device);
            }

            const stale = existing.filter((device) => !seen.has(device.entityId));
            if (stale.length) {
                await this.deviceRepository.remove(stale);
            }

            instance.status = HomeAssistantInstanceStatus.ACTIVE;
            instance.lastError = null;
            instance.lastSyncAt = new Date();
            await this.instanceRepository.save(instance);
        } catch (error) {
            instance.status = HomeAssistantInstanceStatus.SYNC_ERROR;
            instance.lastError = this.errorMessage(error, "同步 Home Assistant 失败");
            await this.instanceRepository.save(instance);
            throw HttpErrorFactory.badGateway(instance.lastError);
        }
    }

    private applyState(device: HomeAssistantDevice, payload: Parameters<typeof normalizeLightState>[0]) {
        const light = normalizeLightState(payload);
        device.online = payload.state !== "unavailable" && payload.state !== "unknown";
        device.attributes = payload.attributes || {};
        device.state = light;
        device.lastStateAt = payload.last_updated ? new Date(payload.last_updated) : new Date();
        if (device.domain === "switch") {
            device.state = { ...light, on: payload.state === "on" };
        }
    }

    private async clientFor(userId: string): Promise<HomeAssistantCloudClient> {
        return this.clientForOwner(await this.requireInstance(userId));
    }

    private async clientForOwner(instance: HomeAssistantInstance): Promise<HomeAssistantCloudClient> {
        if (
            instance.authMode === HomeAssistantAuthMode.PASSWORD &&
            instance.refreshTokenEncrypted &&
            instance.accessTokenExpiresAt &&
            instance.accessTokenExpiresAt.getTime() - HOME_ASSISTANT_TOKEN_REFRESH_MARGIN_MS <
                Date.now()
        ) {
            try {
                const refreshed = await HomeAssistantCloudClient.refreshPasswordToken(
                    instance.baseUrl,
                    this.decrypt(instance.refreshTokenEncrypted),
                );
                instance.accessTokenEncrypted = this.encrypt(refreshed.accessToken);
                instance.refreshTokenEncrypted = refreshed.refreshToken
                    ? this.encrypt(refreshed.refreshToken)
                    : instance.refreshTokenEncrypted;
                instance.accessTokenExpiresAt = refreshed.expiresAt || null;
                instance.status = HomeAssistantInstanceStatus.ACTIVE;
                await this.instanceRepository.save(instance);
            } catch (error) {
                instance.status = HomeAssistantInstanceStatus.AUTH_ERROR;
                instance.lastError = this.errorMessage(error, "HA 登录已失效");
                await this.instanceRepository.save(instance);
                throw HttpErrorFactory.unauthorized("HA 登录已失效，请重新填写账号密码");
            }
        }
        return new HomeAssistantCloudClient(instance.baseUrl, this.decrypt(instance.accessTokenEncrypted));
    }

    private async issueTokens(
        baseUrl: string,
        authMode: "token" | "password",
        dto: UpsertHomeAssistantInstanceDto,
        existing: HomeAssistantInstance | null,
    ): Promise<HomeAssistantTokenSet> {
        if (authMode === "password") {
            if (dto.username && dto.password) {
                return HomeAssistantCloudClient.loginWithPassword(baseUrl, dto.username, dto.password);
            }
            if (existing?.refreshTokenEncrypted) {
                return HomeAssistantCloudClient.refreshPasswordToken(
                    baseUrl,
                    this.decrypt(existing.refreshTokenEncrypted),
                );
            }
            throw HttpErrorFactory.badRequest("请填写 Home Assistant 用户名和密码");
        }
        if (dto.token?.trim()) {
            return { accessToken: dto.token.trim(), refreshToken: null, expiresAt: null };
        }
        if (existing?.accessTokenEncrypted) {
            return {
                accessToken: this.decrypt(existing.accessTokenEncrypted),
                refreshToken: existing.refreshTokenEncrypted
                    ? this.decrypt(existing.refreshTokenEncrypted)
                    : null,
                expiresAt: existing.accessTokenExpiresAt,
            };
        }
        throw HttpErrorFactory.badRequest("请填写 Home Assistant 长期访问令牌");
    }

    private async requireInstance(userId: string): Promise<HomeAssistantInstance> {
        const instance = await this.instanceRepository.findOne({ where: { ownerUserId: userId } });
        if (!instance) throw HttpErrorFactory.notFound("尚未连接 Home Assistant");
        return instance;
    }

    private async requireDevice(userId: string, deviceId: string): Promise<HomeAssistantDevice> {
        const instance = await this.requireInstance(userId);
        const device = await this.deviceRepository.findOne({
            where: { id: deviceId, instanceId: instance.id },
        });
        if (!device) throw HttpErrorFactory.notFound("设备不存在");
        return device;
    }

    private toPublicInstance(
        instance: HomeAssistantInstance,
        deviceCount: number,
    ): PublicHomeAssistantInstance {
        return {
            id: instance.id,
            label: instance.label,
            baseUrl: instance.baseUrl,
            authMode: instance.authMode,
            username: instance.username,
            haVersion: instance.haVersion,
            locationName: instance.locationName,
            status: instance.status,
            deviceCount,
            lastSyncAt: instance.lastSyncAt?.toISOString() || null,
            lastError: instance.lastError,
            createdAt: instance.createdAt.toISOString(),
            updatedAt: instance.updatedAt.toISOString(),
        };
    }

    private toPublicDevice(device: HomeAssistantDevice): PublicHomeAssistantDevice {
        return {
            id: device.id,
            instanceId: device.instanceId,
            provider: "homeassistant",
            entityId: device.entityId,
            uniqueId: device.uniqueId,
            name: device.name,
            domain: device.domain,
            category: device.category,
            categoryLabel: homeAssistantCategoryLabel(device.category),
            areaId: device.areaId,
            areaName: device.areaName,
            online: device.online,
            state: device.state,
            attributes: device.attributes,
            lastStateAt: device.lastStateAt?.toISOString() || null,
            createdAt: device.createdAt.toISOString(),
            updatedAt: device.updatedAt.toISOString(),
        };
    }

    private encrypt(value: string): string {
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
        const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
        return [iv, cipher.getAuthTag(), encrypted]
            .map((part) => part.toString("base64url"))
            .join(".");
    }

    private decrypt(value: string): string {
        const [iv, tag, encrypted] = value.split(".");
        if (!iv || !tag || !encrypted) throw HttpErrorFactory.badRequest("无效的 Home Assistant 凭据");
        const decipher = createDecipheriv(
            "aes-256-gcm",
            this.encryptionKey,
            Buffer.from(iv, "base64url"),
        );
        decipher.setAuthTag(Buffer.from(tag, "base64url"));
        return Buffer.concat([
            decipher.update(Buffer.from(encrypted, "base64url")),
            decipher.final(),
        ]).toString("utf8");
    }

    private errorMessage(error: unknown, fallback: string): string {
        if (error && typeof error === "object" && "message" in error) {
            const message = String((error as { message?: unknown }).message || "");
            if (message) return message;
        }
        return fallback;
    }
}

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";

import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import {
    XiaomiHomeAccount,
    XiaomiHomeAccountStatus,
    type XiaomiHomeCapability,
    XiaomiHomeDevice,
    XiaomiHomeOAuthSession,
    type XiaomiHomeServer,
    type XiaomiHomeSummary,
} from "@buildingai/db/entities";
import { In, IsNull, MoreThan, Repository } from "@buildingai/db/typeorm";
import { HttpError, HttpErrorFactory } from "@buildingai/errors";
import { Injectable } from "@nestjs/common";

import { XiaomiHomeCloudClient, XiaomiHomeCloudError } from "./xiaomi-home.cloud";
import {
    expandXiaomiLightWrites,
    isRgbColorCapability,
    parsePackedRgb,
    rewriteInvalidBoolWrites,
    XIAOMI_MIOT_INVALID_VALUE,
    type XiaomiLightWrite,
} from "./xiaomi-home.light";
import {
    getXiaomiHomeCategory,
    getXiaomiHomeCategoryLabel,
    XIAOMI_HOME_DEFAULT_FRONTEND_ORIGIN,
    XIAOMI_HOME_HOME_ASSISTANT_CLIENT_ID,
    XIAOMI_HOME_LOCAL_OAUTH_ENABLED,
    XIAOMI_HOME_LOCAL_RELAY_ORIGIN,
    XIAOMI_HOME_OAUTH_CLIENT_ID,
    XIAOMI_HOME_OAUTH_SESSION_TTL_MS,
    XIAOMI_HOME_SERVERS,
    XIAOMI_HOME_TOKEN_REFRESH_MARGIN_MS,
} from "./xiaomi-home.constants";
import type {
    XiaomiHomeActionCommand,
    XiaomiHomeCloudDevice,
    XiaomiHomeDeviceFilters,
    XiaomiHomeInventory,
    XiaomiHomeLocalCredentials,
    XiaomiHomeNormalizedSpec,
    XiaomiHomeOAuthQuery,
    XiaomiHomePropertyCommand,
    XiaomiHomeSpec,
} from "./xiaomi-home.types";

type OAuthCallbackResult = {
    success: boolean;
    frontendOrigin: string;
    accountId?: string;
    message: string;
};

type PublicXiaomiHomeAccount = {
    id: string;
    label: string;
    cloudServer: XiaomiHomeServer;
    cloudServerLabel: string;
    upstreamUserId: string | null;
    nickname: string | null;
    status: XiaomiHomeAccount["status"];
    homes: XiaomiHomeSummary[];
    deviceCount: number;
    onlineDeviceCount: number;
    lastSyncAt: Date | null;
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
};

function typeName(type?: string): string {
    return String(type || "").split(":")[3] || "unknown";
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

@Injectable()
export class XiaomiHomeService {
    private readonly encryptionKey = createHash("sha256")
        .update(
            process.env.XIAOMI_HOME_ENCRYPTION_KEY ||
                process.env.JWT_SECRET ||
                "BuildingAI-xiaomi-home-development-key",
        )
        .digest();

    private readonly specCache = new Map<
        string,
        { value: XiaomiHomeNormalizedSpec; expiresAt: number }
    >();

    constructor(
        @InjectRepository(XiaomiHomeAccount)
        private readonly accountRepository: Repository<XiaomiHomeAccount>,
        @InjectRepository(XiaomiHomeOAuthSession)
        private readonly oauthSessionRepository: Repository<XiaomiHomeOAuthSession>,
        @InjectRepository(XiaomiHomeDevice)
        private readonly deviceRepository: Repository<XiaomiHomeDevice>,
    ) {}

    async listAccounts(userId: string): Promise<PublicXiaomiHomeAccount[]> {
        const accounts = await this.accountRepository.find({
            where: { ownerUserId: userId },
            order: { createdAt: "ASC" },
        });
        const devices = accounts.length
            ? await this.deviceRepository.find({
                  where: { accountId: In(accounts.map((account) => account.id)) },
                  select: { accountId: true, online: true },
              })
            : [];
        const counts = new Map<string, { total: number; online: number }>();
        for (const device of devices) {
            const count = counts.get(device.accountId) || { total: 0, online: 0 };
            count.total += 1;
            if (device.online) count.online += 1;
            counts.set(device.accountId, count);
        }
        return accounts.map((account) => {
            const count = counts.get(account.id) || { total: 0, online: 0 };
            return this.toPublicAccount(account, count.total, count.online);
        });
    }

    async startOAuth(params: {
        userId: string;
        cloudServer: string;
        mode: "direct" | "local_token";
        apiOrigin: string;
        frontendOrigin?: string;
    }) {
        const cloudServer = params.cloudServer as XiaomiHomeServer;
        if (!Object.prototype.hasOwnProperty.call(XIAOMI_HOME_SERVERS, cloudServer)) {
            throw HttpErrorFactory.badRequest("不支持的小米云区域");
        }
        const apiOrigin = this.validOrigin(
            process.env.XIAOMI_HOME_API_ORIGIN || params.apiOrigin,
            params.apiOrigin,
        );
        const frontendOrigin = this.validOrigin(
            process.env.XIAOMI_HOME_FRONTEND_ORIGIN || params.frontendOrigin,
            XIAOMI_HOME_DEFAULT_FRONTEND_ORIGIN,
        );
        const prefix = `/${(process.env.VITE_APP_WEB_API_PREFIX || "api").replace(/^\/+|\/+$/g, "")}`;
        const callbackUrl = `${apiOrigin}${prefix}/smart-home/xiaomi/oauth/callback`;
        const deviceId = `ha.${randomUUID().replace(/-/g, "")}`;
        // Match Home Assistant's official Xiaomi integration state derivation.
        const state = createHash("sha1").update(`d=${deviceId}`).digest("hex");
        const usesHomeAssistantClient =
            XIAOMI_HOME_OAUTH_CLIENT_ID === XIAOMI_HOME_HOME_ASSISTANT_CLIENT_ID;
        const localToken = params.mode === "local_token" || usesHomeAssistantClient;

        if (localToken) {
            if (
                params.mode === "local_token" &&
                !XIAOMI_HOME_LOCAL_OAUTH_ENABLED &&
                !usesHomeAssistantClient
            ) {
                throw HttpErrorFactory.badRequest("本地小米凭据导入未启用");
            }
            if (!usesHomeAssistantClient) {
                throw HttpErrorFactory.badRequest("本地脚本仅适用于 Home Assistant 官方 client ID");
            }
        }

        const redirectUri = localToken
            ? `${XIAOMI_HOME_LOCAL_RELAY_ORIGIN}/api/webhook/buildingai-${randomUUID().replace(/-/g, "")}`
            : process.env.XIAOMI_HOME_OAUTH_REDIRECT_URI || callbackUrl;
        this.assertHttpUrl(redirectUri, "小米 OAuth 回调地址");

        const expiresAt = new Date(Date.now() + XIAOMI_HOME_OAUTH_SESSION_TTL_MS);
        await this.oauthSessionRepository.save(
            this.oauthSessionRepository.create({
                ownerUserId: params.userId,
                cloudServer,
                deviceId,
                redirectUri,
                frontendOrigin,
                stateHash: this.hashState(state),
                expiresAt,
                consumedAt: null,
                accountId: null,
            }),
        );

        return {
            authorizationUrl: XiaomiHomeCloudClient.buildAuthorizationUrl({
                redirectUri,
                deviceId,
                state,
            }),
            expiresAt,
            cloudServer,
            redirectUri,
            state,
            mode: localToken ? "local_token" : "direct",
        };
    }

    async completeOAuth(query: XiaomiHomeOAuthQuery): Promise<OAuthCallbackResult> {
        const fallbackOrigin = this.validOrigin(
            process.env.XIAOMI_HOME_FRONTEND_ORIGIN,
            XIAOMI_HOME_DEFAULT_FRONTEND_ORIGIN,
        );
        if (!query.state) {
            return { success: false, frontendOrigin: fallbackOrigin, message: "缺少 OAuth state" };
        }
        const session = await this.oauthSessionRepository.findOne({
            where: {
                stateHash: this.hashState(query.state),
                consumedAt: IsNull(),
                expiresAt: MoreThan(new Date()),
            },
        });
        if (!session) {
            return {
                success: false,
                frontendOrigin: fallbackOrigin,
                message: "授权会话已失效，请返回系统重新登录",
            };
        }

        session.consumedAt = new Date();
        await this.oauthSessionRepository.save(session);
        if (query.error || !query.code) {
            return {
                success: false,
                frontendOrigin: session.frontendOrigin,
                message: query.error_description || query.error || "用户取消了小米账号授权",
            };
        }

        try {
            const token = await XiaomiHomeCloudClient.exchangeCode({
                cloudServer: session.cloudServer,
                redirectUri: session.redirectUri,
                code: query.code,
                deviceId: session.deviceId,
            });
            const { account, nickname } = await this.saveAuthenticatedAccount({
                ownerUserId: session.ownerUserId,
                cloudServer: session.cloudServer,
                deviceId: session.deviceId,
                redirectUri: session.redirectUri,
                accessToken: token.access_token,
                refreshToken: token.refresh_token,
                expiresAt: new Date(token.expires_ts),
            });
            session.accountId = account.id;
            await this.oauthSessionRepository.save(session);
            return {
                success: true,
                frontendOrigin: session.frontendOrigin,
                accountId: account.id,
                message: `已连接 ${nickname || "小米账号"}`,
            };
        } catch (error) {
            return {
                success: false,
                frontendOrigin: session.frontendOrigin,
                message: errorMessage(error),
            };
        }
    }

    async importCredentials(userId: string, serializedCredentials: string) {
        const usesHomeAssistantClient =
            XIAOMI_HOME_OAUTH_CLIENT_ID === XIAOMI_HOME_HOME_ASSISTANT_CLIENT_ID;
        if (!usesHomeAssistantClient) {
            if (!XIAOMI_HOME_LOCAL_OAUTH_ENABLED) {
                throw HttpErrorFactory.badRequest("本地小米凭据导入未启用");
            }
            throw HttpErrorFactory.badRequest("本地脚本仅适用于 Home Assistant 官方 client ID");
        }

        const credentials = this.parseLocalCredentials(serializedCredentials);
        const session = await this.oauthSessionRepository.findOne({
            where: {
                ownerUserId: userId,
                stateHash: this.hashState(credentials.state),
                consumedAt: IsNull(),
                expiresAt: MoreThan(new Date()),
            },
        });
        if (!session) {
            throw HttpErrorFactory.badRequest("本地授权会话已失效，请重新生成授权命令");
        }
        if (
            session.cloudServer !== credentials.cloudServer ||
            session.deviceId !== credentials.deviceId ||
            session.redirectUri !== credentials.redirectUri
        ) {
            throw HttpErrorFactory.badRequest("本地授权凭据与当前会话不匹配");
        }

        try {
            const { account } = await this.saveAuthenticatedAccount({
                ownerUserId: userId,
                cloudServer: session.cloudServer,
                deviceId: credentials.deviceId,
                redirectUri: credentials.redirectUri,
                accessToken: credentials.accessToken,
                refreshToken: credentials.refreshToken,
                expiresAt: new Date(credentials.expiresAt),
            });
            session.consumedAt = new Date();
            session.accountId = account.id;
            await this.oauthSessionRepository.save(session);
            const devices = await this.deviceRepository.find({ where: { accountId: account.id } });
            return this.toPublicAccount(
                account,
                devices.length,
                devices.filter((device) => device.online).length,
            );
        } catch (error) {
            throw this.toHttpError(error);
        }
    }

    async syncAccount(userId: string, accountId: string) {
        const account = await this.getOwnedAccount(userId, accountId);
        try {
            await this.withCloud(account, async (cloud) => {
                const inventory = await cloud.getInventory();
                await this.saveInventory(account, inventory, cloud);
            });
            const refreshed = await this.getOwnedAccount(userId, accountId);
            const devices = await this.deviceRepository.find({ where: { accountId } });
            return this.toPublicAccount(
                refreshed,
                devices.length,
                devices.filter((device) => device.online).length,
            );
        } catch (error) {
            await this.recordAccountError(account, error);
            throw this.toHttpError(error);
        }
    }

    async updateAccountLabel(userId: string, accountId: string, label: string) {
        const account = await this.getOwnedAccount(userId, accountId);
        const normalizedLabel = label.trim();
        if (!normalizedLabel) throw HttpErrorFactory.badRequest("账号备注不能为空");
        account.label = normalizedLabel;
        await this.accountRepository.save(account);
        const devices = await this.deviceRepository.find({ where: { accountId } });
        return this.toPublicAccount(
            account,
            devices.length,
            devices.filter((device) => device.online).length,
        );
    }

    async removeAccount(userId: string, accountId: string): Promise<void> {
        await this.getOwnedAccount(userId, accountId);
        await this.accountRepository.manager.transaction(async (manager) => {
            await manager.getRepository(XiaomiHomeDevice).delete({ accountId });
            await manager.getRepository(XiaomiHomeOAuthSession).delete({ accountId });
            await manager
                .getRepository(XiaomiHomeAccount)
                .delete({ id: accountId, ownerUserId: userId });
        });
    }

    async listDevices(userId: string, accountId: string, filters: XiaomiHomeDeviceFilters) {
        await this.getOwnedAccount(userId, accountId);
        return this.listOwnedDevices({ accountIds: [accountId], filters });
    }

    async listAllDevices(userId: string, filters: XiaomiHomeDeviceFilters) {
        const accounts = await this.accountRepository.find({
            where: { ownerUserId: userId },
            select: { id: true },
        });
        if (!accounts.length) return [];
        return this.listOwnedDevices({
            accountIds: accounts.map((account) => account.id),
            filters,
        });
    }

    private async listOwnedDevices(params: {
        accountIds: string[];
        filters: XiaomiHomeDeviceFilters;
    }) {
        let devices = await this.deviceRepository.find({
            where: { accountId: In(params.accountIds) },
            order: { homeName: "ASC", roomName: "ASC", name: "ASC" },
        });
        const { filters } = params;
        if (filters.homeId) devices = devices.filter((device) => device.homeId === filters.homeId);
        if (filters.roomId) devices = devices.filter((device) => device.roomId === filters.roomId);
        if (filters.category) {
            devices = devices.filter((device) => device.category === filters.category);
        }
        const keyword = filters.keyword?.trim().toLowerCase();
        if (keyword) {
            devices = devices.filter((device) =>
                [device.name, device.model, device.homeName, device.roomName]
                    .filter(Boolean)
                    .some((value) => String(value).toLowerCase().includes(keyword)),
            );
        }
        return devices.map((device) => this.toPublicDevice(device));
    }

    async getDevice(userId: string, deviceId: string) {
        return this.toPublicDevice(await this.getOwnedDevice(userId, deviceId));
    }

    async refreshDevice(userId: string, deviceId: string) {
        const device = await this.getOwnedDevice(userId, deviceId);
        const account = await this.getOwnedAccount(userId, device.accountId);
        try {
            await this.withCloud(account, async (cloud) => {
                await this.refreshDeviceStates(cloud, [device]);
            });
            await this.deviceRepository.save(device);
            return this.toPublicDevice(await this.getOwnedDevice(userId, deviceId));
        } catch (error) {
            await this.recordAccountError(account, error);
            throw this.toHttpError(error);
        }
    }

    async setProperty(userId: string, deviceId: string, command: XiaomiHomePropertyCommand) {
        const device = await this.getOwnedDevice(userId, deviceId);
        const account = await this.getOwnedAccount(userId, device.accountId);
        const capability = device.capabilities.find(
            (item) =>
                item.kind === "property" &&
                item.siid === command.siid &&
                item.piid === command.piid,
        );
        if (!capability || !capability.access?.includes("write")) {
            throw HttpErrorFactory.badRequest("该设备属性不可控制");
        }
        const value = this.validateValue(capability, command.value);
        const writes = expandXiaomiLightWrites({
            did: device.did,
            capabilities: device.capabilities,
            state: device.state,
            capability,
            value,
        });
        try {
            await this.withCloud(account, async (cloud) => {
                const applied = await this.applyPropertyWrites(cloud, device.capabilities, writes);
                for (const write of applied) {
                    device.state = {
                        ...device.state,
                        [this.propertyKey(write.siid, write.piid)]: write.value,
                    };
                }
            });
            device.lastStateAt = new Date();
            await this.deviceRepository.save(device);
            return this.toPublicDevice(device);
        } catch (error) {
            await this.recordAccountError(account, error);
            throw this.toHttpError(error);
        }
    }

    async executeAction(userId: string, deviceId: string, command: XiaomiHomeActionCommand) {
        const device = await this.getOwnedDevice(userId, deviceId);
        const account = await this.getOwnedAccount(userId, device.accountId);
        const capability = device.capabilities.find(
            (item) =>
                item.kind === "action" && item.siid === command.siid && item.aiid === command.aiid,
        );
        if (!capability) throw HttpErrorFactory.badRequest("该设备不支持此动作");
        const inputs = command.in || [];
        if ((capability.input?.length || 0) !== inputs.length) {
            throw HttpErrorFactory.badRequest("动作参数数量不正确");
        }
        const values = inputs.map((value, index) => {
            const input = capability.input?.[index];
            if (!input) throw HttpErrorFactory.badRequest("动作参数定义缺失");
            return this.validateValue(input, value);
        });
        try {
            const result = await this.withCloud(account, (cloud) =>
                cloud.action({
                    did: device.did,
                    siid: command.siid,
                    aiid: command.aiid,
                    in: values,
                }),
            );
            const code = typeof result.code === "number" ? result.code : 0;
            if (code !== 0) throw new XiaomiHomeCloudError(`设备拒绝了动作（${code}）`);
            return { success: true, result };
        } catch (error) {
            await this.recordAccountError(account, error);
            throw this.toHttpError(error);
        }
    }

    private parseLocalCredentials(serializedCredentials: string): XiaomiHomeLocalCredentials {
        const normalized = serializedCredentials
            .trim()
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, "");
        let value: unknown;
        try {
            value = JSON.parse(normalized);
        } catch {
            throw HttpErrorFactory.badRequest("凭据不是有效的 JSON");
        }
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw HttpErrorFactory.badRequest("凭据格式不正确");
        }
        const record = value as Record<string, unknown>;
        const requiredString = (key: string, min: number, max: number): string => {
            const item = record[key];
            if (
                typeof item !== "string" ||
                item.length < min ||
                item.length > max ||
                /[\u0000-\u001f\u007f]/.test(item)
            ) {
                throw HttpErrorFactory.badRequest("凭据格式不正确");
            }
            return item;
        };

        if (record.provider !== "xiaomi_home" || record.version !== 1) {
            throw HttpErrorFactory.badRequest("不支持的凭据版本");
        }
        const cloudServer = requiredString("cloudServer", 2, 8);
        if (!Object.prototype.hasOwnProperty.call(XIAOMI_HOME_SERVERS, cloudServer)) {
            throw HttpErrorFactory.badRequest("凭据中的小米云区域无效");
        }
        const clientId = requiredString("clientId", 1, 64);
        if (clientId !== XIAOMI_HOME_HOME_ASSISTANT_CLIENT_ID) {
            throw HttpErrorFactory.badRequest("凭据不是由 Home Assistant 官方客户端生成");
        }
        const deviceId = requiredString("deviceId", 8, 100);
        if (!/^ha\.[A-Za-z0-9_-]+$/.test(deviceId)) {
            throw HttpErrorFactory.badRequest("凭据中的设备标识无效");
        }
        const state = requiredString("state", 32, 160);
        if (!/^[A-Za-z0-9_-]+$/.test(state)) {
            throw HttpErrorFactory.badRequest("凭据中的授权状态无效");
        }
        const redirectUri = requiredString("redirectUri", 20, 500);
        let redirect: URL;
        try {
            redirect = new URL(redirectUri);
        } catch {
            throw HttpErrorFactory.badRequest("凭据中的回调地址无效");
        }
        if (
            redirect.protocol !== "http:" ||
            redirect.hostname !== "homeassistant.local" ||
            redirect.port !== "8123" ||
            !/^\/api\/webhook\/[A-Za-z0-9_-]+$/.test(redirect.pathname) ||
            redirect.search ||
            redirect.hash
        ) {
            throw HttpErrorFactory.badRequest("凭据中的回调地址不是本地 Home Assistant 地址");
        }
        const accessToken = requiredString("accessToken", 20, 4096);
        const refreshToken = requiredString("refreshToken", 20, 4096);
        if (/\s/.test(accessToken) || /\s/.test(refreshToken)) {
            throw HttpErrorFactory.badRequest("凭据中的 token 格式无效");
        }
        const expiresAt = requiredString("expiresAt", 20, 64);
        const expiresAtTimestamp = Date.parse(expiresAt);
        if (!Number.isFinite(expiresAtTimestamp) || expiresAtTimestamp <= Date.now()) {
            throw HttpErrorFactory.badRequest("凭据已经过期，请重新登录小米账号");
        }

        return {
            provider: "xiaomi_home",
            version: 1,
            cloudServer,
            clientId,
            deviceId,
            redirectUri,
            state,
            accessToken,
            refreshToken,
            expiresAt: new Date(expiresAtTimestamp).toISOString(),
        };
    }

    private async saveAuthenticatedAccount(params: {
        ownerUserId: string;
        cloudServer: XiaomiHomeServer;
        deviceId: string;
        redirectUri: string;
        accessToken: string;
        refreshToken: string;
        expiresAt: Date;
    }): Promise<{ account: XiaomiHomeAccount; nickname?: string }> {
        const cloud = new XiaomiHomeCloudClient(params.cloudServer, params.accessToken);
        const [profile, inventory] = await Promise.all([
            cloud.getUserProfile().catch(() => ({ uid: undefined, miliaoNick: undefined })),
            cloud.getInventory(),
        ]);
        const upstreamUserId = inventory.uid || profile.uid;
        if (!upstreamUserId) throw new XiaomiHomeCloudError("小米云未返回用户ID");

        const linkedAccounts = await this.accountRepository.find({
            where: {
                upstreamUserId: String(upstreamUserId),
                cloudServer: params.cloudServer,
            },
        });
        if (linkedAccounts.some((item) => item.ownerUserId !== params.ownerUserId)) {
            throw HttpErrorFactory.badRequest("该小米账号已经绑定到其他 BuildingAI 用户");
        }
        let account = linkedAccounts.find((item) => item.ownerUserId === params.ownerUserId);
        if (!account) {
            account = this.accountRepository.create({
                ownerUserId: params.ownerUserId,
                label: profile.miliaoNick || "小米账号",
                cloudServer: params.cloudServer,
                upstreamUserId: String(upstreamUserId),
                nickname: profile.miliaoNick || null,
                oauthDeviceId: params.deviceId,
                oauthRedirectUri: params.redirectUri,
                accessTokenEncrypted: "",
                refreshTokenEncrypted: "",
                accessTokenExpiresAt: null,
                status: XiaomiHomeAccountStatus.ACTIVE,
                homes: [],
                lastSyncAt: null,
                lastError: null,
            });
        }
        account.oauthDeviceId = params.deviceId;
        account.oauthRedirectUri = params.redirectUri;
        account.nickname = profile.miliaoNick || account.nickname;
        account.accessTokenEncrypted = this.encrypt(params.accessToken);
        account.refreshTokenEncrypted = this.encrypt(params.refreshToken);
        account.accessTokenExpiresAt = params.expiresAt;
        account.status = XiaomiHomeAccountStatus.ACTIVE;
        account.lastError = null;
        account = await this.accountRepository.save(account);
        await this.saveInventory(account, inventory, cloud);
        return { account, nickname: profile.miliaoNick };
    }

    private async saveInventory(
        account: XiaomiHomeAccount,
        inventory: XiaomiHomeInventory,
        cloud: XiaomiHomeCloudClient,
    ): Promise<void> {
        const existing = await this.deviceRepository.find({ where: { accountId: account.id } });
        const existingByDid = new Map(existing.map((device) => [device.did, device]));
        const rows: XiaomiHomeDevice[] = [];

        for (const device of inventory.devices) {
            const previous = existingByDid.get(device.did);
            const normalized = await this.getNormalizedSpec(cloud, device, previous);
            const row =
                previous ||
                this.deviceRepository.create({ accountId: account.id, did: device.did });
            row.uid = device.uid || inventory.uid;
            row.homeId = device.homeId || null;
            row.homeName = device.homeName || null;
            row.roomId = device.roomId || null;
            row.roomName = device.roomName || null;
            row.name = device.name;
            row.model = device.model || null;
            row.urn = device.urn || null;
            row.manufacturer = device.manufacturer || null;
            row.icon = device.icon || null;
            row.category = normalized.category;
            row.online = device.online === true;
            row.connectType = device.connectType ?? null;
            row.capabilities = normalized.capabilities;
            row.state = previous?.state || {};
            row.metadata = device.metadata || {};
            row.lastStateAt = previous?.lastStateAt || null;
            rows.push(row);
            existingByDid.delete(device.did);
        }

        if (rows.length) await this.refreshDeviceStates(cloud, rows).catch(() => undefined);
        await this.accountRepository.manager.transaction(async (manager) => {
            if (existingByDid.size) {
                await manager
                    .getRepository(XiaomiHomeDevice)
                    .delete({ id: In([...existingByDid.values()].map((device) => device.id)) });
            }
            if (rows.length) await manager.getRepository(XiaomiHomeDevice).save(rows);
            account.homes = this.buildHomeSummaries(inventory);
            account.upstreamUserId = inventory.uid || account.upstreamUserId;
            account.status = XiaomiHomeAccountStatus.ACTIVE;
            account.lastSyncAt = new Date();
            account.lastError = null;
            await manager.getRepository(XiaomiHomeAccount).save(account);
        });
    }

    private buildHomeSummaries(inventory: XiaomiHomeInventory): XiaomiHomeSummary[] {
        return inventory.homes.map((home) => ({
            id: home.id,
            name: home.name,
            uid: home.uid,
            roomCount: home.roomInfo.length,
            deviceCount: inventory.devices.filter((device) => device.homeId === home.id).length,
        }));
    }

    private async getNormalizedSpec(
        cloud: XiaomiHomeCloudClient,
        device: XiaomiHomeCloudDevice,
        previous?: XiaomiHomeDevice,
    ): Promise<XiaomiHomeNormalizedSpec> {
        const fallback = {
            category: getXiaomiHomeCategory(device.urn, device.model),
            capabilities: previous?.capabilities || [],
        };
        if (!device.urn) return fallback;
        const cached = this.specCache.get(device.urn);
        if (cached && cached.expiresAt > Date.now()) return cached.value;
        try {
            const normalized = this.normalizeSpec(device.urn, await cloud.getSpec(device.urn));
            this.specCache.set(device.urn, {
                value: normalized,
                expiresAt: Date.now() + 24 * 60 * 60 * 1000,
            });
            return normalized;
        } catch {
            return fallback;
        }
    }

    private normalizeSpec(urn: string, spec: XiaomiHomeSpec): XiaomiHomeNormalizedSpec {
        const capabilities: XiaomiHomeCapability[] = [];
        for (const service of spec.services || []) {
            const serviceName = typeName(service.type);
            if (serviceName === "device-information") continue;
            const properties = service.properties || [];
            for (const property of properties) {
                capabilities.push({
                    kind: "property",
                    siid: service.iid,
                    piid: property.iid,
                    serviceName,
                    serviceDescription: service.description,
                    name: typeName(property.type),
                    description: property.description,
                    format: property.format,
                    access: property.access || [],
                    unit: property.unit || null,
                    valueRange: this.valueRange(property["value-range"] ?? property.value_range),
                    valueList: this.valueList(property["value-list"] ?? property.value_list),
                });
            }
            for (const action of service.actions || []) {
                capabilities.push({
                    kind: "action",
                    siid: service.iid,
                    aiid: action.iid,
                    serviceName,
                    serviceDescription: service.description,
                    name: typeName(action.type),
                    description: action.description,
                    input: (action.in || [])
                        .map((piid) => properties.find((property) => property.iid === piid))
                        .filter((property): property is NonNullable<typeof property> =>
                            Boolean(property),
                        )
                        .map((property) => ({
                            piid: property.iid,
                            name: typeName(property.type),
                            description: property.description,
                            format: property.format,
                            valueRange: this.valueRange(
                                property["value-range"] ?? property.value_range,
                            ),
                            valueList: this.valueList(
                                property["value-list"] ?? property.value_list,
                            ),
                        })),
                });
            }
        }
        return {
            category: getXiaomiHomeCategory(
                urn,
                undefined,
                (spec.services || []).map((service) => typeName(service.type)),
            ),
            capabilities,
        };
    }

    private valueRange(value?: [number, number, number]) {
        if (
            !value ||
            value.length !== 3 ||
            value.some((item) => typeof item !== "number" || !Number.isFinite(item))
        ) {
            return null;
        }
        const [min, max, step] = value;
        if (max < min || step <= 0) return null;
        return { min, max, step };
    }

    private valueList(value?: Array<{ value: string | number | boolean; description?: string }>) {
        if (!Array.isArray(value)) return null;
        return value
            .filter(
                (item) =>
                    item &&
                    (typeof item.value === "string" ||
                        typeof item.value === "number" ||
                        typeof item.value === "boolean"),
            )
            .map((item) => ({
                value: item.value,
                description: item.description || String(item.value),
            }));
    }

    private async refreshDeviceStates(cloud: XiaomiHomeCloudClient, devices: XiaomiHomeDevice[]) {
        const requests = devices.flatMap((device) =>
            device.capabilities
                .filter(
                    (capability) =>
                        capability.kind === "property" &&
                        capability.piid !== undefined &&
                        capability.access?.includes("read"),
                )
                .map((capability) => ({
                    did: device.did,
                    siid: capability.siid,
                    piid: capability.piid!,
                })),
        );
        if (!requests.length) return;
        const results = await cloud.getProperties(requests);
        const byDid = new Map(devices.map((device) => [device.did, device]));
        for (const result of results) {
            if (result.code !== undefined && result.code !== 0) continue;
            if (!("value" in result)) continue;
            const device = byDid.get(result.did);
            if (!device) continue;
            device.state = {
                ...device.state,
                [this.propertyKey(result.siid, result.piid)]: result.value,
            };
            device.lastStateAt = new Date();
        }
    }

    private async withCloud<T>(
        account: XiaomiHomeAccount,
        handler: (cloud: XiaomiHomeCloudClient) => Promise<T>,
    ): Promise<T> {
        let token = await this.getAccessToken(account);
        try {
            return await handler(new XiaomiHomeCloudClient(account.cloudServer, token));
        } catch (error) {
            if (!(error instanceof XiaomiHomeCloudError) || !error.unauthorized) throw error;
            token = await this.refreshAccessToken(account);
            return handler(new XiaomiHomeCloudClient(account.cloudServer, token));
        }
    }

    private async getAccessToken(account: XiaomiHomeAccount): Promise<string> {
        if (
            account.accessTokenExpiresAt &&
            account.accessTokenExpiresAt.getTime() <=
                Date.now() + XIAOMI_HOME_TOKEN_REFRESH_MARGIN_MS
        ) {
            return this.refreshAccessToken(account);
        }
        return this.decrypt(account.accessTokenEncrypted);
    }

    private async refreshAccessToken(account: XiaomiHomeAccount): Promise<string> {
        const token = await XiaomiHomeCloudClient.refreshToken({
            cloudServer: account.cloudServer,
            redirectUri: account.oauthRedirectUri,
            refreshToken: this.decrypt(account.refreshTokenEncrypted),
        });
        account.accessTokenEncrypted = this.encrypt(token.access_token);
        account.refreshTokenEncrypted = this.encrypt(token.refresh_token);
        account.accessTokenExpiresAt = new Date(token.expires_ts);
        account.status = XiaomiHomeAccountStatus.ACTIVE;
        account.lastError = null;
        await this.accountRepository.save(account);
        return token.access_token;
    }

    private async recordAccountError(account: XiaomiHomeAccount, error: unknown): Promise<void> {
        account.status =
            error instanceof XiaomiHomeCloudError && error.unauthorized
                ? XiaomiHomeAccountStatus.AUTH_ERROR
                : XiaomiHomeAccountStatus.SYNC_ERROR;
        account.lastError = errorMessage(error);
        await this.accountRepository.save(account);
    }

    private toHttpError(error: unknown) {
        if (error instanceof HttpError) return error;
        if (error instanceof XiaomiHomeCloudError) {
            return error.unauthorized
                ? HttpErrorFactory.unauthorized("小米授权已失效，请重新登录")
                : HttpErrorFactory.badGateway(error.message);
        }
        return HttpErrorFactory.internal(errorMessage(error));
    }

    private async getOwnedAccount(userId: string, accountId: string): Promise<XiaomiHomeAccount> {
        const account = await this.accountRepository.findOne({
            where: { id: accountId, ownerUserId: userId },
        });
        if (!account) throw HttpErrorFactory.notFound("小米智能家居账号不存在");
        return account;
    }

    private async getOwnedDevice(userId: string, deviceId: string): Promise<XiaomiHomeDevice> {
        const device = await this.deviceRepository.findOne({ where: { id: deviceId } });
        if (device) {
            const account = await this.accountRepository.findOne({
                where: { id: device.accountId, ownerUserId: userId },
                select: { id: true },
            });
            if (!account) {
                throw HttpErrorFactory.notFound("小米智能家居设备不存在");
            }
        }
        if (!device) throw HttpErrorFactory.notFound("小米智能家居设备不存在");
        return device;
    }

    private toPublicAccount(
        account: XiaomiHomeAccount,
        deviceCount: number,
        onlineDeviceCount: number,
    ): PublicXiaomiHomeAccount {
        return {
            id: account.id,
            label: account.label,
            cloudServer: account.cloudServer,
            cloudServerLabel: XIAOMI_HOME_SERVERS[account.cloudServer],
            upstreamUserId: account.upstreamUserId,
            nickname: account.nickname,
            status: account.status,
            homes: account.homes,
            deviceCount,
            onlineDeviceCount,
            lastSyncAt: account.lastSyncAt,
            lastError: account.lastError,
            createdAt: account.createdAt,
            updatedAt: account.updatedAt,
        };
    }

    private toPublicDevice(device: XiaomiHomeDevice) {
        return {
            id: device.id,
            accountId: device.accountId,
            did: device.did,
            name: device.name,
            model: device.model,
            urn: device.urn,
            manufacturer: device.manufacturer,
            icon: device.icon,
            category: device.category,
            categoryLabel: getXiaomiHomeCategoryLabel(device.category),
            online: device.online,
            connectType: device.connectType,
            homeId: device.homeId,
            homeName: device.homeName,
            roomId: device.roomId,
            roomName: device.roomName,
            capabilities: device.capabilities,
            state: device.state,
            metadata: device.metadata,
            lastStateAt: device.lastStateAt,
            createdAt: device.createdAt,
            updatedAt: device.updatedAt,
        };
    }

    private async applyPropertyWrites(
        cloud: XiaomiHomeCloudClient,
        capabilities: XiaomiHomeCapability[],
        writes: XiaomiLightWrite[],
    ): Promise<XiaomiLightWrite[]> {
        if (!writes.length) return [];
        let pending = writes;
        const result = await cloud.setProperty(pending);
        const failed = result.find((item) => item.code !== undefined && item.code !== 0);
        if (!failed) return pending;
        if (Number(failed.code) === XIAOMI_MIOT_INVALID_VALUE) {
            const retried = rewriteInvalidBoolWrites(pending, capabilities);
            const same = retried.every((write, index) => write.value === pending[index]?.value);
            if (!same) {
                pending = retried;
                const retryResult = await cloud.setProperty(pending);
                const retryFailed = retryResult.find(
                    (item) => item.code !== undefined && item.code !== 0,
                );
                if (!retryFailed) return pending;
                throw new XiaomiHomeCloudError(`设备拒绝了属性设置（${retryFailed.code}）`);
            }
        }
        throw new XiaomiHomeCloudError(`设备拒绝了属性设置（${failed.code}）`);
    }

    private validateValue(
        capability: Pick<
            XiaomiHomeCapability,
            "format" | "valueRange" | "valueList" | "name" | "unit"
        >,
        value: unknown,
    ): unknown {
        let normalized = value;
        if (isRgbColorCapability(capability)) {
            const rgb = parsePackedRgb(value);
            if (rgb === null) throw HttpErrorFactory.badRequest("颜色值无效");
            normalized = rgb;
        }
        if (capability.format === "bool") {
            if (value === true || value === false) normalized = value;
            else if (value === 1 || value === "1" || value === "true") normalized = true;
            else if (value === 0 || value === "0" || value === "false") normalized = false;
            else throw HttpErrorFactory.badRequest("属性值必须是布尔值");
        } else if (
            [
                "uint8",
                "uint16",
                "uint32",
                "uint64",
                "int8",
                "int16",
                "int32",
                "int64",
                "float",
                "double",
            ].includes(capability.format || "")
        ) {
            const number = typeof normalized === "number" ? normalized : Number(normalized);
            if (!Number.isFinite(number)) throw HttpErrorFactory.badRequest("属性值必须是数字");
            const format = capability.format || "";
            const isInteger = !["float", "double"].includes(format);
            if (isInteger && !Number.isInteger(number)) {
                throw HttpErrorFactory.badRequest("属性值必须是整数");
            }
            if (format.startsWith("uint") && number < 0) {
                throw HttpErrorFactory.badRequest("无符号属性值不能小于 0");
            }
            normalized = number;
        } else if (capability.format === "string") {
            if (typeof value !== "string") throw HttpErrorFactory.badRequest("属性值必须是文本");
        }

        if (
            capability.valueList?.length &&
            !capability.valueList.some((item) => String(item.value) === String(normalized))
        ) {
            throw HttpErrorFactory.badRequest("属性值不在设备允许的选项中");
        }
        if (capability.valueRange && typeof normalized === "number") {
            let numeric = normalized;
            if (isRgbColorCapability(capability) && numeric < capability.valueRange.min) {
                numeric = capability.valueRange.min;
            }
            if (numeric < capability.valueRange.min || numeric > capability.valueRange.max) {
                throw HttpErrorFactory.badRequest(
                    `属性值必须在 ${capability.valueRange.min} 到 ${capability.valueRange.max} 之间`,
                );
            }
            const step = capability.valueRange.step;
            const offset = (numeric - capability.valueRange.min) / step;
            if (Math.abs(offset - Math.round(offset)) > 1e-8) {
                throw HttpErrorFactory.badRequest(`属性值必须按 ${step} 的步长设置`);
            }
            normalized = numeric;
        }
        return normalized;
    }

    private propertyKey(siid: number, piid: number): string {
        return `${siid}.${piid}`;
    }

    private hashState(state: string): string {
        return createHash("sha256").update(state).digest("hex");
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
        if (!iv || !tag || !encrypted) throw new XiaomiHomeCloudError("无效的小米账号凭据", true);
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

    private validOrigin(value: string | undefined, fallback: string): string {
        try {
            const parsed = new URL(value || fallback);
            if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("invalid protocol");
            return parsed.origin;
        } catch {
            return new URL(fallback).origin;
        }
    }

    private assertHttpUrl(value: string, label: string): void {
        try {
            const url = new URL(value);
            if (!["http:", "https:"].includes(url.protocol)) throw new Error("invalid protocol");
        } catch {
            throw HttpErrorFactory.internal(`${label}配置无效`);
        }
    }
}

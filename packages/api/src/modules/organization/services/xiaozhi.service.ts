import { ClassroomKitService } from "@buildingai/core/modules/classroom";
import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import {
    Agent,
    CubeCatDeviceType,
    type CubeCatDeviceTypeValue,
    XiaozhiAccount,
    XiaozhiAccountStatus,
    XiaozhiAgentBinding,
    XiaozhiDeviceProfile,
} from "@buildingai/db/entities";
import { In, IsNull, Repository } from "@buildingai/db/typeorm";
import { HttpErrorFactory } from "@buildingai/errors";
import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";

import { OrganizationPermission } from "../constants/organization-permissions";
import {
    type MappedDevice,
    mapUpstreamChat,
    mapUpstreamChatMessage,
    mapUpstreamDevice,
    summarizeDevices,
    type UpstreamChatMessagePayload,
    type UpstreamChatPayload,
    type UpstreamDevicePayload,
} from "../constants/xiaozhi-mappers";
import type { BindXiaozhiAccountDto, ReconnectXiaozhiAccountDto } from "../dto/organization.dto";
import { OrganizationService } from "./organization.service";
import {
    XIAOZHI_CREDENTIAL_RECOVERY_MESSAGE,
    XiaozhiCredentialCryptoService,
} from "./xiaozhi-credential-crypto.service";
import { XiaozhiMcpGatewayService } from "./xiaozhi-mcp.service";

type LoginChallenge = {
    userId: string;
    organizationId: string;
    cookie: string;
    expiresAt: number;
};

type UpstreamAgent = {
    id: number | string;
    agent_name?: string | null;
    llm_model?: string | null;
    tts_voice?: string | null;
    deviceCount?: number;
    onlineDeviceCount?: number;
    lastDevice?: { last_connected_at?: string | null } | null;
};

type UpstreamPayload<T> = {
    data?: T;
    pagination?: { hasMore?: boolean; total?: number; page?: number; totalPages?: number };
    message?: string;
    error?: string;
};

/** Role-config fields a teacher may lock against student edits. */
export const CONFIG_LOCK_KEYS = [
    "name",
    "language",
    "tts_voice",
    "llm_model",
    "asr_speed",
    "tts_speech_speed",
    "memory_type",
    "tts_pitch",
    "teen_mode",
    "character",
    "knowledge_base_ids",
    "mcp_endpoints",
] as const;

@Injectable()
export class XiaozhiService {
    private readonly challenges = new Map<string, LoginChallenge>();
    private readonly baseUrl = (process.env.XIAOZHI_API_BASE || "https://xiaozhi.me/api").replace(
        /\/$/,
        "",
    );

    constructor(
        @InjectRepository(XiaozhiAccount)
        private readonly accountRepository: Repository<XiaozhiAccount>,
        @InjectRepository(XiaozhiAgentBinding)
        private readonly agentRepository: Repository<XiaozhiAgentBinding>,
        @InjectRepository(XiaozhiDeviceProfile)
        private readonly deviceProfileRepository: Repository<XiaozhiDeviceProfile>,
        @InjectRepository(Agent)
        private readonly buildingAgentRepository: Repository<Agent>,
        private readonly organizationService: OrganizationService,
        private readonly mcpGateway: XiaozhiMcpGatewayService,
        private readonly classroomKit: ClassroomKitService,
        private readonly credentialCrypto: XiaozhiCredentialCryptoService,
    ) {}

    /** xiaozhi credentials are organization assets and never belong to a student workspace. */
    private async requireAccountManager(userId: string, organizationId: string | null | undefined) {
        if (!organizationId) {
            throw HttpErrorFactory.badRequest("小智账号只能由老师或组织管理员在组织工作空间中管理");
        }
        await this.organizationService.requireWorkspace(
            userId,
            organizationId,
            OrganizationPermission.ASSET_MANAGE,
        );
        return organizationId;
    }

    async getCaptcha(userId: string, organizationId: string | null | undefined) {
        const managedOrganizationId = await this.requireAccountManager(userId, organizationId);
        this.cleanupChallenges();
        let response: Response;
        try {
            response = await fetch(`${this.baseUrl}/auth/captcha`, {
                headers: { Accept: "image/svg+xml,text/plain" },
            });
        } catch {
            throw HttpErrorFactory.badGateway("无法连接小智验证码服务");
        }
        const svg = await response.text();
        if (!response.ok) throw HttpErrorFactory.badGateway("无法获取小智图形验证码");

        const challengeId = randomUUID();
        const expiresAt = Date.now() + 5 * 60_000;
        this.challenges.set(challengeId, {
            userId,
            organizationId: managedOrganizationId,
            cookie: this.readSetCookies(response.headers),
            expiresAt,
        });
        return {
            challengeId,
            image: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
            expiresAt: new Date(expiresAt).toISOString(),
        };
    }

    async bindAccount(
        userId: string,
        organizationId: string | null | undefined,
        dto: BindXiaozhiAccountDto,
    ) {
        const managedOrganizationId = await this.requireAccountManager(userId, organizationId);
        await this.ensureCredentialWrite();
        const login = await this.loginUpstream(userId, managedOrganizationId, {
            username: dto.username.trim(),
            password: dto.password,
            captchaCode: dto.captchaCode,
            challengeId: dto.challengeId,
        });
        const account = await this.accountRepository.save(
            this.accountRepository.create({
                organizationId: managedOrganizationId,
                ownerUserId: userId,
                label: dto.label.trim(),
                usernameEncrypted: this.encryptCredential(dto.username.trim()),
                passwordEncrypted: this.encryptCredential(dto.password),
                accessTokenEncrypted: this.encryptCredential(login.token),
                sessionCookieEncrypted: login.sessionCookie
                    ? this.encryptCredential(login.sessionCookie)
                    : null,
                upstreamUserId: login.upstreamUserId,
                status: XiaozhiAccountStatus.ACTIVE,
                lastSyncAt: null,
                lastError: null,
            }),
        );
        try {
            await this.syncAccount(userId, organizationId, account.id);
        } catch {
            // Authentication already succeeded. Keep the encrypted binding so
            // transient upstream errors can be retried without re-entering credentials.
        }
        const current = await this.accountRepository.findOne({ where: { id: account.id } });
        return this.toPublicAccount(current || account);
    }

    async listAccounts(userId: string, organizationId?: string | null) {
        const managedOrganizationId = await this.requireAccountManager(userId, organizationId);
        await this.ensureCredentialRead();
        const accounts = await this.accountRepository.find({
            where: { organizationId: managedOrganizationId },
            order: { createdAt: "ASC" },
        });
        return accounts.map((account) => this.toPublicAccount(account));
    }

    async listAgents(userId: string, organizationId?: string | null) {
        const access = await this.organizationService.requireWorkspace(userId, organizationId);
        if (access.type === "organization") {
            const canReadAll = access.permissions.includes(OrganizationPermission.ASSET_READ);
            return this.agentRepository.find({
                where: canReadAll
                    ? { organizationId: access.organizationId }
                    : { organizationId: access.organizationId, assignedUserId: userId },
                order: { name: "ASC" },
            });
        }
        return this.agentRepository.find({
            where: { organizationId: IsNull(), ownerUserId: userId },
            order: { name: "ASC" },
        });
    }

    /**
     * Flatten devices from every xiaozhi agent the caller can access. Device
     * profiles are local-only metadata, while live state remains sourced from
     * xiaozhi.me.
     */
    async listAllDevices(userId: string, organizationId?: string | null) {
        const access = await this.organizationService.requireWorkspace(userId, organizationId);
        const agents = await this.listAgents(userId, organizationId);
        if (!agents.length) return [];

        const accountIds = [...new Set(agents.map((agent) => agent.xiaozhiAccountId))];
        const [accounts, profiles] = await Promise.all([
            this.accountRepository.find({ where: { id: In(accountIds) } }),
            this.deviceProfileRepository.find({
                where: { agentBindingId: In(agents.map((agent) => agent.id)) },
            }),
        ]);
        const accountMap = new Map(accounts.map((account) => [account.id, account]));
        const profileMap = new Map(
            profiles.map((profile) => [
                `${profile.agentBindingId}:${profile.upstreamDeviceId}`,
                profile,
            ]),
        );
        const canSetDeviceType =
            access.type === "organization" &&
            access.permissions.includes(OrganizationPermission.ASSET_MANAGE);

        const results = await Promise.allSettled(
            agents.map(async (agent) => {
                const account = accountMap.get(agent.xiaozhiAccountId);
                if (!account) throw HttpErrorFactory.notFound("方糖猫所属的小智账号不存在");
                const result = await this.request<UpstreamDevicePayload[]>(
                    account,
                    `/agents/${agent.upstreamAgentId}/devices`,
                );
                const devices = (result.data || []).map((device) =>
                    mapUpstreamDevice(device, agent.id),
                );
                await this.refreshDeviceCounters(agent, devices);
                return devices.map((device) => {
                    const profile = profileMap.get(`${agent.id}:${device.id}`);
                    const deviceType = profile?.deviceType || CubeCatDeviceType.UNKNOWN;
                    const canManage =
                        access.type === "personal" ||
                        access.permissions.includes(OrganizationPermission.ASSET_MANAGE) ||
                        agent.assignedUserId === userId;
                    return {
                        ...device,
                        deviceType,
                        deviceTypeLabel:
                            deviceType === CubeCatDeviceType.UNKNOWN ? "型号待指定" : deviceType,
                        agentName: agent.name,
                        upstreamAgentId: agent.upstreamAgentId,
                        linkedAgentId: agent.linkedAgentId,
                        linkedAgentName: agent.linkedAgentName,
                        model: agent.model,
                        voice: agent.voice,
                        agentDeviceCount: devices.length,
                        settings: profile?.settings || {
                            volume: 65,
                            brightness: 70,
                            doNotDisturb: false,
                        },
                        canManage,
                        canSetDeviceType,
                    };
                });
            }),
        );

        const fulfilled = results.filter((result) => result.status === "fulfilled");
        if (!fulfilled.length) {
            const failure = results.find(
                (result): result is PromiseRejectedResult => result.status === "rejected",
            );
            throw failure?.reason || HttpErrorFactory.badGateway("无法读取方糖猫设备");
        }

        return fulfilled
            .flatMap((result) => result.value)
            .sort(
                (left, right) =>
                    Number(right.online) - Number(left.online) ||
                    (left.alias || left.macAddress).localeCompare(right.alias || right.macAddress),
            );
    }

    /** Consume a captcha challenge and log into the upstream console. */
    private async loginUpstream(
        userId: string,
        organizationId: string,
        input: { username: string; password: string; captchaCode: string; challengeId: string },
    ) {
        this.cleanupChallenges();
        const challenge = this.challenges.get(input.challengeId);
        if (
            !challenge ||
            challenge.userId !== userId ||
            challenge.organizationId !== organizationId
        ) {
            throw HttpErrorFactory.badRequest("验证码已过期，请刷新后重试");
        }
        this.challenges.delete(input.challengeId);

        let response: Response;
        try {
            response = await fetch(`${this.baseUrl}/auth/login`, {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    Cookie: challenge.cookie,
                },
                body: JSON.stringify({
                    username: input.username,
                    password: input.password,
                    captcha_code: input.captchaCode.trim(),
                }),
            });
        } catch {
            throw HttpErrorFactory.badGateway("无法连接小智登录服务");
        }
        const payload = (await this.parseResponse(response)) as UpstreamPayload<{
            token?: string;
            user?: Record<string, unknown>;
        }>;
        if (!response.ok || !payload.data?.token) {
            throw HttpErrorFactory.badRequest(
                payload.message || payload.error || "小智账号登录失败",
            );
        }

        const upstreamUser = payload.data.user || {};
        const upstreamUserId = upstreamUser.id ?? upstreamUser.user_id ?? null;
        return {
            token: payload.data.token,
            sessionCookie: this.mergeCookies(
                challenge.cookie,
                this.readSetCookies(response.headers),
            ),
            upstreamUserId: upstreamUserId === null ? null : String(upstreamUserId),
        };
    }

    /** Resolve one account inside the caller's workspace; managers only. */
    private async resolveManagedAccount(
        userId: string,
        organizationId: string | null | undefined,
        accountId: string,
    ) {
        const managedOrganizationId = await this.requireAccountManager(userId, organizationId);
        const account = await this.accountRepository.findOne({
            where: { id: accountId, organizationId: managedOrganizationId },
        });
        if (!account) throw HttpErrorFactory.notFound("小智账号不存在");
        return account;
    }

    async reconnectAccount(
        userId: string,
        organizationId: string | null | undefined,
        accountId: string,
        dto: ReconnectXiaozhiAccountDto,
    ) {
        const account = await this.resolveManagedAccount(userId, organizationId, accountId);
        await this.ensureCredentialWrite();
        const username = dto.username?.trim() || this.decryptForRecovery(account.usernameEncrypted);
        const password = dto.password || this.decryptForRecovery(account.passwordEncrypted);
        const login = await this.loginUpstream(userId, account.organizationId as string, {
            username,
            password,
            captchaCode: dto.captchaCode,
            challengeId: dto.challengeId,
        });
        account.usernameEncrypted = this.encryptCredential(username);
        account.passwordEncrypted = this.encryptCredential(password);
        account.accessTokenEncrypted = this.encryptCredential(login.token);
        account.sessionCookieEncrypted = login.sessionCookie
            ? this.encryptCredential(login.sessionCookie)
            : null;
        account.upstreamUserId = login.upstreamUserId ?? account.upstreamUserId;
        account.status = XiaozhiAccountStatus.ACTIVE;
        account.lastError = null;
        await this.accountRepository.save(account);
        try {
            await this.syncAccount(userId, organizationId, account.id);
        } catch {
            // Login already succeeded; sync failures surface via account status.
        }
        const current = await this.accountRepository.findOne({ where: { id: account.id } });
        return this.toPublicAccount(current || account);
    }

    async updateAccountLabel(
        userId: string,
        organizationId: string | null | undefined,
        accountId: string,
        label: string,
    ) {
        const account = await this.resolveManagedAccount(userId, organizationId, accountId);
        account.label = label.trim();
        await this.accountRepository.save(account);
        return this.toPublicAccount(account);
    }

    /**
     * Remove the local binding only — the upstream xiaozhi account and its
     * agents/devices stay untouched and can be re-bound later.
     */
    async removeAccount(
        userId: string,
        organizationId: string | null | undefined,
        accountId: string,
    ) {
        const account = await this.resolveManagedAccount(userId, organizationId, accountId);
        const agents = await this.agentRepository.find({
            where: { xiaozhiAccountId: account.id },
        });
        if (agents.length) await this.agentRepository.softRemove(agents);
        await this.accountRepository.softRemove(account);
        return { success: true, removed: account.label };
    }

    async deleteAgent(userId: string, organizationId: string | null | undefined, agentId: string) {
        const { agent, account } = await this.resolveAgent(userId, organizationId, agentId, true);
        await this.request(account, "/agents/delete", {
            method: "POST",
            body: { id: Number(agent.upstreamAgentId) },
        });
        await this.agentRepository.softRemove(agent);
        return { success: true };
    }

    async syncAccount(
        userId: string,
        organizationId: string | null | undefined,
        accountId: string,
    ) {
        const account = await this.resolveManagedAccount(userId, organizationId, accountId);

        try {
            const agents: UpstreamAgent[] = [];
            for (let page = 1; page <= 50; page += 1) {
                const result = await this.request<UpstreamAgent[]>(
                    account,
                    `/agents?page=${page}&pageSize=100&summary=true`,
                );
                agents.push(...(result.data || []));
                if (!result.pagination?.hasMore) break;
            }

            const existing = await this.agentRepository.find({
                where: { xiaozhiAccountId: account.id },
            });
            const existingMap = new Map(existing.map((item) => [item.upstreamAgentId, item]));
            const saved = [];
            for (const agent of agents) {
                const upstreamAgentId = String(agent.id);
                const binding =
                    existingMap.get(upstreamAgentId) ||
                    this.agentRepository.create({
                        xiaozhiAccountId: account.id,
                        organizationId: account.organizationId,
                        ownerUserId: account.ownerUserId,
                        upstreamAgentId,
                        assignedUserId: null,
                    });
                binding.name = agent.agent_name?.trim() || `智能体 ${upstreamAgentId}`;
                binding.model = agent.llm_model || null;
                binding.voice = agent.tts_voice || null;
                binding.deviceCount = Number(agent.deviceCount || 0);
                binding.onlineDeviceCount = Number(agent.onlineDeviceCount || 0);
                binding.lastConnectedAt = agent.lastDevice?.last_connected_at
                    ? new Date(agent.lastDevice.last_connected_at)
                    : null;
                saved.push(await this.agentRepository.save(binding));
            }

            account.status = XiaozhiAccountStatus.ACTIVE;
            account.lastSyncAt = new Date();
            account.lastError = null;
            await this.accountRepository.save(account);
            return { synced: saved.length, agents: saved };
        } catch (error) {
            account.status =
                (error as { status?: number })?.status === 401
                    ? XiaozhiAccountStatus.AUTH_ERROR
                    : XiaozhiAccountStatus.SYNC_ERROR;
            account.lastError = error instanceof Error ? error.message.slice(0, 1000) : "同步失败";
            await this.accountRepository.save(account);
            throw error;
        }
    }

    async assignAgent(
        userId: string,
        organizationId: string | null | undefined,
        agentId: string,
        assignedUserId: string | null,
    ) {
        if (!organizationId) throw HttpErrorFactory.badRequest("个人空间设备不能分发给组织成员");
        await this.organizationService.requireWorkspace(
            userId,
            organizationId,
            OrganizationPermission.ASSET_MANAGE,
        );
        if (assignedUserId) {
            await this.organizationService.assertAssignableMember(organizationId, assignedUserId);
        }
        const agent = await this.agentRepository.findOne({
            where: { id: agentId, organizationId },
        });
        if (!agent) throw HttpErrorFactory.notFound("方糖猫智能体不存在");
        agent.assignedUserId = assignedUserId || null;
        return this.agentRepository.save(agent);
    }

    /**
     * Resolve one agent binding inside the caller's current workspace.
     *
     * Students only ever reach agents distributed to them, so read paths stay
     * scoped without a second permission check. Anything that mutates upstream
     * state passes `requireManage` and is limited to asset managers.
     */
    private async resolveAgent(
        userId: string,
        organizationId: string | null | undefined,
        agentId: string,
        requireManage = false,
    ) {
        const access = await this.organizationService.requireWorkspace(
            userId,
            organizationId,
            organizationId && requireManage ? OrganizationPermission.ASSET_MANAGE : undefined,
        );

        const agent = await this.agentRepository.findOne({
            where:
                access.type === "organization"
                    ? { id: agentId, organizationId: access.organizationId as string }
                    : { id: agentId, organizationId: IsNull(), ownerUserId: userId },
        });
        if (!agent) throw HttpErrorFactory.notFound("方糖猫智能体不存在");

        if (
            access.type === "organization" &&
            !access.permissions.includes(OrganizationPermission.ASSET_READ) &&
            agent.assignedUserId !== userId
        ) {
            throw HttpErrorFactory.forbidden("该方糖猫没有分发给你");
        }

        const account = await this.accountRepository.findOne({
            where: { id: agent.xiaozhiAccountId },
        });
        if (!account) throw HttpErrorFactory.notFound("方糖猫所属的小智账号不存在");
        return { access, agent, account };
    }

    async listDevicesForUser(userId: string, agentId: string) {
        const agent = await this.agentRepository.findOne({ where: { id: agentId } });
        if (!agent) throw HttpErrorFactory.notFound("CubeCat 不存在");
        return this.listDevices(userId, agent.organizationId, agentId);
    }

    async requireAccessibleAgent(userId: string, agentId: string) {
        const agent = await this.agentRepository.findOne({ where: { id: agentId } });
        if (!agent) throw HttpErrorFactory.notFound("CubeCat 不存在");
        await this.resolveAgent(userId, agent.organizationId, agentId);
        return agent;
    }

    async listDevices(userId: string, organizationId: string | null | undefined, agentId: string) {
        const { agent, account } = await this.resolveAgent(userId, organizationId, agentId);
        const result = await this.request<UpstreamDevicePayload[]>(
            account,
            `/agents/${agent.upstreamAgentId}/devices`,
        );
        const devices = (result.data || []).map((device) => mapUpstreamDevice(device, agent.id));
        await this.refreshDeviceCounters(agent, devices);
        return devices;
    }

    async bindDevice(
        userId: string,
        organizationId: string | null | undefined,
        agentId: string,
        verificationCode: string,
    ) {
        const { agent, account } = await this.resolveAgent(userId, organizationId, agentId, true);
        await this.request(account, `/agents/${agent.upstreamAgentId}/devices`, {
            method: "POST",
            body: { verificationCode: verificationCode.trim() },
        });
        return { success: true };
    }

    async updateDeviceAlias(
        userId: string,
        organizationId: string | null | undefined,
        agentId: string,
        input: { macAddress: string; alias: string },
    ) {
        const { agent, account } = await this.resolveLinkableAgent(userId, organizationId, agentId);
        await this.request(account, `/agents/${agent.upstreamAgentId}/devices/update-alias`, {
            method: "POST",
            body: { macAddress: input.macAddress, alias: input.alias.trim() },
        });
        return { success: true };
    }

    async updateDeviceAutoUpdate(
        userId: string,
        organizationId: string | null | undefined,
        agentId: string,
        input: { macAddress: string; autoUpdate: boolean },
    ) {
        const { agent, account } = await this.resolveLinkableAgent(userId, organizationId, agentId);
        await this.request(account, `/agents/${agent.upstreamAgentId}/devices/update-auto-update`, {
            method: "POST",
            body: { macAddress: input.macAddress, autoUpdate: input.autoUpdate },
        });
        return { success: true };
    }

    async updateDeviceType(
        userId: string,
        organizationId: string | null | undefined,
        agentId: string,
        deviceId: number,
        deviceType: CubeCatDeviceTypeValue,
    ) {
        if (!organizationId) {
            throw HttpErrorFactory.forbidden("设备型号由组织管理员或老师指定");
        }
        const { agent, account } = await this.resolveAgent(userId, organizationId, agentId, true);
        const result = await this.request<UpstreamDevicePayload[]>(
            account,
            `/agents/${agent.upstreamAgentId}/devices`,
        );
        if (!(result.data || []).some((device) => Number(device.id) === deviceId)) {
            throw HttpErrorFactory.notFound("方糖猫设备不存在");
        }

        let profile = await this.deviceProfileRepository.findOne({
            where: { agentBindingId: agent.id, upstreamDeviceId: String(deviceId) },
            withDeleted: true,
        });
        if (!profile) {
            profile = this.deviceProfileRepository.create({
                agentBindingId: agent.id,
                upstreamDeviceId: String(deviceId),
                deviceType,
            });
        } else {
            profile.deletedAt = null;
            profile.deviceType = deviceType;
        }
        return this.deviceProfileRepository.save(profile);
    }

    async updateDeviceSettings(
        userId: string,
        organizationId: string | null | undefined,
        agentId: string,
        deviceId: number,
        settings: { volume?: number; brightness?: number; doNotDisturb?: boolean },
    ) {
        const { agent, account } = await this.resolveLinkableAgent(userId, organizationId, agentId);
        const result = await this.request<UpstreamDevicePayload[]>(
            account,
            `/agents/${agent.upstreamAgentId}/devices`,
        );
        if (!(result.data || []).some((device) => Number(device.id) === deviceId)) {
            throw HttpErrorFactory.notFound("方糖猫设备不存在");
        }

        let profile = await this.deviceProfileRepository.findOne({
            where: { agentBindingId: agent.id, upstreamDeviceId: String(deviceId) },
            withDeleted: true,
        });
        if (!profile) {
            profile = this.deviceProfileRepository.create({
                agentBindingId: agent.id,
                upstreamDeviceId: String(deviceId),
                deviceType: CubeCatDeviceType.UNKNOWN,
                settings: { volume: 65, brightness: 70, doNotDisturb: false },
            });
        } else {
            profile.deletedAt = null;
        }
        profile.settings = { ...profile.settings, ...settings };
        return this.deviceProfileRepository.save(profile);
    }

    async unbindDevice(
        userId: string,
        organizationId: string | null | undefined,
        agentId: string,
        deviceId: number,
    ) {
        const { agent, account } = await this.resolveAgent(userId, organizationId, agentId, true);
        await this.request(account, `/agents/${agent.upstreamAgentId}/devices/delete`, {
            method: "POST",
            body: { deviceId },
        });
        return { success: true };
    }

    /**
     * Load everything the agent editor needs in one round trip: the agent
     * config plus the voice, model, MCP tool and knowledge base enumerations
     * that the upstream console scopes to the agent's template.
     */
    async getAgentEditorData(
        userId: string,
        organizationId: string | null | undefined,
        agentId: string,
    ) {
        const { agent, account } = await this.resolveAgent(userId, organizationId, agentId);
        const detail = await this.request<{
            agent?: { agent_template_id?: number | null } & Record<string, unknown>;
        }>(account, `/agents/${agent.upstreamAgentId}`);
        const config = detail.data?.agent;
        if (!config) throw HttpErrorFactory.badGateway("小智智能体详情响应不完整");

        const templateId = config.agent_template_id;
        const suffix =
            typeof templateId === "number" && templateId > 0
                ? `?agent_template_id=${templateId}`
                : "";
        const [ttsResult, modelResult, mcpResult, knowledgeResult] = await Promise.all([
            this.request<{ languages?: string[]; tts_voices?: Record<string, unknown[]> }>(
                account,
                `/user/tts-list${suffix}`,
            ),
            this.request<{ modelList?: unknown[] }>(account, `/roles/model-list${suffix}`),
            this.request<unknown[]>(
                account,
                `/agents/common-mcp-tool/list?agentId=${agent.upstreamAgentId}`,
            ),
            this.request<{ list?: unknown[] }>(account, `/knowledge-bases/enum${suffix}`),
        ]);

        return {
            agentId: agent.id,
            name: agent.name,
            config,
            ttsList: {
                languages: ttsResult.data?.languages || [],
                ttsVoices: ttsResult.data?.tts_voices || {},
            },
            models: modelResult.data?.modelList || [],
            mcpTools: mcpResult.data || [],
            knowledgeBases: knowledgeResult.data?.list || [],
        };
    }

    /**
     * Read the full upstream config of one agent, for scene capture. Returns
     * the raw upstream agent object; callers pick the fields they persist.
     */
    async captureAgentConfig(
        userId: string,
        organizationId: string | null | undefined,
        agentId: string,
    ) {
        const { agent, account } = await this.resolveAgent(userId, organizationId, agentId, true);
        const detail = await this.request<{ agent?: Record<string, unknown> }>(
            account,
            `/agents/${agent.upstreamAgentId}`,
        );
        const config = detail.data?.agent;
        if (!config) throw HttpErrorFactory.badGateway("小智智能体详情响应不完整");
        return { agent, config };
    }

    /** Whether the workspace access grants full asset management rights. */
    private isAssetManager(access: Awaited<ReturnType<OrganizationService["requireWorkspace"]>>) {
        return (
            access.type === "personal" ||
            access.permissions.includes(OrganizationPermission.ASSET_MANAGE)
        );
    }

    /** Update which config fields are locked against student edits. */
    async updateConfigLocks(
        userId: string,
        organizationId: string | null | undefined,
        agentId: string,
        keys: string[],
    ) {
        const { agent } = await this.resolveAgent(userId, organizationId, agentId, true);
        const allowed = new Set<string>(CONFIG_LOCK_KEYS);
        agent.lockedConfigKeys = [...new Set(keys.filter((key) => allowed.has(key)))];
        return this.agentRepository.save(agent);
    }

    async renameAgent(
        userId: string,
        organizationId: string | null | undefined,
        agentId: string,
        name: string,
    ) {
        const { access, agent, account } = await this.resolveLinkableAgent(
            userId,
            organizationId,
            agentId,
        );
        if (!this.isAssetManager(access) && agent.lockedConfigKeys?.includes("name")) {
            throw HttpErrorFactory.forbidden("智能体名称已被老师锁定，无法修改");
        }
        await this.request(account, "/agents/update-name", {
            method: "POST",
            body: { id: Number(agent.upstreamAgentId), name: name.trim() },
        });
        agent.name = name.trim();
        return this.agentRepository.save(agent);
    }

    async updateAgentConfig(
        userId: string,
        organizationId: string | null | undefined,
        agentId: string,
        config: Record<string, unknown>,
    ) {
        const { access, agent, account } = await this.resolveLinkableAgent(
            userId,
            organizationId,
            agentId,
        );

        // Students edit the config of their own cubecat, but locked fields
        // are forced back to the current upstream values before saving.
        let payload = config;
        if (!this.isAssetManager(access)) {
            const locked = (agent.lockedConfigKeys || []).filter((key) => key !== "name");
            if (locked.length) {
                const detail = await this.request<{ agent?: Record<string, unknown> }>(
                    account,
                    `/agents/${agent.upstreamAgentId}`,
                );
                const current = detail.data?.agent || {};
                payload = { ...config };
                for (const key of locked) {
                    if (key in current) payload[key] = current[key];
                    else delete payload[key];
                }
            }
        }

        await this.request(account, `/agents/${agent.upstreamAgentId}/config`, {
            method: "POST",
            body: payload,
        });

        // Mirror the fields the agent list renders so the UI stays consistent
        // without waiting for a full account sync.
        const model = payload.llm_model ?? payload.model;
        const voice = payload.tts_voice ?? payload.voice;
        if (typeof model === "string") agent.model = model;
        if (typeof voice === "string") agent.voice = voice;
        return this.agentRepository.save(agent);
    }

    /**
     * Resolve an agent for the self-service link feature: managers can touch
     * any workspace agent, and a student can touch the agent distributed to
     * them — this is the one deliberate write path students have.
     *
     * It is also where a running classroom app session locks students out. An
     * app takes over the device by rewriting its role prompt (that plus the
     * tool table is all a cubecat responds to), so a student who could still
     * edit their own device could simply undo the takeover. Managers stay
     * unaffected — the app's own writes run as the teacher who started it.
     */
    private async resolveLinkableAgent(
        userId: string,
        organizationId: string | null | undefined,
        agentId: string,
    ) {
        const resolved = await this.resolveAgent(userId, organizationId, agentId);
        const { access, agent } = resolved;
        const canWrite =
            access.type === "personal" ||
            access.permissions.includes(OrganizationPermission.ASSET_MANAGE) ||
            agent.assignedUserId === userId;
        if (!canWrite) throw HttpErrorFactory.forbidden("该方糖猫没有分发给你");
        if (
            !this.isAssetManager(access) &&
            (await this.classroomKit.isDeviceLockedForStudents(agent.id))
        ) {
            throw HttpErrorFactory.forbidden("课堂活动进行中，暂时无法修改这台方糖猫的设置");
        }
        return resolved;
    }

    /** Render the role prompt with its saved form-variable inputs. */
    private composeCharacter(buildingAgent: Agent) {
        const inputs = buildingAgent.formFieldsInputs || {};
        const substitute = (text: string) =>
            text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key: string) => {
                const value = inputs[key];
                return value === undefined || value === null ? match : String(value);
            });

        const parts = [substitute(buildingAgent.rolePrompt || "").trim()];
        const opening = substitute(buildingAgent.openingStatement || "").trim();
        if (opening) parts.push(`对话开始时，请先说：${opening}`);
        return parts.filter(Boolean).join("\n\n").slice(0, 12000);
    }

    /**
     * Push a character prompt upstream while keeping every other config field
     * as-is (the upstream config endpoint expects the full object).
     */
    private async pushCharacter(
        account: XiaozhiAccount,
        agent: XiaozhiAgentBinding,
        character: string,
    ) {
        const detail = await this.request<{ agent?: Record<string, unknown> }>(
            account,
            `/agents/${agent.upstreamAgentId}`,
        );
        const current = detail.data?.agent;
        if (!current) throw HttpErrorFactory.badGateway("小智智能体详情响应不完整");
        const config = Object.fromEntries(
            [
                "language",
                "tts_voice",
                "asr_speed",
                "tts_speech_speed",
                "tts_pitch",
                "llm_model",
                "memory_type",
                "teen_mode",
                "mcp_endpoints",
                "knowledge_base_ids",
            ].flatMap((key) => (key in current ? [[key, current[key]]] : [])),
        );
        await this.request(account, `/agents/${agent.upstreamAgentId}/config`, {
            method: "POST",
            body: { ...config, character },
        });
    }

    /**
     * Workflow runtime has no organization header. Resolve the agent by id,
     * check the caller can write it, then replace the device character prompt.
     */
    async switchCharacterForUser(userId: string, agentId: string, character: string) {
        const agent = await this.agentRepository.findOne({ where: { id: agentId } });
        if (!agent) throw HttpErrorFactory.notFound("方糖猫智能体不存在");

        const access = await this.organizationService.requireWorkspace(
            userId,
            agent.organizationId,
        );
        const canWrite =
            access.type === "personal" ||
            access.permissions.includes(OrganizationPermission.ASSET_MANAGE) ||
            agent.assignedUserId === userId;
        if (!canWrite) throw HttpErrorFactory.forbidden("该方糖猫没有分发给你");
        if (
            !this.isAssetManager(access) &&
            (await this.classroomKit.isDeviceLockedForStudents(agent.id))
        ) {
            throw HttpErrorFactory.forbidden("课堂活动进行中，暂时无法修改这台方糖猫的设置");
        }
        if (!this.isAssetManager(access) && agent.lockedConfigKeys?.includes("character")) {
            throw HttpErrorFactory.forbidden("角色提示词已被老师锁定，无法由工作流修改");
        }

        const account = await this.accountRepository.findOne({
            where: { id: agent.xiaozhiAccountId },
        });
        if (!account) throw HttpErrorFactory.notFound("方糖猫所属的小智账号不存在");

        const detail = await this.request<{ agent?: Record<string, unknown> }>(
            account,
            `/agents/${agent.upstreamAgentId}`,
        );
        const current = detail.data?.agent;
        if (!current) throw HttpErrorFactory.badGateway("小智智能体详情响应不完整");
        const previousCharacter = typeof current.character === "string" ? current.character : "";

        await this.pushCharacter(account, agent, character);
        return { previousCharacter, agentName: agent.name };
    }

    /**
     * Link (or unlink with a null id) a BuildingAI agent to this xiaozhi
     * agent and immediately sync its role prompt into the device character.
     */
    async linkBuildingAgent(
        userId: string,
        organizationId: string | null | undefined,
        agentId: string,
        buildingAgentId: string | null,
    ) {
        const { agent, account } = await this.resolveLinkableAgent(userId, organizationId, agentId);

        if (!buildingAgentId) {
            agent.linkedAgentId = null;
            agent.linkedAgentName = null;
            agent.linkedAgentSyncedAt = null;
            const saved = await this.agentRepository.save(agent);
            void this.mcpGateway.reloadAgentTools(agent.id);
            return saved;
        }

        const buildingAgent = await this.buildingAgentRepository.findOne({
            where: { id: buildingAgentId, createBy: userId },
        });
        if (!buildingAgent) {
            throw HttpErrorFactory.notFound("智能体不存在，只能绑定自己创建的智能体");
        }
        const character = this.composeCharacter(buildingAgent);
        if (!character) {
            throw HttpErrorFactory.badRequest("该智能体还没有角色设定，请先在智能体编辑页填写");
        }

        await this.pushCharacter(account, agent, character);
        agent.linkedAgentId = buildingAgent.id;
        agent.linkedAgentName = buildingAgent.name;
        agent.linkedAgentSyncedAt = new Date();
        const saved = await this.agentRepository.save(agent);
        // The linked agent's MCP servers ride along on the device's MCP
        // connection; refresh the gateway's tool list in the background.
        void this.mcpGateway.reloadAgentTools(agent.id);
        return saved;
    }

    /** Re-push the linked BuildingAI agent's current role prompt. */
    async syncLinkedBuildingAgent(
        userId: string,
        organizationId: string | null | undefined,
        agentId: string,
    ) {
        const { agent, account } = await this.resolveLinkableAgent(userId, organizationId, agentId);
        if (!agent.linkedAgentId) {
            throw HttpErrorFactory.badRequest("该方糖猫还没有绑定智能体");
        }
        const buildingAgent = await this.buildingAgentRepository.findOne({
            where: { id: agent.linkedAgentId },
        });
        if (!buildingAgent) {
            agent.linkedAgentId = null;
            agent.linkedAgentName = null;
            agent.linkedAgentSyncedAt = null;
            await this.agentRepository.save(agent);
            throw HttpErrorFactory.notFound("绑定的智能体已被删除，绑定已自动解除");
        }
        const character = this.composeCharacter(buildingAgent);
        if (!character) {
            throw HttpErrorFactory.badRequest("该智能体还没有角色设定，请先在智能体编辑页填写");
        }
        await this.pushCharacter(account, agent, character);
        agent.linkedAgentName = buildingAgent.name;
        agent.linkedAgentSyncedAt = new Date();
        const saved = await this.agentRepository.save(agent);
        void this.mcpGateway.reloadAgentTools(agent.id);
        return saved;
    }

    /**
     * Publish one BuildingAI agent onto a xiaozhi agent group. The prompt
     * defaults to the saved BuildingAI role, and the client may override
     * character plus the usual device voice/model settings before push.
     */
    async publishBuildingAgent(
        userId: string,
        organizationId: string | null | undefined,
        buildingAgentId: string,
        input: {
            targetAgentId: string;
            model: string;
            voice: string;
            language?: string;
            character?: string;
            asrSpeed?: "slow" | "normal" | "fast";
            ttsSpeechSpeed?: "slow" | "normal" | "fast";
            ttsPitch?: number;
            memoryType?: "OFF" | "SHORT_TERM" | "LONG_TERM";
            teenMode?: boolean;
        },
    ) {
        const buildingAgent = await this.buildingAgentRepository.findOne({
            where: { id: buildingAgentId, createBy: userId },
        });
        if (!buildingAgent) {
            throw HttpErrorFactory.notFound("智能体不存在，只能发布自己创建的智能体");
        }
        const character =
            input.character?.trim().slice(0, 12000) || this.composeCharacter(buildingAgent);
        if (!character) {
            throw HttpErrorFactory.badRequest("请先填写智能体的角色设定再发布到方糖猫");
        }

        const { agent, account } = await this.resolveLinkableAgent(
            userId,
            organizationId,
            input.targetAgentId,
        );
        const detail = await this.request<{
            agent?: { agent_template_id?: number | null } & Record<string, unknown>;
        }>(account, `/agents/${agent.upstreamAgentId}`);
        const current = detail.data?.agent;
        if (!current) throw HttpErrorFactory.badGateway("小智智能体详情响应不完整");

        const templateId = current.agent_template_id;
        const suffix =
            typeof templateId === "number" && templateId > 0
                ? `?agent_template_id=${templateId}`
                : "";
        const [modelResult, ttsResult] = await Promise.all([
            this.request<{ modelList?: Array<Record<string, unknown>> }>(
                account,
                `/roles/model-list${suffix}`,
            ),
            this.request<{
                languages?: string[];
                tts_voices?: Record<string, Array<Record<string, unknown>>>;
            }>(account, `/user/tts-list${suffix}`),
        ]);

        const models = modelResult.data?.modelList || [];
        const modelIds = new Set(
            models.flatMap((model) =>
                [model.name, model.model, model.model_name]
                    .filter((value): value is string => typeof value === "string")
                    .map((value) => value.trim()),
            ),
        );
        if (modelIds.size && !modelIds.has(input.model.trim())) {
            throw HttpErrorFactory.badRequest("所选模型不属于这只方糖猫的可用模型");
        }

        const voicesByLanguage = ttsResult.data?.tts_voices || {};
        const voiceIds = new Set(
            Object.values(voicesByLanguage).flatMap((voices) =>
                voices.flatMap((voice) =>
                    [voice.voice_id, voice.id]
                        .filter((value): value is string => typeof value === "string")
                        .map((value) => value.trim()),
                ),
            ),
        );
        if (voiceIds.size && !voiceIds.has(input.voice.trim())) {
            throw HttpErrorFactory.badRequest("所选音色不属于这只方糖猫的可用音色");
        }
        if (
            input.language &&
            (ttsResult.data?.languages || []).length &&
            !ttsResult.data?.languages?.includes(input.language)
        ) {
            throw HttpErrorFactory.badRequest("所选语言不受这只方糖猫支持");
        }

        const config = Object.fromEntries(
            [
                "language",
                "tts_voice",
                "asr_speed",
                "tts_speech_speed",
                "tts_pitch",
                "llm_model",
                "memory_type",
                "teen_mode",
                "mcp_endpoints",
                "knowledge_base_ids",
            ].flatMap((key) => (key in current ? [[key, current[key]]] : [])),
        );
        await this.request(account, `/agents/${agent.upstreamAgentId}/config`, {
            method: "POST",
            body: {
                ...config,
                ...(input.language ? { language: input.language } : {}),
                ...(input.asrSpeed ? { asr_speed: input.asrSpeed } : {}),
                ...(input.ttsSpeechSpeed ? { tts_speech_speed: input.ttsSpeechSpeed } : {}),
                ...(input.ttsPitch !== undefined ? { tts_pitch: input.ttsPitch } : {}),
                ...(input.memoryType ? { memory_type: input.memoryType } : {}),
                ...(input.teenMode !== undefined ? { teen_mode: input.teenMode } : {}),
                llm_model: input.model.trim(),
                tts_voice: input.voice.trim(),
                character,
            },
        });

        agent.model = input.model.trim();
        agent.voice = input.voice.trim();
        agent.linkedAgentId = buildingAgent.id;
        agent.linkedAgentName = buildingAgent.name;
        agent.linkedAgentSyncedAt = new Date();
        const saved = await this.agentRepository.save(agent);
        void this.mcpGateway.reloadAgentTools(agent.id);
        return {
            agent: saved,
            affectedDevices: saved.deviceCount,
            publishedAt: saved.linkedAgentSyncedAt,
        };
    }

    async listAgentChats(
        userId: string,
        organizationId: string | null | undefined,
        agentId: string,
        pageSize = 20,
    ) {
        const { agent, account } = await this.resolveAgent(userId, organizationId, agentId);
        const result = await this.request<{ list?: UpstreamChatPayload[] }>(
            account,
            `/chats/list?agentId=${agent.upstreamAgentId}&page=1&pageSize=${pageSize}`,
        );
        return (result.data?.list || []).map((chat) => mapUpstreamChat(chat, agent.id, agent.name));
    }

    async listChatMessages(
        userId: string,
        organizationId: string | null | undefined,
        agentId: string,
        chatId: number,
    ) {
        const { account } = await this.resolveAgent(userId, organizationId, agentId);
        const result = await this.request<{ list?: UpstreamChatMessagePayload[] }>(
            account,
            `/chats/messages?chatId=${chatId}&page=1&pageSize=100&includeTools=1&order=asc`,
        );
        return (result.data?.list || []).map((message) => mapUpstreamChatMessage(message, chatId));
    }

    /**
     * Keep the cached device counters aligned with what the console just read,
     * so the agent list does not drift until the next full account sync.
     */
    private async refreshDeviceCounters(agent: XiaozhiAgentBinding, devices: MappedDevice[]) {
        const summary = summarizeDevices(devices);
        // Keep the previously known timestamp when upstream reports no
        // connection history, so a transient empty read does not erase it.
        const lastConnectedAt = summary.lastConnectedAt ?? agent.lastConnectedAt;

        if (
            agent.deviceCount === summary.deviceCount &&
            agent.onlineDeviceCount === summary.onlineDeviceCount &&
            agent.lastConnectedAt?.getTime() === lastConnectedAt?.getTime()
        ) {
            return;
        }
        agent.deviceCount = summary.deviceCount;
        agent.onlineDeviceCount = summary.onlineDeviceCount;
        agent.lastConnectedAt = lastConnectedAt;
        await this.agentRepository.save(agent);
    }

    private async request<T>(
        account: XiaozhiAccount,
        path: string,
        init: { method?: string; body?: unknown } = {},
    ): Promise<UpstreamPayload<T>> {
        await this.ensureCredentialRead();
        const headers: Record<string, string> = {
            Accept: "application/json",
            Authorization: `Bearer ${this.decryptCredential(account.accessTokenEncrypted)}`,
        };
        if (account.sessionCookieEncrypted) {
            headers.Cookie = this.decryptCredential(account.sessionCookieEncrypted);
        }
        if (init.body !== undefined) headers["Content-Type"] = "application/json";

        let response: Response;
        try {
            response = await fetch(`${this.baseUrl}${path}`, {
                method: init.method || "GET",
                headers,
                body: init.body === undefined ? undefined : JSON.stringify(init.body),
            });
        } catch {
            throw HttpErrorFactory.badGateway("无法连接小智服务");
        }
        const payload = (await this.parseResponse(response)) as UpstreamPayload<T>;
        const freshCookies = this.readSetCookies(response.headers);
        if (freshCookies) {
            const current = account.sessionCookieEncrypted
                ? this.decryptCredential(account.sessionCookieEncrypted)
                : "";
            await this.ensureCredentialWrite();
            account.sessionCookieEncrypted = this.encryptCredential(
                this.mergeCookies(current, freshCookies),
            );
            await this.accountRepository.save(account);
        }
        if (!response.ok) {
            const error = HttpErrorFactory.thirdPartyError(
                payload.message || payload.error || `小智接口返回 ${response.status}`,
            ) as Error & { status?: number };
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    private toPublicAccount(account: XiaozhiAccount) {
        let usernameMasked = "需要重新登录";
        let credentialStatus: "ready" | "recovery_required" = "ready";
        try {
            const username = this.credentialCrypto.decrypt(account.usernameEncrypted);
            usernameMasked =
                username.length <= 3
                    ? `${username.slice(0, 1)}***`
                    : `${username.slice(0, 2)}***${username.slice(-1)}`;
        } catch (error) {
            if (!this.credentialCrypto.isCredentialError(error)) throw error;
            credentialStatus = "recovery_required";
        }
        return {
            id: account.id,
            organizationId: account.organizationId,
            ownerUserId: account.ownerUserId,
            label: account.label,
            usernameMasked,
            credentialStatus,
            upstreamUserId: account.upstreamUserId,
            status: account.status,
            lastSyncAt: account.lastSyncAt,
            lastError:
                credentialStatus === "recovery_required"
                    ? XIAOZHI_CREDENTIAL_RECOVERY_MESSAGE
                    : account.lastError,
            createdAt: account.createdAt,
        };
    }

    private cleanupChallenges() {
        const now = Date.now();
        for (const [id, challenge] of this.challenges.entries()) {
            if (challenge.expiresAt <= now) this.challenges.delete(id);
        }
    }

    private async parseResponse(response: Response): Promise<unknown> {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) return response.json();
        const text = await response.text();
        return { message: text || `上游接口返回 ${response.status}` };
    }

    private readSetCookies(headers: Headers) {
        const values = (
            headers as Headers & { getSetCookie?: () => string[] }
        ).getSetCookie?.() || [headers.get("set-cookie") || ""];
        return values
            .flatMap((value) => value.split(/,(?=\s*[^;,]+=)/))
            .map((value) => value.split(";", 1)[0]?.trim())
            .filter(Boolean)
            .join("; ");
    }

    private mergeCookies(current: string, incoming: string) {
        const jar = new Map<string, string>();
        for (const cookie of `${current}; ${incoming}`.split(";")) {
            const trimmed = cookie.trim();
            const separator = trimmed.indexOf("=");
            if (separator <= 0) continue;
            jar.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
        }
        return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
    }

    private async ensureCredentialRead() {
        try {
            await this.credentialCrypto.ensureReadable();
        } catch (error) {
            throw this.credentialCrypto.toHttpError(error);
        }
    }

    private async ensureCredentialWrite() {
        try {
            await this.credentialCrypto.ensureWritable();
        } catch (error) {
            throw this.credentialCrypto.toHttpError(error);
        }
    }

    private encryptCredential(value: string) {
        try {
            return this.credentialCrypto.encrypt(value);
        } catch (error) {
            throw this.credentialCrypto.toHttpError(error);
        }
    }

    private decryptCredential(value: string) {
        try {
            return this.credentialCrypto.decrypt(value);
        } catch (error) {
            throw this.credentialCrypto.toHttpError(error);
        }
    }

    private decryptForRecovery(value: string) {
        try {
            return this.credentialCrypto.decrypt(value);
        } catch (error) {
            if (this.credentialCrypto.isCredentialError(error)) {
                throw HttpErrorFactory.badRequest(
                    "旧凭据无法读取，请同时填写小智用户名和密码后重新登录",
                    { code: "xiaozhi_full_credentials_required" },
                );
            }
            throw error;
        }
    }
}

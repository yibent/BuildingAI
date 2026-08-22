import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ACTIVE_ORGANIZATION_STORAGE_KEY, apiHttpClient } from "../base";

// 常量定义在 base 里（宿主与扩展的 http client 都要用），这里转出以免调用点改动。
export { ACTIVE_ORGANIZATION_STORAGE_KEY };
export const WORKSPACE_CHANGED_EVENT = "buildingai:workspace-changed";

export const OrganizationRole = {
    STUDENT: "student",
    TEACHER: "teacher",
    ADMIN: "admin",
    SCHOOL_ADMIN: "school_admin",
} as const;

export type OrganizationRoleType = (typeof OrganizationRole)[keyof typeof OrganizationRole];

export const OrganizationPermission = {
    ASSIGNMENT_SUBMIT: "assignment:submit",
    ASSIGNMENT_PUBLISH: "assignment:publish",
    MEMBER_READ: "member:read",
    MEMBER_MANAGE: "member:manage",
    ASSET_READ: "asset:read",
    ASSET_MANAGE: "asset:manage",
    ORGANIZATION_MANAGE: "organization:manage",
    BILLING_MANAGE: "billing:manage",
    QUOTA_ALLOCATE: "quota:allocate",
} as const;

export type OrganizationPermissionType =
    (typeof OrganizationPermission)[keyof typeof OrganizationPermission];

export type OrganizationWorkspace = {
    id: string;
    type: "organization";
    name: string;
    code: string;
    roles: OrganizationRoleType[];
    permissions: OrganizationPermissionType[];
    memberType: "managed" | "invited" | "owner";
    canLeave: boolean;
};

export type WorkspaceContext = {
    personalWorkspace: {
        id: null;
        type: "personal";
        name: string;
        roles: [];
        permissions: OrganizationPermissionType[];
    } | null;
    organizations: OrganizationWorkspace[];
};

export type OrganizationMember = {
    id: string;
    userId: string;
    roles: OrganizationRoleType[];
    memberType: "managed" | "invited" | "owner";
    canLeave: boolean;
    createdAt: string;
    username: string;
    nickname: string;
    realName?: string;
    avatar?: string;
    hasPersonalWorkspace: boolean;
};

export type ManagedAccountInput = {
    username: string;
    nickname?: string;
    realName?: string;
    password?: string;
};

export type ManagedAccountResult = {
    created: number;
    credentials: Array<{
        userId: string;
        username: string;
        nickname: string;
        password: string;
    }>;
};

export type XiaozhiAccount = {
    id: string;
    organizationId: string | null;
    ownerUserId: string;
    label: string;
    usernameMasked: string;
    credentialStatus: "ready" | "recovery_required";
    upstreamUserId: string | null;
    status: "active" | "auth_error" | "sync_error";
    lastSyncAt: string | null;
    lastError: string | null;
    createdAt: string;
};

export type XiaozhiAgent = {
    id: string;
    xiaozhiAccountId: string;
    organizationId: string | null;
    ownerUserId: string;
    upstreamAgentId: string;
    name: string;
    model: string | null;
    voice: string | null;
    deviceCount: number;
    onlineDeviceCount: number;
    lastConnectedAt: string | null;
    assignedUserId: string | null;
    linkedAgentId: string | null;
    linkedAgentName: string | null;
    linkedAgentSyncedAt: string | null;
    lockedConfigKeys: string[];
};

export type XiaozhiDevice = {
    id: number;
    agentId: string;
    macAddress: string;
    clientId?: string;
    alias: string;
    boardName: string;
    appVersion: string;
    serialNumber: string;
    autoUpdate: boolean;
    online: boolean;
    authorized: boolean;
    lastConnectedAt: string | null;
};

export type CubeCatDeviceType = "unknown" | "CubeCat-Lite" | "CubeCat-S";

export type CubeCatManagedDevice = XiaozhiDevice & {
    deviceType: CubeCatDeviceType;
    deviceTypeLabel: string;
    agentName: string;
    upstreamAgentId: string;
    linkedAgentId: string | null;
    linkedAgentName: string | null;
    model: string | null;
    voice: string | null;
    agentDeviceCount: number;
    settings: {
        volume: number;
        brightness: number;
        doNotDisturb: boolean;
    };
    canManage: boolean;
    canSetDeviceType: boolean;
};

export type XiaozhiTtsVoice = {
    voice_id: string;
    voice_name: string;
    language?: string;
    voice_demo?: string | null;
    is_beta?: boolean;
    is_clone?: boolean;
};

export type XiaozhiAgentConfig = {
    id?: number;
    agent_name?: string;
    agent_template_id?: number | null;
    language?: string | null;
    tts_voice?: string | null;
    character?: string | null;
    asr_speed?: "slow" | "normal" | "fast" | null;
    tts_speech_speed?: "slow" | "normal" | "fast" | null;
    tts_pitch?: number | string | null;
    llm_model?: string | null;
    memory_type?: "OFF" | "SHORT_TERM" | "LONG_TERM" | null;
    teen_mode?: boolean | number | string | null;
    mcp_endpoints?: Array<string | number> | string | null;
    knowledge_base_ids?: Array<string | number> | string | null;
    [key: string]: unknown;
};

export type XiaozhiAgentEditorData = {
    agentId: string;
    name: string;
    config: XiaozhiAgentConfig;
    ttsList: {
        languages: string[];
        ttsVoices: Record<string, XiaozhiTtsVoice[]>;
    };
    models: Array<{ name: string; description?: string }>;
    mcpTools: Array<{
        endpoint_id: string | number;
        name: string;
        description?: string;
        language?: string | string[];
    }>;
    knowledgeBases: Array<{ id: number; name: string; knowledge_base_type?: string }>;
};

export type XiaozhiScene = {
    id: string;
    organizationId: string | null;
    ownerUserId: string;
    name: string;
    description: string;
    config: XiaozhiAgentConfig;
    sourceAgentId: string | null;
    sourceAgentName: string;
    createdAt: string;
    updatedAt: string;
};

export type XiaozhiQuickCommand = {
    id: string;
    organizationId: string | null;
    ownerUserId: string;
    name: string;
    sceneId: string;
    pinned: boolean;
    targets: Array<{ agentId: string; agentName: string }>;
    createdAt: string;
    updatedAt: string;
};

export type SceneApplyExecution = {
    sceneId: string;
    sceneName: string;
    results: Array<{ agentId: string; agentName: string; success: boolean; message?: string }>;
    succeeded: number;
    failed: number;
    status: "success" | "partial" | "failed";
};

export type XiaozhiChatSession = {
    id: number;
    agentId: string;
    agentName: string;
    createdAt: string | null;
    deviceId: number | null;
    messageCount: number;
    model: string;
    tokenCount: number;
    duration: number;
    title: string;
    summary: string;
};

export type XiaozhiChatMessage = {
    id: number;
    chatId: number;
    role: string;
    content: string;
    createdAt: string | null;
    name: string;
    model: string;
    url: string;
};

export function getActiveOrganizationId(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(ACTIVE_ORGANIZATION_STORAGE_KEY);
}

export function setActiveOrganizationId(organizationId: string | null) {
    if (typeof window === "undefined") return;
    if (organizationId) {
        window.localStorage.setItem(ACTIVE_ORGANIZATION_STORAGE_KEY, organizationId);
    } else {
        window.localStorage.removeItem(ACTIVE_ORGANIZATION_STORAGE_KEY);
    }
    window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED_EVENT, { detail: { organizationId } }));
}

export function useWorkspaceContextQuery(options?: { enabled?: boolean }) {
    return useQuery<WorkspaceContext>({
        queryKey: ["organizations", "context"],
        queryFn: () => apiHttpClient.get<WorkspaceContext>("/organizations/context"),
        ...options,
    });
}

export function useCreateOrganizationMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation<{ id: string; name: string }, Error, { name: string }>({
        mutationFn: (data) => apiHttpClient.post("/organizations", data),
        ...options,
        onSuccess: (...args) => {
            queryClient.invalidateQueries({ queryKey: ["organizations"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useOrganizationMembersQuery(
    organizationId: string | null,
    keyword = "",
    options?: { enabled?: boolean },
) {
    return useQuery<OrganizationMember[]>({
        queryKey: ["organizations", organizationId, "members", keyword],
        queryFn: () =>
            apiHttpClient.get(`/organizations/${organizationId}/members`, {
                params: { keyword: keyword || undefined },
            }),
        enabled: Boolean(organizationId) && options?.enabled !== false,
    });
}

export function useSearchOrganizationUsersQuery(
    organizationId: string | null,
    keyword: string,
    options?: { enabled?: boolean },
) {
    return useQuery<
        Array<{
            id: string;
            username: string;
            nickname: string;
            realName?: string;
            avatar?: string;
        }>
    >({
        queryKey: ["organizations", organizationId, "search-users", keyword],
        queryFn: () =>
            apiHttpClient.get(`/organizations/${organizationId}/search-users`, {
                params: { keyword: keyword || undefined },
            }),
        enabled: Boolean(organizationId) && options?.enabled !== false,
    });
}

export function useAddOrganizationMemberMutation(organizationId: string | null, options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: { userId: string; roles: OrganizationRoleType[] }) =>
            apiHttpClient.post(`/organizations/${organizationId}/members`, data),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({
                queryKey: ["organizations", organizationId, "members"],
            });
            options?.onSuccess?.(...args);
        },
    });
}

export function useUpdateOrganizationMemberMutation(organizationId: string | null, options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: { memberId: string; roles: OrganizationRoleType[] }) =>
            apiHttpClient.patch(`/organizations/${organizationId}/members/${data.memberId}`, {
                roles: data.roles,
            }),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({
                queryKey: ["organizations", organizationId, "members"],
            });
            queryClient.invalidateQueries({ queryKey: ["organizations", "context"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useLeaveOrganizationMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation<{ success: boolean }, Error, string>({
        mutationFn: (organizationId) =>
            apiHttpClient.post(`/organizations/${organizationId}/leave`),
        ...options,
        onSuccess: (...args) => {
            queryClient.invalidateQueries({ queryKey: ["organizations"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useCreateManagedAccountsMutation(organizationId: string | null, options?: any) {
    const queryClient = useQueryClient();
    return useMutation<ManagedAccountResult, Error, { accounts: ManagedAccountInput[] }>({
        mutationFn: (data) =>
            apiHttpClient.post(`/organizations/${organizationId}/subaccounts`, data),
        ...options,
        onSuccess: (...args) => {
            queryClient.invalidateQueries({
                queryKey: ["organizations", organizationId, "members"],
            });
            options?.onSuccess?.(...args);
        },
    });
}

export function useImportManagedAccountsMutation(organizationId: string | null, options?: any) {
    const queryClient = useQueryClient();
    return useMutation<ManagedAccountResult, Error, File>({
        mutationFn: (file) => {
            const form = new FormData();
            form.append("file", file);
            return apiHttpClient.upload(
                `/organizations/${organizationId}/subaccounts/import`,
                form,
            );
        },
        ...options,
        onSuccess: (...args) => {
            queryClient.invalidateQueries({
                queryKey: ["organizations", organizationId, "members"],
            });
            options?.onSuccess?.(...args);
        },
    });
}

function organizationHeaders() {
    const organizationId = getActiveOrganizationId();
    return organizationId ? { "x-organization-id": organizationId } : undefined;
}

export function useXiaozhiAccountsQuery(options?: { enabled?: boolean }) {
    const organizationId = getActiveOrganizationId();
    return useQuery<XiaozhiAccount[]>({
        queryKey: ["xiaozhi", organizationId, "accounts"],
        queryFn: () =>
            apiHttpClient.get("/organizations/xiaozhi/accounts", {
                headers: organizationHeaders(),
            }),
        ...options,
    });
}

export function useXiaozhiAgentsQuery(options?: { enabled?: boolean }) {
    const organizationId = getActiveOrganizationId();
    return useQuery<XiaozhiAgent[]>({
        queryKey: ["xiaozhi", organizationId, "agents"],
        queryFn: () =>
            apiHttpClient.get("/organizations/xiaozhi/agents", {
                headers: organizationHeaders(),
            }),
        ...options,
    });
}

export function useBindXiaozhiAccountMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: {
            label: string;
            username: string;
            password: string;
            captchaCode: string;
            challengeId: string;
        }) =>
            apiHttpClient.post("/organizations/xiaozhi/accounts", data, {
                headers: organizationHeaders(),
            }),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useReconnectXiaozhiAccountMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: {
            accountId: string;
            username?: string;
            password?: string;
            captchaCode: string;
            challengeId: string;
        }) =>
            apiHttpClient.post(
                `/organizations/xiaozhi/accounts/${data.accountId}/reconnect`,
                {
                    username: data.username || undefined,
                    password: data.password || undefined,
                    captchaCode: data.captchaCode,
                    challengeId: data.challengeId,
                },
                { headers: organizationHeaders() },
            ),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useUpdateXiaozhiAccountMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: { accountId: string; label: string }) =>
            apiHttpClient.patch(
                `/organizations/xiaozhi/accounts/${data.accountId}`,
                { label: data.label },
                { headers: organizationHeaders() },
            ),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useRemoveXiaozhiAccountMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (accountId: string) =>
            apiHttpClient.delete(`/organizations/xiaozhi/accounts/${accountId}`, {
                headers: organizationHeaders(),
            }),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useDeleteXiaozhiAgentMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (agentId: string) =>
            apiHttpClient.delete(`/organizations/xiaozhi/agents/${agentId}`, {
                headers: organizationHeaders(),
            }),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useSyncXiaozhiAccountMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (accountId: string) =>
            apiHttpClient.post(`/organizations/xiaozhi/accounts/${accountId}/sync`, undefined, {
                headers: organizationHeaders(),
            }),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useAssignXiaozhiAgentMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: { agentId: string; assignedUserId: string | null }) =>
            apiHttpClient.patch(
                `/organizations/xiaozhi/agents/${data.agentId}/assignment`,
                { assignedUserId: data.assignedUserId },
                { headers: organizationHeaders() },
            ),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export async function fetchXiaozhiCaptcha(
    organizationId: string | null = getActiveOrganizationId(),
) {
    return apiHttpClient.get<{
        challengeId: string;
        image: string;
        expiresAt: string;
    }>("/organizations/xiaozhi/captcha", {
        headers: organizationId ? { "x-organization-id": organizationId } : undefined,
    });
}

export function useXiaozhiDevicesQuery(agentId: string | null, options?: { enabled?: boolean }) {
    const organizationId = getActiveOrganizationId();
    return useQuery<XiaozhiDevice[]>({
        queryKey: ["xiaozhi", organizationId, "devices", agentId],
        queryFn: () =>
            apiHttpClient.get(`/organizations/xiaozhi/agents/${agentId}/devices`, {
                headers: organizationHeaders(),
            }),
        enabled: Boolean(agentId) && options?.enabled !== false,
    });
}

export function useCubeCatDevicesQuery(options?: { enabled?: boolean }) {
    const organizationId = getActiveOrganizationId();
    return useQuery<CubeCatManagedDevice[]>({
        queryKey: ["xiaozhi", organizationId, "all-devices"],
        queryFn: () =>
            apiHttpClient.get("/organizations/xiaozhi/devices", {
                headers: organizationHeaders(),
            }),
        ...options,
    });
}

export function useUpdateCubeCatDeviceTypeMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: { agentId: string; deviceId: number; deviceType: CubeCatDeviceType }) =>
            apiHttpClient.patch(
                `/organizations/xiaozhi/agents/${data.agentId}/devices/${data.deviceId}/type`,
                { deviceType: data.deviceType },
                { headers: organizationHeaders() },
            ),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useUpdateCubeCatDeviceSettingsMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: {
            agentId: string;
            deviceId: number;
            volume?: number;
            brightness?: number;
            doNotDisturb?: boolean;
        }) => {
            const { agentId, deviceId, ...settings } = data;
            return apiHttpClient.patch(
                `/organizations/xiaozhi/agents/${agentId}/devices/${deviceId}/settings`,
                settings,
                { headers: organizationHeaders() },
            );
        },
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function usePublishBuildingAgentToCubeCatMutation(buildingAgentId: string, options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: {
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
        }) =>
            apiHttpClient.post(
                `/organizations/xiaozhi/building-agents/${buildingAgentId}/publish`,
                data,
                { headers: organizationHeaders() },
            ),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useXiaozhiAgentEditorQuery(
    agentId: string | null,
    options?: { enabled?: boolean },
) {
    const organizationId = getActiveOrganizationId();
    return useQuery<XiaozhiAgentEditorData>({
        queryKey: ["xiaozhi", organizationId, "agent-editor", agentId],
        queryFn: () =>
            apiHttpClient.get(`/organizations/xiaozhi/agents/${agentId}/editor`, {
                headers: organizationHeaders(),
            }),
        enabled: Boolean(agentId) && options?.enabled !== false,
    });
}

export function useXiaozhiAgentChatsQuery(agentId: string | null, options?: { enabled?: boolean }) {
    const organizationId = getActiveOrganizationId();
    return useQuery<XiaozhiChatSession[]>({
        queryKey: ["xiaozhi", organizationId, "chats", agentId],
        queryFn: () =>
            apiHttpClient.get(`/organizations/xiaozhi/agents/${agentId}/chats`, {
                headers: organizationHeaders(),
            }),
        enabled: Boolean(agentId) && options?.enabled !== false,
    });
}

export function useXiaozhiChatMessagesQuery(
    agentId: string | null,
    chatId: number | null,
    options?: { enabled?: boolean },
) {
    const organizationId = getActiveOrganizationId();
    return useQuery<XiaozhiChatMessage[]>({
        queryKey: ["xiaozhi", organizationId, "chat-messages", agentId, chatId],
        queryFn: () =>
            apiHttpClient.get(`/organizations/xiaozhi/agents/${agentId}/chats/${chatId}/messages`, {
                headers: organizationHeaders(),
            }),
        enabled: Boolean(agentId && chatId) && options?.enabled !== false,
    });
}

export function useBindXiaozhiDeviceMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: { agentId: string; verificationCode: string }) =>
            apiHttpClient.post(
                `/organizations/xiaozhi/agents/${data.agentId}/devices`,
                { verificationCode: data.verificationCode },
                { headers: organizationHeaders() },
            ),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useUpdateXiaozhiDeviceAliasMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: {
            agentId: string;
            deviceId: number;
            macAddress: string;
            alias: string;
        }) =>
            apiHttpClient.patch(
                `/organizations/xiaozhi/agents/${data.agentId}/devices/${data.deviceId}/alias`,
                { macAddress: data.macAddress, alias: data.alias },
                { headers: organizationHeaders() },
            ),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useUpdateXiaozhiDeviceAutoUpdateMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: {
            agentId: string;
            deviceId: number;
            macAddress: string;
            autoUpdate: boolean;
        }) =>
            apiHttpClient.patch(
                `/organizations/xiaozhi/agents/${data.agentId}/devices/${data.deviceId}/auto-update`,
                { macAddress: data.macAddress, autoUpdate: data.autoUpdate },
                { headers: organizationHeaders() },
            ),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useUnbindXiaozhiDeviceMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: { agentId: string; deviceId: number }) =>
            apiHttpClient.delete(
                `/organizations/xiaozhi/agents/${data.agentId}/devices/${data.deviceId}`,
                { headers: organizationHeaders() },
            ),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useXiaozhiScenesQuery(options?: { enabled?: boolean }) {
    const organizationId = getActiveOrganizationId();
    return useQuery<XiaozhiScene[]>({
        queryKey: ["xiaozhi", organizationId, "scenes"],
        queryFn: () =>
            apiHttpClient.get("/organizations/xiaozhi/scenes", {
                headers: organizationHeaders(),
            }),
        ...options,
    });
}

export function useSaveXiaozhiSceneMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: {
            sceneId?: string;
            name: string;
            description?: string;
            config?: Record<string, unknown>;
            sourceAgentId?: string;
        }) => {
            const payload = {
                name: data.name,
                description: data.description,
                config: data.config,
                sourceAgentId: data.sourceAgentId,
            };
            return data.sceneId
                ? apiHttpClient.patch(`/organizations/xiaozhi/scenes/${data.sceneId}`, payload, {
                      headers: organizationHeaders(),
                  })
                : apiHttpClient.post("/organizations/xiaozhi/scenes", payload, {
                      headers: organizationHeaders(),
                  });
        },
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useRemoveXiaozhiSceneMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (sceneId: string) =>
            apiHttpClient.delete(`/organizations/xiaozhi/scenes/${sceneId}`, {
                headers: organizationHeaders(),
            }),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useApplyXiaozhiSceneMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation<SceneApplyExecution, Error, { sceneId: string; agentIds: string[] }>({
        mutationFn: (data) =>
            apiHttpClient.post(
                `/organizations/xiaozhi/scenes/${data.sceneId}/apply`,
                { agentIds: data.agentIds },
                { headers: organizationHeaders() },
            ),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useXiaozhiQuickCommandsQuery(options?: { enabled?: boolean }) {
    const organizationId = getActiveOrganizationId();
    return useQuery<XiaozhiQuickCommand[]>({
        queryKey: ["xiaozhi", organizationId, "quick-commands"],
        queryFn: () =>
            apiHttpClient.get("/organizations/xiaozhi/quick-commands", {
                headers: organizationHeaders(),
            }),
        ...options,
    });
}

export function useSaveXiaozhiQuickCommandMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: {
            commandId?: string;
            name: string;
            sceneId: string;
            pinned?: boolean;
            agentIds: string[];
        }) => {
            const payload = {
                name: data.name,
                sceneId: data.sceneId,
                pinned: data.pinned,
                agentIds: data.agentIds,
            };
            return data.commandId
                ? apiHttpClient.patch(
                      `/organizations/xiaozhi/quick-commands/${data.commandId}`,
                      payload,
                      { headers: organizationHeaders() },
                  )
                : apiHttpClient.post("/organizations/xiaozhi/quick-commands", payload, {
                      headers: organizationHeaders(),
                  });
        },
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useRemoveXiaozhiQuickCommandMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (commandId: string) =>
            apiHttpClient.delete(`/organizations/xiaozhi/quick-commands/${commandId}`, {
                headers: organizationHeaders(),
            }),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useExecuteXiaozhiQuickCommandMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation<SceneApplyExecution, Error, string>({
        mutationFn: (commandId) =>
            apiHttpClient.post(
                `/organizations/xiaozhi/quick-commands/${commandId}/execute`,
                undefined,
                { headers: organizationHeaders() },
            ),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useUpdateXiaozhiConfigLocksMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: { agentId: string; keys: string[] }) =>
            apiHttpClient.patch(
                `/organizations/xiaozhi/agents/${data.agentId}/config-locks`,
                { keys: data.keys },
                { headers: organizationHeaders() },
            ),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useLinkBuildingAgentMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: { agentId: string; buildingAgentId: string | null }) =>
            apiHttpClient.patch(
                `/organizations/xiaozhi/agents/${data.agentId}/building-agent`,
                { agentId: data.buildingAgentId },
                { headers: organizationHeaders() },
            ),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useSyncLinkedBuildingAgentMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (agentId: string) =>
            apiHttpClient.post(
                `/organizations/xiaozhi/agents/${agentId}/building-agent/sync`,
                undefined,
                { headers: organizationHeaders() },
            ),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useRenameXiaozhiAgentMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: { agentId: string; name: string }) =>
            apiHttpClient.patch(
                `/organizations/xiaozhi/agents/${data.agentId}/name`,
                { name: data.name },
                { headers: organizationHeaders() },
            ),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useUpdateXiaozhiAgentConfigMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: { agentId: string; config: Record<string, unknown> }) =>
            apiHttpClient.patch(
                `/organizations/xiaozhi/agents/${data.agentId}/config`,
                { config: data.config },
                { headers: organizationHeaders() },
            ),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
            options?.onSuccess?.(...args);
        },
    });
}

// ==================== 班级任务列表 ====================

export type AssignmentTargetType = "workflow" | "agent";

export type AssignmentStatus = "draft" | "published" | "closed";

export type OrganizationAssignment = {
    id: string;
    organizationId: string;
    ownerUserId: string;
    title: string;
    description: string;
    dueAt: string | null;
    allowedTypes: AssignmentTargetType[];
    status: AssignmentStatus;
    /** 生效的学生ID列表，空数组表示全班。 */
    targetUserIds: string[];
    createdAt: string;
    updatedAt: string;
    /** 老师视角的提交数量。 */
    submissionCount?: number;
};

export type AssignmentSubmission = {
    id: string;
    assignmentId: string;
    organizationId: string;
    studentUserId: string;
    targetType: AssignmentTargetType;
    targetId: string;
    targetName: string;
    snapshot: Record<string, unknown>;
    remark: string;
    status: "submitted" | "reviewed";
    score: number | null;
    feedback: string;
    reviewedByUserId: string | null;
    submittedAt: string;
    author?: {
        userId: string;
        username: string;
        nickname: string;
        realName?: string;
        avatar?: string;
    } | null;
};

export type MyAssignment = OrganizationAssignment & {
    mySubmission: AssignmentSubmission | null;
};

export type SaveAssignmentPayload = {
    assignmentId?: string;
    title: string;
    description?: string;
    dueAt?: string | null;
    allowedTypes?: AssignmentTargetType[];
    /** 空数组表示全班生效。 */
    targetUserIds?: string[];
};

export function useAssignmentsQuery(options?: { enabled?: boolean }) {
    const organizationId = getActiveOrganizationId();
    return useQuery<OrganizationAssignment[]>({
        queryKey: ["organizations", organizationId, "assignments"],
        queryFn: () =>
            apiHttpClient.get("/organizations/assignments", { headers: organizationHeaders() }),
        enabled: Boolean(organizationId) && options?.enabled !== false,
    });
}

export function useSaveAssignmentMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation<OrganizationAssignment, Error, SaveAssignmentPayload>({
        mutationFn: ({ assignmentId, ...payload }) =>
            assignmentId
                ? apiHttpClient.patch(`/organizations/assignments/${assignmentId}`, payload, {
                      headers: organizationHeaders(),
                  })
                : apiHttpClient.post("/organizations/assignments", payload, {
                      headers: organizationHeaders(),
                  }),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["organizations"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useRemoveAssignmentMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation<{ success: boolean }, Error, string>({
        mutationFn: (assignmentId) =>
            apiHttpClient.delete(`/organizations/assignments/${assignmentId}`, {
                headers: organizationHeaders(),
            }),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["organizations"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useUpdateAssignmentStatusMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation<
        OrganizationAssignment,
        Error,
        { assignmentId: string; action: "publish" | "close" }
    >({
        mutationFn: ({ assignmentId, action }) =>
            apiHttpClient.post(`/organizations/assignments/${assignmentId}/${action}`, undefined, {
                headers: organizationHeaders(),
            }),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["organizations"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useAssignmentSubmissionsQuery(
    assignmentId: string | null,
    options?: { enabled?: boolean },
) {
    const organizationId = getActiveOrganizationId();
    return useQuery<AssignmentSubmission[]>({
        queryKey: ["organizations", organizationId, "submissions", assignmentId],
        queryFn: () =>
            apiHttpClient.get(`/organizations/assignments/${assignmentId}/submissions`, {
                headers: organizationHeaders(),
            }),
        enabled: Boolean(assignmentId) && options?.enabled !== false,
    });
}

export function useReviewSubmissionMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation<
        AssignmentSubmission,
        Error,
        { submissionId: string; score?: number | null; feedback?: string }
    >({
        mutationFn: ({ submissionId, ...payload }) =>
            apiHttpClient.patch(`/organizations/submissions/${submissionId}/review`, payload, {
                headers: organizationHeaders(),
            }),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["organizations"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useMyAssignmentsQuery(options?: { enabled?: boolean }) {
    const organizationId = getActiveOrganizationId();
    return useQuery<MyAssignment[]>({
        queryKey: ["organizations", organizationId, "my-assignments"],
        queryFn: () =>
            apiHttpClient.get("/organizations/my-assignments", { headers: organizationHeaders() }),
        enabled: Boolean(organizationId) && options?.enabled !== false,
    });
}

export function useSubmitAssignmentMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation<
        AssignmentSubmission,
        Error,
        {
            assignmentId: string;
            targetType: AssignmentTargetType;
            targetId: string;
            remark?: string;
        }
    >({
        mutationFn: ({ assignmentId, ...payload }) =>
            apiHttpClient.post(`/organizations/my-assignments/${assignmentId}/submit`, payload, {
                headers: organizationHeaders(),
            }),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["organizations"] });
            options?.onSuccess?.(...args);
        },
    });
}

// ==================== 班级应用管理 ====================

export type OrganizationAppType = "system" | "extension" | "workflow";

export type GrantableApp = {
    appType: OrganizationAppType;
    appRefId: string;
    name: string;
    description: string;
    icon: string | null;
    identifier?: string;
    config?: Record<string, unknown>;
    path?: string;
    grantedToClass: boolean;
    grantedUserIds: string[];
    sidebarRequiredToClass: boolean;
    sidebarRequiredUserIds: string[];
};

export type AppGrantMatrix = {
    whitelistEnabled: boolean;
    items: GrantableApp[];
};

export type AppGrantInput = {
    appType: OrganizationAppType;
    appRefId: string;
    userId?: string | null;
    sidebarRequired?: boolean;
};

export function useAppGrantsQuery(options?: { enabled?: boolean }) {
    const organizationId = getActiveOrganizationId();
    return useQuery<AppGrantMatrix>({
        queryKey: ["organizations", organizationId, "app-grants"],
        queryFn: () =>
            apiHttpClient.get("/organizations/app-grants", { headers: organizationHeaders() }),
        enabled: Boolean(organizationId) && options?.enabled !== false,
    });
}

export function useSaveAppGrantsMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation<{ granted: number; revoked: number }, Error, AppGrantInput[]>({
        mutationFn: (grants) =>
            apiHttpClient.put(
                "/organizations/app-grants",
                { grants },
                { headers: organizationHeaders() },
            ),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["organizations"] });
            options?.onSuccess?.(...args);
        },
    });
}

export function useUpdateAppWhitelistMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation<{ enabled: boolean }, Error, boolean>({
        mutationFn: (enabled) =>
            apiHttpClient.patch(
                "/organizations/app-whitelist",
                { enabled },
                { headers: organizationHeaders() },
            ),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["organizations"] });
            options?.onSuccess?.(...args);
        },
    });
}

export type MyAppScope = {
    restricted: boolean;
    systemIds: string[];
    extensionIds: string[];
    workflowIds: string[];
    sidebar: {
        systemIds: string[];
        extensionIds: string[];
        workflowIds: string[];
    };
};

export function useMyAppScopeQuery(options?: { enabled?: boolean }) {
    const organizationId = getActiveOrganizationId();
    return useQuery<MyAppScope>({
        queryKey: ["organizations", organizationId, "my-apps"],
        queryFn: () =>
            apiHttpClient.get("/organizations/my-apps", { headers: organizationHeaders() }),
        enabled: Boolean(organizationId) && options?.enabled !== false,
    });
}

// ==================== 额度管理 ====================

export type QuotaMember = {
    userId: string;
    username: string;
    nickname: string;
    realName?: string;
    avatar?: string;
    power: number;
    consumed: number;
};

export type QuotaOverview = {
    pool: { balance: number; totalGranted: number; totalAllocated: number };
    members: QuotaMember[];
};

export type QuotaLog = {
    id: string;
    organizationId: string;
    targetUserId: string | null;
    action: "topup" | "allocate" | "reclaim";
    amount: number;
    balanceAfter: number;
    operatorUserId: string;
    remark: string;
    createdAt: string;
    targetName: string | null;
    operatorName: string;
};

export function useQuotaOverviewQuery(options?: { enabled?: boolean }) {
    const organizationId = getActiveOrganizationId();
    return useQuery<QuotaOverview>({
        queryKey: ["organizations", organizationId, "quota"],
        queryFn: () =>
            apiHttpClient.get("/organizations/quota", { headers: organizationHeaders() }),
        enabled: Boolean(organizationId) && options?.enabled !== false,
    });
}

export function useQuotaLogsQuery(options?: { enabled?: boolean }) {
    const organizationId = getActiveOrganizationId();
    return useQuery<QuotaLog[]>({
        queryKey: ["organizations", organizationId, "quota-logs"],
        queryFn: () =>
            apiHttpClient.get("/organizations/quota/logs", { headers: organizationHeaders() }),
        enabled: Boolean(organizationId) && options?.enabled !== false,
    });
}

export function useTransferQuotaMutation(options?: any) {
    const queryClient = useQueryClient();
    return useMutation<
        { balance: number },
        Error,
        { action: "allocate" | "reclaim"; userId: string; amount: number; remark?: string }
    >({
        mutationFn: ({ action, ...payload }) =>
            apiHttpClient.post(`/organizations/quota/${action}`, payload, {
                headers: organizationHeaders(),
            }),
        ...options,
        onSuccess: (...args: any[]) => {
            queryClient.invalidateQueries({ queryKey: ["organizations"] });
            queryClient.invalidateQueries({ queryKey: ["user", "info"] });
            options?.onSuccess?.(...args);
        },
    });
}

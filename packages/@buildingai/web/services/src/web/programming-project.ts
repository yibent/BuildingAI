import type { MutationOptionsUtil, QueryOptionsUtil } from "@buildingai/web-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiHttpClient } from "../base";
import type { LuaDeviceRunItem } from "./lua-device";
import type { LuaModuleItem, LuaModuleListResult } from "./lua-module";
import type { SimulatorBoardType, SimulatorSession } from "./simulator";
import type { WorkflowItem } from "./workflow";

const PROGRAMMING_PROJECTS_PATH = "/programming-projects";

export type ProgrammingRuntimeTarget = "local" | "simulator" | "device";
export type ProgrammingProjectType = "conversation" | "application";

export type ProgrammingProjectToolKind = "mcp" | "homeassistant";

export type ProgrammingProjectToolRef = {
    kind?: ProgrammingProjectToolKind;
    mcpServerId?: string;
    toolName?: string;
    deviceId?: string;
};

export function programmingProjectToolKey(tool: ProgrammingProjectToolRef): string {
    const kind = tool.kind === "homeassistant" ? tool.kind : "mcp";
    if (kind === "mcp") return `mcp\u0000${tool.mcpServerId ?? ""}\u0000${tool.toolName ?? ""}`;
    return `${kind}\u0000${tool.deviceId ?? ""}`;
}

export interface ProgrammingProjectItem {
    id: string;
    name: string;
    description?: string | null;
    projectType: ProgrammingProjectType;
    mainWorkflowId: string;
    runtimeTarget: ProgrammingRuntimeTarget;
    simulatorSessionId?: string | null;
    deviceId?: string | null;
    xiaozhiAgentId?: string | null;
    isPublished: boolean;
    publishedAt?: string | null;
    publishedSnapshot?: {
        version: number;
        workflow: { id: string; name: string; schema: object };
        luaModules: Array<{ id: string; name: string }>;
        tools: ProgrammingProjectToolRef[];
        runtime: {
            target: ProgrammingRuntimeTarget;
            simulatorSessionId?: string;
            deviceId?: string;
            xiaozhiAgentId?: string;
        };
        publishedAt: string;
    };
    createBy: string;
    createdAt: string;
    updatedAt: string;
    mainWorkflow: WorkflowItem;
    tools: ProgrammingProjectToolRef[];
    luaModuleCount: number;
}

export interface ProgrammingProjectListResult {
    items: ProgrammingProjectItem[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

export interface CreateProgrammingProjectDto {
    name: string;
    description?: string;
    projectType?: ProgrammingProjectType;
    schema?: Record<string, unknown>;
    template?: "decrypt";
}

export interface UpdateProgrammingProjectDto {
    name?: string;
    description?: string;
    runtimeTarget?: ProgrammingRuntimeTarget;
    simulatorSessionId?: string | null;
    deviceId?: string | null;
    xiaozhiAgentId?: string | null;
}

export const programmingProjectQueryKeys = {
    all: ["programming-projects"] as const,
    listRoot: () => ["programming-projects", "list"] as const,
    list: (params?: { page?: number; pageSize?: number; keyword?: string }) =>
        ["programming-projects", "list", params] as const,
    detail: (id?: string) => ["programming-projects", "detail", id] as const,
    unassignedLua: (id?: string) => ["programming-projects", id, "unassigned-lua"] as const,
};

export function listProgrammingProjects(params?: {
    page?: number;
    pageSize?: number;
    keyword?: string;
}): Promise<ProgrammingProjectListResult> {
    return apiHttpClient.get(PROGRAMMING_PROJECTS_PATH, { params });
}

export function getProgrammingProject(id: string): Promise<ProgrammingProjectItem> {
    return apiHttpClient.get(`${PROGRAMMING_PROJECTS_PATH}/${id}`);
}

export function useProgrammingProjectsQuery(
    params?: { page?: number; pageSize?: number; keyword?: string },
    options?: QueryOptionsUtil<ProgrammingProjectListResult>,
) {
    return useQuery({
        queryKey: programmingProjectQueryKeys.list(params),
        queryFn: () => listProgrammingProjects(params),
        ...options,
    });
}

export function useProgrammingProjectQuery(
    id?: string,
    options?: QueryOptionsUtil<ProgrammingProjectItem>,
) {
    return useQuery({
        queryKey: programmingProjectQueryKeys.detail(id),
        queryFn: () => getProgrammingProject(id!),
        enabled: !!id,
        ...options,
    });
}

function useProjectMutation<TData, TVariables>(
    mutationFn: (variables: TVariables) => Promise<TData>,
    options?: MutationOptionsUtil<TData, TVariables>,
) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        ...options,
        onSuccess: async (...args) => {
            await queryClient.invalidateQueries({ queryKey: programmingProjectQueryKeys.all });
            options?.onSuccess?.(...args);
        },
    });
}

export function useCreateProgrammingProjectMutation(
    options?: MutationOptionsUtil<ProgrammingProjectItem, CreateProgrammingProjectDto>,
) {
    return useProjectMutation(
        (dto) => apiHttpClient.post<ProgrammingProjectItem>(PROGRAMMING_PROJECTS_PATH, dto),
        options,
    );
}

export function useUpdateProgrammingProjectMutation(
    options?: MutationOptionsUtil<
        ProgrammingProjectItem,
        { id: string; dto: UpdateProgrammingProjectDto }
    >,
) {
    return useProjectMutation(
        ({ id, dto }) => apiHttpClient.patch<ProgrammingProjectItem>(`${PROGRAMMING_PROJECTS_PATH}/${id}`, dto),
        options,
    );
}

export function useDeleteProgrammingProjectMutation(options?: MutationOptionsUtil<void, string>) {
    return useProjectMutation(
        (id) => apiHttpClient.delete<void>(`${PROGRAMMING_PROJECTS_PATH}/${id}`),
        options,
    );
}

export function usePublishProgrammingProjectMutation(
    options?: MutationOptionsUtil<ProgrammingProjectItem, string>,
) {
    return useProjectMutation(
        (id) => apiHttpClient.post<ProgrammingProjectItem>(`${PROGRAMMING_PROJECTS_PATH}/${id}/publish`),
        options,
    );
}

export function useUnpublishProgrammingProjectMutation(
    options?: MutationOptionsUtil<ProgrammingProjectItem, string>,
) {
    return useProjectMutation(
        (id) => apiHttpClient.post<ProgrammingProjectItem>(`${PROGRAMMING_PROJECTS_PATH}/${id}/unpublish`),
        options,
    );
}

export function useReplaceProgrammingProjectToolsMutation(
    options?: MutationOptionsUtil<
        ProgrammingProjectItem,
        { id: string; tools: ProgrammingProjectToolRef[] }
    >,
) {
    return useProjectMutation(
        ({ id, tools }) =>
            apiHttpClient.put<ProgrammingProjectItem>(`${PROGRAMMING_PROJECTS_PATH}/${id}/tools`, {
                tools,
            }),
        options,
    );
}

export function listUnassignedProjectLuaModules(projectId: string): Promise<LuaModuleListResult> {
    return apiHttpClient.get(`${PROGRAMMING_PROJECTS_PATH}/${projectId}/unassigned-lua-modules`);
}

export function useUnassignedProjectLuaModulesQuery(
    projectId?: string,
    options?: QueryOptionsUtil<LuaModuleListResult>,
) {
    return useQuery({
        queryKey: programmingProjectQueryKeys.unassignedLua(projectId),
        queryFn: () => listUnassignedProjectLuaModules(projectId!),
        enabled: !!projectId,
        ...options,
    });
}

export function useCreateProjectLuaRunMutation(
    options?: MutationOptionsUtil<
        LuaDeviceRunItem,
        {
            projectId: string;
            dto: {
                name: string;
                moduleId?: string;
                source: string;
                params: Record<string, unknown>;
                requiredCapabilities?: string[];
                timeoutMs?: number;
            };
        }
    >,
) {
    return useProjectMutation(
        ({ projectId, dto }) =>
            apiHttpClient.post<LuaDeviceRunItem>(
                `${PROGRAMMING_PROJECTS_PATH}/${projectId}/lua-runs`,
                dto,
            ),
        options,
    );
}

export function useImportProjectLuaModuleMutation(
    options?: MutationOptionsUtil<LuaModuleItem, { projectId: string; moduleId: string }>,
) {
    return useProjectMutation(
        ({ projectId, moduleId }) =>
            apiHttpClient.post<LuaModuleItem>(
                `${PROGRAMMING_PROJECTS_PATH}/${projectId}/import-lua-module`,
                { moduleId },
            ),
        options,
    );
}

export function listProjectSimulatorSessions(projectId: string): Promise<SimulatorSession[]> {
    return apiHttpClient.get(`${PROGRAMMING_PROJECTS_PATH}/${projectId}/simulator-sessions`);
}

export function createProjectSimulatorSession(
    projectId: string,
    input: { name?: string; boardType?: SimulatorBoardType } = {},
): Promise<SimulatorSession> {
    return apiHttpClient.post(`${PROGRAMMING_PROJECTS_PATH}/${projectId}/simulator-sessions`, input);
}

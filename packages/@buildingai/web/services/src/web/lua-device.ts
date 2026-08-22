import type { MutationOptionsUtil, QueryOptionsUtil } from "@buildingai/web-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiHttpClient } from "../base";

const DEVICES_PATH = "/devices";

export type LuaDeviceRunStatus =
    | "queued"
    | "preparing"
    | "transferring"
    | "running"
    | "stopping"
    | "waiting_for_device"
    | "succeeded"
    | "failed"
    | "stopped"
    | "timed_out";

export interface LuaPhysicalDeviceItem {
    id: string;
    deviceId: string;
    displayName: string;
    online: boolean;
    macAddress?: string | null;
    clientId?: string | null;
    firmwareVersion?: string | null;
    bootId?: string | null;
    capabilities: string[];
    limits?: {
        maxScriptBytes: number;
        maxParamsBytes: number;
        maxChunkBytes: number;
        maxMessageBytes: number;
        maxLogBytes: number;
    } | null;
    runtime?: {
        executionModel: string;
        apiVersion: string;
        transferStorage: string;
        maxRunTimeoutMs: number;
    } | null;
    lastSeenAt?: string | null;
}

export interface LuaDeviceRunItem {
    id: string;
    deviceId: string;
    moduleId?: string | null;
    projectId?: string | null;
    name: string;
    sourceSha256: string;
    params: Record<string, unknown>;
    requiredCapabilities: string[];
    status: LuaDeviceRunStatus;
    timeoutMs: number;
    nextChunkIndex: number;
    result?: unknown;
    error?: { code: string; message: string; line?: number } | null;
    startedAt?: string | null;
    finishedAt?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface LuaDeviceRunLogItem {
    id: string;
    runId: string;
    sequence: number;
    level: string;
    text: string;
    createdAt: string;
}

export const luaDeviceQueryKeys = {
    all: ["lua-devices"] as const,
    devices: () => ["lua-devices", "list"] as const,
    runs: (deviceId?: string) => ["lua-devices", deviceId, "runs"] as const,
    run: (deviceId?: string, runId?: string) => ["lua-devices", deviceId, "runs", runId] as const,
    logs: (deviceId?: string, runId?: string) =>
        ["lua-devices", deviceId, "runs", runId, "logs"] as const,
};

export function listLuaDevices(): Promise<LuaPhysicalDeviceItem[]> {
    return apiHttpClient.get(DEVICES_PATH);
}

export function useLuaDevicesQuery(options?: QueryOptionsUtil<LuaPhysicalDeviceItem[]>) {
    return useQuery({
        queryKey: luaDeviceQueryKeys.devices(),
        queryFn: listLuaDevices,
        refetchInterval: 5000,
        ...options,
    });
}

export function createLuaDeviceRun(
    deviceId: string,
    dto: {
        name: string;
        moduleId?: string;
        projectId?: string;
        source: string;
        params: Record<string, unknown>;
        requiredCapabilities?: string[];
        timeoutMs?: number;
    },
): Promise<LuaDeviceRunItem> {
    return apiHttpClient.post(`${DEVICES_PATH}/${deviceId}/lua-runs`, dto);
}

export function useCreateLuaDeviceRunMutation(
    options?: MutationOptionsUtil<
        LuaDeviceRunItem,
        {
            deviceId: string;
            dto: Parameters<typeof createLuaDeviceRun>[1];
        }
    >,
) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ deviceId, dto }) => createLuaDeviceRun(deviceId, dto),
        ...options,
        onSuccess: async (...args) => {
            await queryClient.invalidateQueries({ queryKey: luaDeviceQueryKeys.all });
            options?.onSuccess?.(...args);
        },
    });
}

export function getLuaDeviceRun(deviceId: string, runId: string): Promise<LuaDeviceRunItem> {
    return apiHttpClient.get(`${DEVICES_PATH}/${deviceId}/lua-runs/${runId}`);
}

export function useLuaDeviceRunQuery(
    deviceId?: string,
    runId?: string,
    options?: QueryOptionsUtil<LuaDeviceRunItem>,
) {
    return useQuery({
        queryKey: luaDeviceQueryKeys.run(deviceId, runId),
        queryFn: () => getLuaDeviceRun(deviceId!, runId!),
        enabled: Boolean(deviceId && runId),
        refetchInterval: (query) => {
            const status = query.state.data?.status;
            return status && ["succeeded", "failed", "stopped", "timed_out"].includes(status)
                ? false
                : 1000;
        },
        ...options,
    });
}

export function listLuaDeviceRunLogs(
    deviceId: string,
    runId: string,
): Promise<LuaDeviceRunLogItem[]> {
    return apiHttpClient.get(`${DEVICES_PATH}/${deviceId}/lua-runs/${runId}/logs`, {
        params: { after: 0 },
    });
}

export function useLuaDeviceRunLogsQuery(deviceId?: string, runId?: string) {
    return useQuery({
        queryKey: luaDeviceQueryKeys.logs(deviceId, runId),
        queryFn: () => listLuaDeviceRunLogs(deviceId!, runId!),
        enabled: Boolean(deviceId && runId),
        refetchInterval: 1000,
    });
}

export function stopLuaDeviceRun(deviceId: string, runId: string): Promise<LuaDeviceRunItem> {
    return apiHttpClient.post(`${DEVICES_PATH}/${deviceId}/lua-runs/${runId}/stop`);
}

export function useStopLuaDeviceRunMutation(
    options?: MutationOptionsUtil<LuaDeviceRunItem, { deviceId: string; runId: string }>,
) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ deviceId, runId }) => stopLuaDeviceRun(deviceId, runId),
        ...options,
        onSuccess: async (...args) => {
            await queryClient.invalidateQueries({ queryKey: luaDeviceQueryKeys.all });
            options?.onSuccess?.(...args);
        },
    });
}

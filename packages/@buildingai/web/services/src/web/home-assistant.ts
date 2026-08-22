import type { MutationOptionsUtil, QueryOptionsUtil } from "@buildingai/web-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiHttpClient } from "../base";

const HOME_ASSISTANT_PATH = "/smart-home/ha";

export type HomeAssistantAuthMode = "token" | "password";
export type HomeAssistantInstanceStatus = "active" | "auth_error" | "sync_error";

export type HomeAssistantLightState = {
    on: boolean;
    brightness: number | null;
    color: string | null;
    colorTemp: number | null;
    colorMode: string | null;
    minKelvin: number | null;
    maxKelvin: number | null;
    supportedColorModes: string[];
};

export type HomeAssistantInstance = {
    id: string;
    label: string;
    baseUrl: string;
    authMode: HomeAssistantAuthMode;
    username: string | null;
    haVersion: string | null;
    locationName: string | null;
    status: HomeAssistantInstanceStatus;
    deviceCount: number;
    lastSyncAt: string | null;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
};

export type HomeAssistantDevice = {
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

export type HomeAssistantLightCommand = {
    on?: boolean;
    brightness?: number;
    color?: string;
    colorTemp?: number;
};

export const homeAssistantQueryKeys = {
    all: ["home-assistant"] as const,
    instance: () => ["home-assistant", "instance"] as const,
    devices: (filters?: Record<string, string>) => ["home-assistant", "devices", filters] as const,
    device: (deviceId: string | undefined) => ["home-assistant", "device", deviceId] as const,
};

export function getHomeAssistantInstance(): Promise<HomeAssistantInstance | null> {
    return apiHttpClient.get(`${HOME_ASSISTANT_PATH}/instance`);
}

export function upsertHomeAssistantInstance(input: {
    baseUrl: string;
    label?: string;
    authMode?: HomeAssistantAuthMode;
    token?: string;
    username?: string;
    password?: string;
}): Promise<HomeAssistantInstance> {
    return apiHttpClient.put(`${HOME_ASSISTANT_PATH}/instance`, input);
}

export function updateHomeAssistantInstance(label: string): Promise<HomeAssistantInstance> {
    return apiHttpClient.patch(`${HOME_ASSISTANT_PATH}/instance`, { label });
}

export function removeHomeAssistantInstance(): Promise<void> {
    return apiHttpClient.delete(`${HOME_ASSISTANT_PATH}/instance`);
}

export function syncHomeAssistantInstance(): Promise<HomeAssistantInstance> {
    return apiHttpClient.post(`${HOME_ASSISTANT_PATH}/instance/sync`);
}

export function listHomeAssistantDevices(filters?: {
    category?: string;
    areaId?: string;
    keyword?: string;
}): Promise<HomeAssistantDevice[]> {
    return apiHttpClient.get(`${HOME_ASSISTANT_PATH}/devices`, { params: filters });
}

export function getHomeAssistantDevice(deviceId: string): Promise<HomeAssistantDevice> {
    return apiHttpClient.get(`${HOME_ASSISTANT_PATH}/devices/${deviceId}`);
}

export function refreshHomeAssistantDevice(deviceId: string): Promise<HomeAssistantDevice> {
    return apiHttpClient.post(`${HOME_ASSISTANT_PATH}/devices/${deviceId}/refresh`);
}

export function controlHomeAssistantDevice(
    deviceId: string,
    command: HomeAssistantLightCommand,
): Promise<HomeAssistantDevice> {
    return apiHttpClient.post(`${HOME_ASSISTANT_PATH}/devices/${deviceId}/command`, command);
}

export function useHomeAssistantInstanceQuery(options?: QueryOptionsUtil<HomeAssistantInstance | null>) {
    return useQuery({
        queryKey: homeAssistantQueryKeys.instance(),
        queryFn: getHomeAssistantInstance,
        ...options,
    });
}

export function useHomeAssistantDevicesQuery(
    filters?: { category?: string; areaId?: string; keyword?: string },
    options?: QueryOptionsUtil<HomeAssistantDevice[]>,
) {
    return useQuery({
        queryKey: homeAssistantQueryKeys.devices(filters),
        queryFn: () => listHomeAssistantDevices(filters),
        ...options,
    });
}

export function useHomeAssistantDeviceQuery(
    deviceId: string | undefined,
    options?: QueryOptionsUtil<HomeAssistantDevice>,
) {
    return useQuery({
        queryKey: homeAssistantQueryKeys.device(deviceId),
        queryFn: () => getHomeAssistantDevice(deviceId!),
        enabled: Boolean(deviceId),
        ...options,
    });
}

function useHomeAssistantMutation<TData, TVariables>(
    mutationFn: (variables: TVariables) => Promise<TData>,
    options?: MutationOptionsUtil<TData, TVariables>,
) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        ...options,
        onSuccess: async (...args) => {
            await queryClient.invalidateQueries({ queryKey: homeAssistantQueryKeys.all });
            options?.onSuccess?.(...args);
        },
    });
}

export function useUpsertHomeAssistantInstanceMutation(
    options?: MutationOptionsUtil<
        HomeAssistantInstance,
        Parameters<typeof upsertHomeAssistantInstance>[0]
    >,
) {
    return useHomeAssistantMutation(upsertHomeAssistantInstance, options);
}

export function useSyncHomeAssistantInstanceMutation(
    options?: MutationOptionsUtil<HomeAssistantInstance, void>,
) {
    return useHomeAssistantMutation(() => syncHomeAssistantInstance(), options);
}

export function useRemoveHomeAssistantInstanceMutation(options?: MutationOptionsUtil<void, void>) {
    return useHomeAssistantMutation(() => removeHomeAssistantInstance(), options);
}

export function useRefreshHomeAssistantDeviceMutation(
    options?: MutationOptionsUtil<HomeAssistantDevice, string>,
) {
    return useHomeAssistantMutation(refreshHomeAssistantDevice, options);
}

export function useControlHomeAssistantDeviceMutation(
    options?: MutationOptionsUtil<
        HomeAssistantDevice,
        { deviceId: string; command: HomeAssistantLightCommand }
    >,
) {
    return useHomeAssistantMutation(
        ({ deviceId, command }) => controlHomeAssistantDevice(deviceId, command),
        options,
    );
}

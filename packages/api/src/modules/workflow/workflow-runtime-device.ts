export function normalizeDeviceIdentity(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function collectDeviceIdentities(
    ...values: Array<string | null | undefined>
): string[] {
    const keys = new Set<string>();
    for (const value of values) {
        if (!value) continue;
        const normalized = normalizeDeviceIdentity(value);
        if (normalized.length >= 8) keys.add(normalized);
    }
    return [...keys];
}

export type LuaDeviceMatchInput = {
    deviceId: string;
    online?: boolean;
    macAddress?: string | null;
    clientId?: string | null;
};

export type CubeCatDeviceMatchInput = {
    macAddress?: string | null;
    serialNumber?: string | null;
    clientId?: string | null;
    online?: boolean;
};

/**
 * Map a CubeCat (Xiaozhi/claw4) hardware identity onto a Lua-channel device.
 * Prefer an online script channel belonging to an online CubeCat.
 */
export function matchLuaDeviceId(
    luaDevices: LuaDeviceMatchInput[],
    cubeCatDevices: CubeCatDeviceMatchInput[],
): { deviceId: string; online: boolean } | undefined {
    const luaByIdentity = new Map<string, LuaDeviceMatchInput>();
    for (const device of luaDevices) {
        for (const key of collectDeviceIdentities(
            device.deviceId,
            device.macAddress,
            device.clientId,
        )) {
            const existing = luaByIdentity.get(key);
            if (!existing || (!existing.online && device.online)) {
                luaByIdentity.set(key, device);
            }
        }
    }

    const ordered = [
        ...cubeCatDevices.filter((device) => device.online),
        ...cubeCatDevices.filter((device) => !device.online),
    ];

    let offlineMatch: { deviceId: string; online: boolean } | undefined;
    for (const device of ordered) {
        const keys = collectDeviceIdentities(
            device.macAddress,
            device.serialNumber,
            device.clientId,
        );
        for (const key of keys) {
            const lua = luaByIdentity.get(key);
            if (!lua) continue;
            const match = { deviceId: lua.deviceId, online: Boolean(lua.online) };
            if (match.online) return match;
            offlineMatch ??= match;
        }
    }
    return offlineMatch;
}

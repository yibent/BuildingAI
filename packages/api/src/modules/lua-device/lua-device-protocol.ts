export function calculateLuaChunkCrc32(value: Buffer): string {
    let crc = 0xffffffff;
    for (const byte of value) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
    }
    return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickIdentity(...values: unknown[]): string | undefined {
    for (const value of values) {
        if (typeof value !== "string") continue;
        const trimmed = value.trim();
        if (trimmed.length >= 8 && trimmed.length <= 64) return trimmed;
    }
    return undefined;
}

/**
 * Claw4 hello puts Board UUID in `data.device_id` and MAC on the top-level
 * `device` object / `Device-Id` header. Xiaozhi's device list is keyed by MAC
 * (and sometimes `client_id` = UUID). Keep UUID as the Lua channel id, but
 * surface MAC + UUID so workflow routing can match the same hardware.
 */
export function extractLuaHelloIdentities(input: {
    data: Record<string, unknown>;
    headerDeviceId?: string;
    headerClientId?: string;
}): { deviceId?: string; macAddress?: string; clientId?: string } {
    const device = isRecord(input.data.device) ? input.data.device : {};
    const clientId = pickIdentity(
        device.uuid,
        input.data.device_id,
        input.headerClientId,
    );
    const macAddress = pickIdentity(
        device.mac,
        device.mac_address,
        input.headerDeviceId,
    );
    return {
        deviceId: pickIdentity(input.data.device_id, device.uuid, clientId, macAddress),
        macAddress,
        clientId,
    };
}

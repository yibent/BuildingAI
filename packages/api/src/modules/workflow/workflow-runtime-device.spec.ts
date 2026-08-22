import { matchLuaDeviceId, normalizeDeviceIdentity } from "./workflow-runtime-device";

describe("matchLuaDeviceId", () => {
    it("matches a CubeCat MAC to the Lua channel device id", () => {
        const match = matchLuaDeviceId(
            [{ deviceId: "aa:bb:cc:dd:ee:ff", online: true }],
            [{ macAddress: "AA-BB-CC-DD-EE-FF", online: true }],
        );
        expect(match).toEqual({ deviceId: "aa:bb:cc:dd:ee:ff", online: true });
        expect(normalizeDeviceIdentity("AA-BB-CC-DD-EE-FF")).toBe("aabbccddeeff");
    });

    it("matches a claw4 board uuid carried as client_id", () => {
        const match = matchLuaDeviceId(
            [{ deviceId: "3f2c1b0a-1111-4c2d-9e8f-abcdef123456", online: true }],
            [{ clientId: "3F2C1B0A-1111-4C2D-9E8F-ABCDEF123456", online: true }],
        );
        expect(match?.deviceId).toBe("3f2c1b0a-1111-4c2d-9e8f-abcdef123456");
    });

    it("prefers the online Lua channel when both online and offline identities exist", () => {
        const match = matchLuaDeviceId(
            [
                { deviceId: "aabbccddeeff", online: false },
                { deviceId: "aa:bb:cc:dd:ee:ff", online: true },
            ],
            [{ macAddress: "aa:bb:cc:dd:ee:ff", online: true }],
        );
        expect(match).toEqual({ deviceId: "aa:bb:cc:dd:ee:ff", online: true });
    });

    it("returns undefined when nothing overlaps", () => {
        expect(
            matchLuaDeviceId(
                [{ deviceId: "111111111111", online: true }],
                [{ macAddress: "aa:bb:cc:dd:ee:ff", online: true }],
            ),
        ).toBeUndefined();
    });

    it("matches Xiaozhi MAC to a Lua channel that registered with board UUID", () => {
        const match = matchLuaDeviceId(
            [
                {
                    deviceId: "3f2c1b0a-1111-4c2d-9e8f-abcdef123456",
                    macAddress: "aa:bb:cc:dd:ee:ff",
                    clientId: "3f2c1b0a-1111-4c2d-9e8f-abcdef123456",
                    online: true,
                },
            ],
            [{ macAddress: "AA-BB-CC-DD-EE-FF", clientId: "", online: true }],
        );
        expect(match).toEqual({
            deviceId: "3f2c1b0a-1111-4c2d-9e8f-abcdef123456",
            online: true,
        });
    });
});

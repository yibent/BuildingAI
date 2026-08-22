import { calculateLuaChunkCrc32, extractLuaHelloIdentities } from "./lua-device-protocol";

describe("Lua device protocol", () => {
    it("uses IEEE CRC-32 for source chunks", () => {
        expect(calculateLuaChunkCrc32(Buffer.from("123456789"))).toBe("cbf43926");
    });

    it("keeps board UUID as the Lua device id and surfaces the Wi-Fi MAC", () => {
        const identities = extractLuaHelloIdentities({
            data: {
                device_id: "3f2c1b0a-1111-4c2d-9e8f-abcdef123456",
                device: {
                    uuid: "3f2c1b0a-1111-4c2d-9e8f-abcdef123456",
                    mac: "aa:bb:cc:dd:ee:ff",
                },
            },
            headerDeviceId: "aa:bb:cc:dd:ee:ff",
            headerClientId: "3f2c1b0a-1111-4c2d-9e8f-abcdef123456",
        });
        expect(identities).toEqual({
            deviceId: "3f2c1b0a-1111-4c2d-9e8f-abcdef123456",
            macAddress: "aa:bb:cc:dd:ee:ff",
            clientId: "3f2c1b0a-1111-4c2d-9e8f-abcdef123456",
        });
    });

    it("falls back to handshake headers when hello omits the device object", () => {
        const identities = extractLuaHelloIdentities({
            data: { device_id: "3f2c1b0a-1111-4c2d-9e8f-abcdef123456" },
            headerDeviceId: "aa:bb:cc:dd:ee:ff",
            headerClientId: "3f2c1b0a-1111-4c2d-9e8f-abcdef123456",
        });
        expect(identities.macAddress).toBe("aa:bb:cc:dd:ee:ff");
        expect(identities.clientId).toBe("3f2c1b0a-1111-4c2d-9e8f-abcdef123456");
    });
});

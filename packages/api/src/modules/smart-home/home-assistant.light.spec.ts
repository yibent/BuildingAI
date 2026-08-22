import { buildLightServiceCall, normalizeLightState, parsePackedRgb } from "./home-assistant.light";

describe("home-assistant light mapping", () => {
    it("normalizes HA light state into percent brightness and hex color", () => {
        expect(
            normalizeLightState({
                entity_id: "light.desk",
                state: "on",
                attributes: {
                    brightness: 128,
                    rgb_color: [255, 128, 0],
                    color_temp_kelvin: 4000,
                    supported_color_modes: ["rgb", "color_temp"],
                    color_mode: "rgb",
                },
            }),
        ).toMatchObject({
            on: true,
            brightness: 50,
            color: "#ff8000",
            colorTemp: 4000,
            colorMode: "rgb",
        });
    });

    it("turns the lamp off with light.turn_off", () => {
        expect(buildLightServiceCall("light.desk", { on: false })).toEqual({
            domain: "light",
            service: "turn_off",
            data: { entity_id: "light.desk" },
        });
    });

    it("sends color as rgb and brightness as percent", () => {
        expect(buildLightServiceCall("light.desk", { brightness: 80, color: "#00ff00" })).toEqual({
            domain: "light",
            service: "turn_on",
            data: { entity_id: "light.desk", brightness_pct: 80, rgb_color: [0, 255, 0] },
        });
    });

    it("parses hex colors", () => {
        expect(parsePackedRgb("#0102ff")).toEqual([1, 2, 255]);
    });
});

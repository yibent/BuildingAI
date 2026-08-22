import { COLOR_MODES } from "./home-assistant.constants";
import type { HomeAssistantLightState } from "@buildingai/db/entities";

export type HomeAssistantStatePayload = {
    entity_id?: string;
    state?: string;
    attributes?: Record<string, unknown>;
    last_changed?: string;
    last_updated?: string;
};

export type HomeAssistantLightCommand = {
    on?: boolean;
    brightness?: number;
    color?: string;
    colorTemp?: number;
};

function asNumber(value: unknown): number | null {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item)).filter(Boolean);
}

export function parsePackedRgb(value: unknown): [number, number, number] | null {
    if (Array.isArray(value) && value.length >= 3) {
        const rgb = value.slice(0, 3).map((item) => Number(item));
        if (rgb.every((item) => Number.isFinite(item))) {
            return [rgb[0] & 255, rgb[1] & 255, rgb[2] & 255];
        }
    }
    if (typeof value === "string" && /^#?[0-9a-fA-F]{6}$/.test(value.trim())) {
        const hex = value.trim().replace("#", "");
        const packed = Number.parseInt(hex, 16);
        return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255];
    }
    return null;
}

export function rgbToHex(rgb: [number, number, number] | null): string | null {
    if (!rgb) return null;
    return `#${rgb.map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

export function brightnessToPercent(value: unknown): number | null {
    const numeric = asNumber(value);
    if (numeric === null) return null;
    if (numeric <= 0) return 0;
    if (numeric <= 100) return Math.round(numeric);
    return Math.max(1, Math.min(100, Math.round((numeric / 255) * 100)));
}

export function normalizeLightState(payload: HomeAssistantStatePayload): HomeAssistantLightState {
    const attributes = payload.attributes || {};
    const modes = asStringArray(attributes.supported_color_modes);
    const colorMode = typeof attributes.color_mode === "string" ? attributes.color_mode : null;
    const kelvin =
        asNumber(attributes.color_temp_kelvin) ??
        (asNumber(attributes.color_temp)
            ? Math.round(1_000_000 / Number(attributes.color_temp))
            : null);

    return {
        on: payload.state === "on" || payload.state === "true",
        brightness: brightnessToPercent(attributes.brightness ?? attributes.brightness_pct),
        color: rgbToHex(parsePackedRgb(attributes.rgb_color)),
        colorTemp: kelvin,
        colorMode,
        minKelvin: asNumber(attributes.min_color_temp_kelvin) ?? 1700,
        maxKelvin: asNumber(attributes.max_color_temp_kelvin) ?? 6500,
        supportedColorModes: modes,
    };
}

export function lightSupports(state: HomeAssistantLightState, feature: "brightness" | "color" | "colorTemp") {
    const modes = state.supportedColorModes || [];
    if (feature === "brightness") {
        return modes.some((mode) => COLOR_MODES.BRIGHTNESS.has(mode)) || state.brightness !== null;
    }
    if (feature === "color") return modes.some((mode) => COLOR_MODES.RGB.has(mode));
    return modes.some((mode) => COLOR_MODES.COLOR_TEMP.has(mode));
}

export function buildLightServiceCall(
    entityId: string,
    command: HomeAssistantLightCommand,
): { domain: "light"; service: "turn_on" | "turn_off"; data: Record<string, unknown> } {
    if (command.on === false) {
        return { domain: "light", service: "turn_off", data: { entity_id: entityId } };
    }

    const data: Record<string, unknown> = { entity_id: entityId };
    if (command.brightness !== undefined) {
        data.brightness_pct = Math.max(1, Math.min(100, Math.round(command.brightness)));
    }
    if (command.color) {
        const rgb = parsePackedRgb(command.color);
        if (rgb) data.rgb_color = rgb;
    } else if (command.colorTemp !== undefined) {
        data.color_temp_kelvin = Math.round(command.colorTemp);
    }

    return { domain: "light", service: "turn_on", data };
}

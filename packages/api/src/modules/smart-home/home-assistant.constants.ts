export const HOME_ASSISTANT_HTTP_TIMEOUT_MS = 15_000;
export const HOME_ASSISTANT_TOKEN_REFRESH_MARGIN_MS = 60_000;
export const HOME_ASSISTANT_SYNC_DOMAINS = [
    "light",
    "switch",
    "climate",
    "cover",
    "fan",
    "lock",
    "vacuum",
    "media_player",
] as const;

export const HOME_ASSISTANT_CATEGORY_LABELS: Record<string, string> = {
    light: "灯光",
    switch: "开关与插座",
    climate: "空调与温控",
    cover: "窗帘",
    fan: "风扇",
    lock: "门锁",
    vacuum: "扫地机器人",
    media_player: "媒体设备",
    other: "其他设备",
};

export const COLOR_MODES = {
    RGB: new Set(["rgb", "rgbw", "rgbww", "hs", "xy"]),
    COLOR_TEMP: new Set(["color_temp"]),
    BRIGHTNESS: new Set(["brightness", "white", "rgb", "rgbw", "rgbww", "hs", "xy", "color_temp"]),
};

export function homeAssistantCategoryLabel(domain: string): string {
    return HOME_ASSISTANT_CATEGORY_LABELS[domain] || HOME_ASSISTANT_CATEGORY_LABELS.other;
}

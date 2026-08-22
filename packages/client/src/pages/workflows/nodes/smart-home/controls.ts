import type { HomeAssistantDevice, HomeAssistantLightState } from "@buildingai/services/web";

export type SmartHomeProvider = "homeassistant";

export type SmartHomeControlCommand = {
  on?: boolean;
  brightness?: number;
  color?: string;
  colorTemp?: number;
  mode?: "color" | "white";
};

export type UnifiedSmartHomeDevice = {
  id: string;
  provider: SmartHomeProvider;
  entityId: string;
  name: string;
  category: string;
  categoryLabel: string;
  online: boolean;
  areaName: string | null;
  state: HomeAssistantLightState;
};

const COLOR_MODES = {
  rgb: new Set(["rgb", "rgbw", "rgbww", "hs", "xy"]),
  colorTemp: new Set(["color_temp"]),
  brightness: new Set(["brightness", "white", "rgb", "rgbw", "rgbww", "hs", "xy", "color_temp"]),
};

export const CATEGORY_LABELS: Record<string, string> = {
  binary_sensor: "二进制传感器",
  button: "按钮",
  camera: "摄像头",
  climate: "空调与温控",
  cover: "窗帘",
  fan: "风扇",
  humidifier: "加湿器",
  light: "灯光",
  lock: "门锁",
  media_player: "媒体设备",
  sensor: "传感器",
  switch: "开关",
  vacuum: "扫地机器人",
  air_purifier: "空气净化器",
  other: "其他设备",
};

export function getCategoryLabel(category: string, fallback?: string | null): string {
  return CATEGORY_LABELS[category] || (fallback && !/[A-Za-z]/.test(fallback) ? fallback : "其他设备");
}

export function unifyHomeAssistantDevice(device: HomeAssistantDevice): UnifiedSmartHomeDevice {
  return {
    id: device.id,
    provider: "homeassistant",
    entityId: device.entityId,
    name: device.name,
    category: device.category,
    categoryLabel: device.categoryLabel,
    online: device.online,
    areaName: device.areaName,
    state: device.state,
  };
}

export function lightFeatures(device: UnifiedSmartHomeDevice) {
  const modes = device.state.supportedColorModes || [];
  const hasColor = modes.some((mode) => COLOR_MODES.rgb.has(mode));
  const hasColorTemp = modes.some((mode) => COLOR_MODES.colorTemp.has(mode));
  const hasBrightness =
    modes.some((mode) => COLOR_MODES.brightness.has(mode)) || device.state.brightness !== null;
  const liveColorMode = device.state.colorMode
    ? COLOR_MODES.rgb.has(device.state.colorMode)
    : hasColor && !hasColorTemp;
  return { hasBrightness, hasColor, hasColorTemp, liveColorMode };
}

export function defaultCommandForCategory(category: string): SmartHomeControlCommand {
  if (category === "light" || category === "switch" || category === "fan" || category === "climate") {
    return { on: true };
  }
  return {};
}

export function commandSummary(command: SmartHomeControlCommand | undefined): string {
  if (!command) return "尚未配置控制";
  const parts: string[] = [];
  if (command.on === true) parts.push("开启");
  if (command.on === false) parts.push("关闭");
  if (command.brightness !== undefined) parts.push(`亮度 ${Math.round(command.brightness)}%`);
  if (command.colorTemp !== undefined) parts.push(`色温 ${Math.round(command.colorTemp)}K`);
  if (command.color) parts.push("彩光");
  if (command.mode === "white") parts.push("白光");
  if (command.mode === "color") parts.push("彩光模式");
  return parts.length ? parts.join(" · ") : "读取当前状态";
}

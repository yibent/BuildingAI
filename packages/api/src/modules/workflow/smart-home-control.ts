export type SmartHomeProvider = "homeassistant";

export type SmartHomeControlCommand = {
    on?: boolean;
    brightness?: number;
    color?: string | number;
    colorTemp?: number;
};

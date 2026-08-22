const CUBECAT_NODE_TYPES = new Set([
    "lua",
    "speech",
    "device_control",
    "agent",
    "wait",
    "webhook",
]);

export function workflowNeedsCubeCat(schema: unknown): boolean {
    return someNode(schema, (type) => type.startsWith("user_lua_") || CUBECAT_NODE_TYPES.has(type));
}

function someNode(value: unknown, predicate: (type: string) => boolean): boolean {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some((item) => someNode(item, predicate));
    const record = value as Record<string, unknown>;
    if (typeof record.type === "string" && predicate(record.type)) return true;
    return someNode(record.nodes, predicate) || someNode(record.blocks, predicate);
}

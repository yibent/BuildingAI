export const DEFAULT_CALLBACK_TOOL_NAME = "classroom_report_completion";

export type WorkflowGraphNode = {
    id: string;
    type: string;
    data?: Record<string, unknown>;
};

export type WorkflowGraphEdge = {
    sourceNodeID: string;
    targetNodeID: string;
    sourcePortID?: string;
};

export type WorkflowGraph = {
    nodes?: WorkflowGraphNode[];
    edges?: WorkflowGraphEdge[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function asText(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (value === undefined || value === null) return "";
    return String(value).trim();
}

function isErrorPort(port?: string): boolean {
    return port === "error" || port === "timeout";
}

/** Event name CubeCat should put in `action` when calling the shared callback tool. */
export function webhookActionName(node: WorkflowGraphNode): string {
    return asText(node.data?.toolName) || asText(node.data?.action) || node.id.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Webhooks this agent should talk about: follow the happy path until the next
 * agent node. Error/timeout branches are ignored so timeout Lua does not leak
 * into the live prompt.
 */
export function collectDownstreamWebhookNodes(
    schema: WorkflowGraph | undefined,
    fromNodeId: string,
): WorkflowGraphNode[] {
    if (!schema || !fromNodeId) return [];
    const nodes = Array.isArray(schema.nodes) ? schema.nodes : [];
    const edges = Array.isArray(schema.edges) ? schema.edges : [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    if (!nodeById.has(fromNodeId)) return [];

    const outgoing = new Map<string, WorkflowGraphEdge[]>();
    for (const edge of edges) {
        if (!edge.sourceNodeID || !edge.targetNodeID) continue;
        const list = outgoing.get(edge.sourceNodeID) ?? [];
        list.push(edge);
        outgoing.set(edge.sourceNodeID, list);
    }

    const collected: WorkflowGraphNode[] = [];
    const seen = new Set<string>();
    const queue = [fromNodeId];
    while (queue.length) {
        const id = queue.shift();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const node = nodeById.get(id);
        if (!node) continue;
        if (id !== fromNodeId && node.type === "agent") continue;
        if (id !== fromNodeId && node.type === "webhook") collected.push(node);
        for (const edge of outgoing.get(id) ?? []) {
            if (isErrorPort(edge.sourcePortID)) continue;
            queue.push(edge.targetNodeID);
        }
    }
    return collected;
}

export function exampleValueForSchemaProperty(property: unknown, fallback: string): unknown {
    if (!isRecord(property)) return fallback;
    if (property.default !== undefined) return property.default;
    if (property.type === "number") return 0;
    if (property.type === "boolean") return true;
    if (property.type === "object") return {};
    if (property.type === "array") return [];
    if (typeof property.title === "string" && property.title) return property.title;
    return fallback;
}

export function buildWebhookCallbackInstruction(input: {
    mcpToolName: string;
    action: string;
    title?: string;
    description?: string;
    inputSchema?: unknown;
}): string {
    const toolName = input.mcpToolName.trim() || DEFAULT_CALLBACK_TOOL_NAME;
    const action = input.action.trim();
    const title = asText(input.title);
    const description = asText(input.description);
    const properties =
        isRecord(input.inputSchema) && isRecord(input.inputSchema.properties)
            ? input.inputSchema.properties
            : {};
    const example: Record<string, unknown> = { action };
    for (const [key, property] of Object.entries(properties)) {
        if (key === "action") continue;
        example[key] = exampleValueForSchemaProperty(property, key);
    }
    const lines = [
        title ? `当需要「${title}」时，调用 MCP 工具 ${toolName}。` : `调用 MCP 工具 ${toolName}。`,
        `action 必须填 "${action}"。`,
    ];
    if (description) lines.push(description);
    lines.push(`调用参数示例：\n${JSON.stringify(example, null, 2)}`);
    lines.push(
        "只调用这个常驻工具，不要再找其它工具名。只在确认对应事情已经发生后调用一次，不要提前或重复调用。",
    );
    return lines.join("\n");
}

export function appendWebhookInstructions(prompt: string, instructions: string[]): string {
    const body = instructions.map((item) => item.trim()).filter(Boolean);
    if (!body.length) return prompt.trim();
    return `${prompt.trim()}\n\n【回传】\n${body.join("\n\n")}`;
}

/** Flatten `data: { ... }` into the top-level payload CubeCat actually sent. */
export function mergeCallbackPayload(args: Record<string, unknown>): Record<string, unknown> {
    const nested = isRecord(args.data) ? args.data : {};
    return { ...nested, ...args };
}

export function callbackActionFromPayload(payload: Record<string, unknown>): string {
    return asText(payload.action) || asText(payload.event) || asText(payload.task_key);
}

export function matchesCallbackAction(expectedAction: string, payload: Record<string, unknown>): boolean {
    const expected = expectedAction.trim();
    if (!expected) return true;
    const got = callbackActionFromPayload(payload);
    if (!got) return true;
    return got === expected;
}

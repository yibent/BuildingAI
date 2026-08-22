import type { FlowGramNode } from "@flowgram.ai/runtime-interface";
import type {
    ExecutionContext,
    ExecutionResult,
    IExecutor,
    INodeExecutor,
    INodeExecutorFactory,
} from "@flowgram.ai/runtime-interface";

export class WorkflowRuntimeExecutor implements IExecutor {
    private nodeExecutors: Map<FlowGramNode, INodeExecutor> = new Map();

    constructor(nodeExecutors: INodeExecutorFactory[]) {
        // register node executors
        nodeExecutors.forEach((executor) => {
            this.register(new executor());
        });
    }

    public register(executor: INodeExecutor): void {
        this.nodeExecutors.set(executor.type, executor);
    }

    public async execute(context: ExecutionContext): Promise<ExecutionResult> {
        const nodeType = context.node.type;
        const nodeExecutor = this.getExecutor(nodeType, context.node.data);
        if (!nodeExecutor) {
            throw new Error(`No executor found for node type ${nodeType}`);
        }
        const output = await nodeExecutor.execute(context);
        return output;
    }

    private getExecutor(nodeType: FlowGramNode, data?: unknown): INodeExecutor | undefined {
        const direct = this.nodeExecutors.get(nodeType);
        if (direct) return direct;
        // "我的模块" nodes are per-module types that run the same Lua runtime.
        if (typeof nodeType === "string" && nodeType.startsWith("user_lua_")) {
            return this.nodeExecutors.get("lua" as FlowGramNode);
        }
        if (typeof nodeType === "string" && nodeType.startsWith("project_tool_")) {
            const record = isRecord(data) ? data : undefined;
            if (record?.provider === "homeassistant" || record?.deviceId) {
                return this.nodeExecutors.get("smart_home" as FlowGramNode);
            }
            if (record?.mcpServerId) {
                return this.nodeExecutors.get("mcp" as FlowGramNode);
            }
        }
        return undefined;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

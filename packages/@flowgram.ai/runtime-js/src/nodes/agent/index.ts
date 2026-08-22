import type {
    ExecutionContext,
    ExecutionResult,
    FlowGramNode,
    INodeExecutor,
} from "@flowgram.ai/runtime-interface";

export type AgentExecutorInput = {
    userId?: string;
    runtimeContext?: {
        projectId?: string;
        runtimeTarget?: "local" | "simulator" | "device";
        simulatorSessionId?: string;
        deviceId?: string;
        xiaozhiAgentId?: string;
        publishedSnapshot?: unknown;
        workflowSchema?: unknown;
    };
    node: { id: string; type: string; data?: Record<string, unknown> };
    inputs: Record<string, unknown>;
};

export type AgentExecutorHandler = (
    input: AgentExecutorInput,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

let workflowRuntimeAgentExecutor: AgentExecutorHandler | undefined;

export const registerAgentExecutor = (executor: AgentExecutorHandler): void => {
    workflowRuntimeAgentExecutor = executor;
};

export class AgentExecutor implements INodeExecutor {
    public readonly type = "agent" as FlowGramNode;

    public async execute(context: ExecutionContext): Promise<ExecutionResult> {
        if (!workflowRuntimeAgentExecutor) {
            throw new Error("Agent executor is not registered");
        }
        const outputs = await workflowRuntimeAgentExecutor({
            userId: getWorkflowRuntimeUserId(context),
            runtimeContext: getWorkflowRuntimeContext(context),
            node: {
                id: context.node.id,
                type: context.node.type,
                data: isRecord(context.node.data) ? context.node.data : undefined,
            },
            inputs: context.inputs,
        });
        return { outputs: outputs ?? {} };
    }
}

function getWorkflowRuntimeUserId(context: ExecutionContext): string | undefined {
    const runtime = context.runtime as { metadata?: { userId?: unknown } };
    return typeof runtime.metadata?.userId === "string" ? runtime.metadata.userId : undefined;
}

function getWorkflowRuntimeContext(context: ExecutionContext): AgentExecutorInput["runtimeContext"] {
    const runtime = context.runtime as { metadata?: Record<string, unknown> };
    const metadata = runtime.metadata ?? {};
    return {
        ...(typeof metadata.projectId === "string" ? { projectId: metadata.projectId } : {}),
        ...(metadata.runtimeTarget === "local" ||
        metadata.runtimeTarget === "simulator" ||
        metadata.runtimeTarget === "device"
            ? { runtimeTarget: metadata.runtimeTarget }
            : {}),
        ...(typeof metadata.simulatorSessionId === "string"
            ? { simulatorSessionId: metadata.simulatorSessionId }
            : {}),
        ...(typeof metadata.deviceId === "string" ? { deviceId: metadata.deviceId } : {}),
        ...(typeof metadata.xiaozhiAgentId === "string"
            ? { xiaozhiAgentId: metadata.xiaozhiAgentId }
            : {}),
        ...(metadata.publishedSnapshot ? { publishedSnapshot: metadata.publishedSnapshot } : {}),
        ...(metadata.workflowSchema ? { workflowSchema: metadata.workflowSchema } : {}),
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

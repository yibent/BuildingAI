import type { ExecutionContext } from "@flowgram.ai/runtime-interface";

export type WorkflowRuntimeExecutorContext = {
    projectId?: string;
    runtimeTarget?: "local" | "simulator" | "device";
    simulatorSessionId?: string;
    deviceId?: string;
    xiaozhiAgentId?: string;
    publishedSnapshot?: unknown;
    installationId?: string;
    workflowTaskId?: string;
    workflowSchema?: unknown;
};

export function getWorkflowRuntimeUserId(context: ExecutionContext): string | undefined {
    const runtime = context.runtime as { metadata?: { userId?: unknown } };
    return typeof runtime.metadata?.userId === "string" ? runtime.metadata.userId : undefined;
}

export function readRuntimeMetadata(context: ExecutionContext): WorkflowRuntimeExecutorContext {
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
        ...(typeof metadata.installationId === "string"
            ? { installationId: metadata.installationId }
            : {}),
        ...(typeof metadata.workflowTaskId === "string"
            ? { workflowTaskId: metadata.workflowTaskId }
            : {}),
        ...(metadata.workflowSchema ? { workflowSchema: metadata.workflowSchema } : {}),
    };
}

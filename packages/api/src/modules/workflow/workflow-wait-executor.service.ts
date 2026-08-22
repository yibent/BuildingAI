import type { ProgrammingProjectPublishedSnapshot } from "@buildingai/db/entities";
import { HttpErrorFactory } from "@buildingai/errors";
import type { WaitExecutorInput, WaitExecutorResult } from "@flowgram.ai/runtime-js";
import { Injectable } from "@nestjs/common";

import { XiaozhiMcpService } from "../organization/services/xiaozhi-mcp.service";
import { WorkflowWaitRegistry } from "./workflow-wait-registry.service";

function isPublishedSnapshot(value: unknown): value is ProgrammingProjectPublishedSnapshot {
    return (
        !!value &&
        typeof value === "object" &&
        (value as ProgrammingProjectPublishedSnapshot).version === 1
    );
}

function asText(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === undefined || value === null) return "";
    return String(value);
}

function asNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
        return Number(value);
    }
    return undefined;
}

@Injectable()
export class WorkflowWaitExecutorService {
    constructor(
        private readonly waitRegistry: WorkflowWaitRegistry,
        private readonly mcpService: XiaozhiMcpService,
    ) {}

    async execute(input: WaitExecutorInput): Promise<WaitExecutorResult> {
        const waitType = asText(input.node.data?.waitType) || "timeout";
        if (waitType === "variable") {
            throw HttpErrorFactory.badRequest("等待变量变化尚未接入");
        }

        const timeoutMs =
            asNumber(input.inputs.timeoutMs) ?? asNumber(input.node.data?.timeoutMs) ?? 0;
        const context = asText(input.inputs.context);
        const startedAt = Date.now();

        if (waitType === "timeout") {
            if (!(timeoutMs > 0)) {
                throw HttpErrorFactory.badRequest("请设置大于 0 的等待时长");
            }
            await sleep(timeoutMs, input.signal);
            return {
                branch: "continue",
                outputs: {
                    triggered: true,
                    isTimeout: false,
                    data: {},
                    elapsedMs: Date.now() - startedAt,
                    context,
                },
            };
        }

        const triggerId =
            asText(input.inputs.triggerId).trim() || asText(input.node.data?.triggerId).trim();
        if (!triggerId) {
            throw HttpErrorFactory.badRequest(
                waitType === "webhook" ? "请填写 Webhook 标识" : "请填写要等待的 MCP 工具名",
            );
        }

        const xiaozhiAgentId = this.resolveAgentId(input);
        if (waitType === "mcp_call") {
            if (!xiaozhiAgentId) {
                throw HttpErrorFactory.badRequest("请先在工程设置中绑定 CubeCat 智能体");
            }
            if (!input.userId) {
                throw HttpErrorFactory.unauthorized("等待 MCP 调用需要登录后执行");
            }
            await this.mcpService.ensureAgentConnection(input.userId, xiaozhiAgentId);
        }

        const result = await this.waitRegistry.wait(
            {
                triggerId,
                xiaozhiAgentId,
                projectId: input.runtimeContext?.projectId,
                expectedDataPath: asText(input.node.data?.expectedDataPath).trim() || undefined,
                expectedValue: asText(input.node.data?.expectedValue),
            },
            { timeoutMs, signal: input.signal },
        );

        return {
            branch: result.timedOut ? "timeout" : "continue",
            outputs: {
                triggered: !result.timedOut,
                isTimeout: result.timedOut,
                data: result.event?.data ?? {},
                elapsedMs: result.elapsedMs,
                context,
            },
        };
    }

    private resolveAgentId(input: WaitExecutorInput): string | undefined {
        const snapshot = isPublishedSnapshot(input.runtimeContext?.publishedSnapshot)
            ? input.runtimeContext?.publishedSnapshot
            : undefined;
        const fromSnapshot = snapshot?.runtime.xiaozhiAgentId;
        const fromContext = input.runtimeContext?.xiaozhiAgentId;
        if (typeof fromSnapshot === "string" && fromSnapshot) return fromSnapshot;
        if (typeof fromContext === "string" && fromContext) return fromContext;
        return undefined;
    }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error("任务已取消"));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new Error("任务已取消"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

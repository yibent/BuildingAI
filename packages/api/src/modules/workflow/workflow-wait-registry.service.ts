import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";

import {
    XIAOZHI_MCP_TOOL_CALLED_EVENT,
    type XiaozhiMcpToolCalledEvent,
} from "../organization/services/xiaozhi-mcp.service";
import { matchesCallbackAction, mergeCallbackPayload } from "./workflow-callback";

export type WorkflowWaitEvent = {
    triggerId: string;
    toolName?: string;
    agentBindingId?: string;
    projectId?: string;
    data: Record<string, unknown>;
};

export type WorkflowWaitFilter = {
    triggerId: string;
    xiaozhiAgentId?: string;
    projectId?: string;
    expectedDataPath?: string;
    expectedValue?: string;
};

type Waiter = {
    filter: WorkflowWaitFilter;
    resolve: (event: WorkflowWaitEvent) => void;
};

@Injectable()
export class WorkflowWaitRegistry {
    private readonly waiters = new Set<Waiter>();

    wait(
        filter: WorkflowWaitFilter,
        options: { timeoutMs?: number; signal?: AbortSignal } = {},
    ): Promise<{ timedOut: boolean; event?: WorkflowWaitEvent; elapsedMs: number }> {
        const startedAt = Date.now();
        return new Promise((resolve, reject) => {
            let settled = false;
            const waiter: Waiter = {
                filter,
                resolve: (event) =>
                    finish({ timedOut: false, event, elapsedMs: Date.now() - startedAt }),
            };

            const finish = (result: {
                timedOut: boolean;
                event?: WorkflowWaitEvent;
                elapsedMs: number;
            }) => {
                if (settled) return;
                settled = true;
                this.waiters.delete(waiter);
                if (timer) clearTimeout(timer);
                options.signal?.removeEventListener("abort", onAbort);
                resolve(result);
            };

            const onAbort = () => {
                if (settled) return;
                settled = true;
                this.waiters.delete(waiter);
                if (timer) clearTimeout(timer);
                reject(new Error("任务已取消"));
            };

            this.waiters.add(waiter);
            const timeoutMs = options.timeoutMs ?? 0;
            const timer =
                timeoutMs > 0
                    ? setTimeout(() => {
                          finish({ timedOut: true, elapsedMs: Date.now() - startedAt });
                      }, timeoutMs)
                    : undefined;

            if (options.signal?.aborted) {
                onAbort();
                return;
            }
            options.signal?.addEventListener("abort", onAbort, { once: true });
        });
    }

    emit(event: WorkflowWaitEvent): number {
        const matched = [...this.waiters].filter((waiter) =>
            matchesWaitFilter(waiter.filter, event),
        );
        for (const waiter of matched) {
            waiter.resolve(event);
        }
        return matched.length;
    }

    @OnEvent(XIAOZHI_MCP_TOOL_CALLED_EVENT)
    onXiaozhiToolCalled(payload: XiaozhiMcpToolCalledEvent) {
        this.emit({
            triggerId: payload.toolName,
            toolName: payload.toolName,
            agentBindingId: payload.agentBindingId,
            data: payload.arguments ?? {},
        });
    }
}

function matchesWaitFilter(filter: WorkflowWaitFilter, event: WorkflowWaitEvent): boolean {
    const idMatch =
        event.triggerId === filter.triggerId ||
        event.toolName === filter.triggerId ||
        filter.triggerId === event.toolName;
    if (!idMatch) return false;
    if (
        filter.xiaozhiAgentId &&
        event.agentBindingId &&
        event.agentBindingId !== filter.xiaozhiAgentId
    ) {
        return false;
    }
    if (filter.projectId && event.projectId && event.projectId !== filter.projectId) {
        return false;
    }
    if (filter.expectedDataPath) {
        const got = readPath(event.data, filter.expectedDataPath);
        if (got === undefined) return false;
        if (
            filter.expectedValue !== undefined &&
            filter.expectedValue !== "" &&
            String(got) !== filter.expectedValue
        ) {
            return false;
        }
        return true;
    }
    if (filter.expectedValue !== undefined && filter.expectedValue !== "") {
        return matchesCallbackAction(filter.expectedValue, mergeCallbackPayload(event.data));
    }
    return true;
}

function readPath(data: unknown, path: string): unknown {
    if (!path) return data;
    const parts = path.split(".").filter(Boolean);
    let current: unknown = data;
    for (const part of parts) {
        if (!current || typeof current !== "object") return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

import type { ProgrammingProjectPublishedSnapshot } from "@buildingai/db/entities";
import { HttpErrorFactory } from "@buildingai/errors";
import type { WebhookExecutorInput, WebhookExecutorResult } from "@flowgram.ai/runtime-js";
import { Injectable } from "@nestjs/common";

import { XiaozhiMcpService } from "../organization/services/xiaozhi-mcp.service";
import {
    DEFAULT_CALLBACK_TOOL_NAME,
    mergeCallbackPayload,
    webhookActionName,
} from "./workflow-callback";
import { WorkflowWaitRegistry } from "./workflow-wait-registry.service";

const ACTION_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

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
export class WorkflowWebhookExecutorService {
    constructor(
        private readonly waitRegistry: WorkflowWaitRegistry,
        private readonly mcpService: XiaozhiMcpService,
    ) {}

    async execute(input: WebhookExecutorInput): Promise<WebhookExecutorResult> {
        const actionName = webhookActionName({
            id: input.node.id,
            type: input.node.type,
            data: input.node.data,
        });
        if (!actionName) throw HttpErrorFactory.badRequest("请填写回传事件名");
        if (!ACTION_NAME_PATTERN.test(actionName)) {
            throw HttpErrorFactory.badRequest("事件名必须以字母开头，只能包含字母、数字和下划线");
        }
        if (!input.userId) {
            throw HttpErrorFactory.unauthorized("回传端点需要登录后执行");
        }

        const agentId = this.resolveAgentId(input);
        if (!agentId) {
            throw HttpErrorFactory.badRequest("请先在工程设置中绑定 CubeCat 智能体");
        }

        const timeoutMs = asNumber(input.node.data?.timeoutMs) ?? 0;
        const context = asText(input.inputs.context);
        const mcpToolName =
            (await this.mcpService.resolveCallbackToolName(agentId)) || DEFAULT_CALLBACK_TOOL_NAME;

        const result = await this.waitRegistry.wait(
            {
                triggerId: mcpToolName,
                xiaozhiAgentId: agentId,
                projectId: input.runtimeContext?.projectId,
                expectedValue: actionName,
            },
            { timeoutMs, signal: input.signal },
        );

        if (result.timedOut) {
            return {
                branch: "error",
                outputs: {
                    received: false,
                    data: {},
                    action: "",
                    timestamp: Date.now(),
                    context,
                },
            };
        }

        const payload = mergeCallbackPayload(
            result.event?.data && typeof result.event.data === "object"
                ? result.event.data
                : {},
        );

        return {
            branch: "received",
            outputs: {
                received: true,
                data: payload,
                action: asText(payload.action) || actionName,
                timestamp: Date.now(),
                context,
            },
        };
    }

    private resolveAgentId(input: WebhookExecutorInput): string | undefined {
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

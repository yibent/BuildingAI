import type { ProgrammingProjectPublishedSnapshot } from "@buildingai/db/entities";
import { HttpErrorFactory } from "@buildingai/errors";
import { Injectable } from "@nestjs/common";

import { XiaozhiMcpService } from "../organization/services/xiaozhi-mcp.service";
import { XiaozhiService } from "../organization/services/xiaozhi.service";
import {
    appendWebhookInstructions,
    buildWebhookCallbackInstruction,
    collectDownstreamWebhookNodes,
    DEFAULT_CALLBACK_TOOL_NAME,
    type WorkflowGraph,
    webhookActionName,
} from "./workflow-callback";

export type WorkflowAgentExecutorInput = {
    userId?: string;
    runtimeContext?: {
        projectId?: string;
        xiaozhiAgentId?: string;
        publishedSnapshot?: unknown;
        workflowSchema?: unknown;
    };
    node: {
        id: string;
        type: string;
        data?: Record<string, unknown>;
    };
    inputs: Record<string, unknown>;
};

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

@Injectable()
export class WorkflowAgentExecutorService {
    constructor(
        private readonly xiaozhiService: XiaozhiService,
        private readonly mcpService: XiaozhiMcpService,
    ) {}

    async execute(input: WorkflowAgentExecutorInput): Promise<Record<string, unknown>> {
        if (!input.userId) {
            throw HttpErrorFactory.unauthorized("智能体节点需要登录后执行");
        }

        const action = asText(input.node.data?.action) || "switch_prompt";
        if (action !== "switch_prompt") {
            throw HttpErrorFactory.badRequest("当前仅支持「切换提示词」。启用/停用尚未接入。");
        }

        const agentId = this.resolveAgentId(input);
        if (!agentId) {
            throw HttpErrorFactory.badRequest("请先在工程设置中选择 CubeCat 设备");
        }

        const prompt = asText(input.inputs.prompt) || asText(input.node.data?.prompt);
        if (!prompt.trim()) {
            throw HttpErrorFactory.badRequest("请填写要切换的提示词内容");
        }

        const trigger = asText(input.inputs.trigger).trim();
        const withTrigger = trigger
            ? `${prompt.trim()}\n\n【工作流触发信息】\n${trigger}`
            : prompt.trim();
        const character = await this.withWebhookInstructions(withTrigger, input, agentId);

        const result = await this.xiaozhiService.switchCharacterForUser(
            input.userId,
            agentId,
            character,
        );

        return {
            success: true,
            previousPrompt: result.previousCharacter,
            currentPrompt: character,
            agentName: result.agentName,
        };
    }

    private resolveAgentId(input: WorkflowAgentExecutorInput): string | undefined {
        const snapshot = isPublishedSnapshot(input.runtimeContext?.publishedSnapshot)
            ? input.runtimeContext?.publishedSnapshot
            : undefined;
        const fromSnapshot = snapshot?.runtime.xiaozhiAgentId;
        const fromContext = input.runtimeContext?.xiaozhiAgentId;
        if (typeof fromSnapshot === "string" && fromSnapshot) return fromSnapshot;
        if (typeof fromContext === "string" && fromContext) return fromContext;
        return undefined;
    }

    private async withWebhookInstructions(
        prompt: string,
        input: WorkflowAgentExecutorInput,
        agentId: string,
    ): Promise<string> {
        const schema = this.resolveWorkflowSchema(input);
        const webhooks = collectDownstreamWebhookNodes(schema, input.node.id);
        if (!webhooks.length) return prompt;
        const mcpToolName =
            (await this.mcpService.resolveCallbackToolName(agentId)) || DEFAULT_CALLBACK_TOOL_NAME;
        return appendWebhookInstructions(
            prompt,
            webhooks.map((node) =>
                buildWebhookCallbackInstruction({
                    mcpToolName,
                    action: webhookActionName(node),
                    title: asText(node.data?.title),
                    description: asText(node.data?.toolDescription),
                    inputSchema: node.data?.inputSchema,
                }),
            ),
        );
    }

    private resolveWorkflowSchema(input: WorkflowAgentExecutorInput): WorkflowGraph | undefined {
        const fromContext = input.runtimeContext?.workflowSchema;
        if (fromContext && typeof fromContext === "object") {
            return fromContext as WorkflowGraph;
        }
        const snapshot = isPublishedSnapshot(input.runtimeContext?.publishedSnapshot)
            ? input.runtimeContext?.publishedSnapshot
            : undefined;
        const fromSnapshot = snapshot?.workflow?.schema;
        if (fromSnapshot && typeof fromSnapshot === "object") {
            return fromSnapshot as WorkflowGraph;
        }
        return undefined;
    }
}

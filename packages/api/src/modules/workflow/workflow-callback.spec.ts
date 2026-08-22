import { buildDecryptGameSchema } from "./programming-project-templates";
import {
    appendWebhookInstructions,
    buildWebhookCallbackInstruction,
    collectDownstreamWebhookNodes,
    matchesCallbackAction,
    mergeCallbackPayload,
    webhookActionName,
} from "./workflow-callback";

describe("workflow callback helpers", () => {
    const schema = buildDecryptGameSchema("lua-module-id") as {
        nodes: Array<{ id: string; type: string; data?: Record<string, unknown> }>;
        edges: Array<{ sourceNodeID: string; targetNodeID: string; sourcePortID?: string }>;
    };

    it("injects only the next happy-path webhook into an agent prompt", () => {
        const host = collectDownstreamWebhookNodes(schema, "agent_host");
        expect(host.map((node) => node.id)).toEqual(["webhook_choose_1"]);
        expect(webhookActionName(host[0])).toBe("choose_puzzle");

        const adapt = collectDownstreamWebhookNodes(schema, "agent_adapt");
        expect(adapt.map((node) => node.id)).toEqual(["webhook_choose_2"]);
    });

    it("writes the shared MCP tool name and action into the prompt snippet", () => {
        const text = buildWebhookCallbackInstruction({
            mcpToolName: "classroom_report_completion",
            action: "choose_puzzle",
            title: "等待选第一关",
            description: "game 只能填 caesar",
            inputSchema: {
                type: "object",
                properties: { game: { type: "string", title: "caesar" } },
            },
        });
        expect(text).toContain("classroom_report_completion");
        expect(text).toContain('action 必须填 "choose_puzzle"');
        expect(text).toContain('"game": "caesar"');
        expect(appendWebhookInstructions("你是馆长。", [text])).toContain("【回传】");
    });

    it("matches callback actions and flattens nested data", () => {
        expect(mergeCallbackPayload({ action: "choose_puzzle", data: { game: "caesar" } })).toMatchObject({
            action: "choose_puzzle",
            game: "caesar",
        });
        expect(matchesCallbackAction("choose_puzzle", { action: "choose_puzzle", game: "lock" })).toBe(
            true,
        );
        expect(matchesCallbackAction("choose_puzzle", { action: "submit_answer" })).toBe(false);
        expect(matchesCallbackAction("choose_puzzle", { game: "caesar" })).toBe(true);
    });
});

import { LuaRuntimeService } from "../lua/lua-runtime.service";
import { SimulatorService } from "../simulator/simulator.service";
import { buildDecryptGameSchema, DECRYPT_TEMPLATE_LUA } from "./programming-project-templates";

jest.mock("@buildingai/errors", () => ({
    HttpErrorFactory: {
        badRequest: (message: string) => new Error(message),
        notFound: (message: string) => new Error(message),
    },
}));

describe("decrypt programming project template", () => {
    it("uses Lua alert.show instead of the removed speech module", () => {
        expect(DECRYPT_TEMPLATE_LUA.draftCode).toContain('require("alert")');
        expect(DECRYPT_TEMPLATE_LUA.draftCode).not.toMatch(/require\(["']speech["']\)/);
        expect(DECRYPT_TEMPLATE_LUA.draftCode).not.toContain("speech.say");
    });

    it("is a three-step graph: Xiaozhi, wait for MCP, then one Lua game", () => {
        const schema = buildDecryptGameSchema("lua-module-id") as {
            nodes: Array<{ id: string; type: string }>;
            edges: Array<{ sourceNodeID: string; targetNodeID: string; sourcePortID?: string }>;
        };

        expect(schema.nodes.some((node) => node.type === "speech")).toBe(false);
        expect(schema.nodes.map((node) => node.id)).toEqual([
            "start_0",
            "agent_host",
            "webhook_choose_1",
            "lua_deal_1",
            "end_0",
        ]);
        expect(schema.edges).toEqual(
            expect.arrayContaining([
                { sourceNodeID: "start_0", targetNodeID: "agent_host" },
                { sourceNodeID: "agent_host", targetNodeID: "webhook_choose_1" },
                {
                    sourceNodeID: "webhook_choose_1",
                    targetNodeID: "lua_deal_1",
                    sourcePortID: "received",
                },
                { sourceNodeID: "lua_deal_1", targetNodeID: "end_0" },
            ]),
        );
        expect(DECRYPT_TEMPLATE_LUA.draftCode).toContain("接住小星星");
        expect(DECRYPT_TEMPLATE_LUA.draftCode).toContain("左右躲障碍");
        expect(DECRYPT_TEMPLATE_LUA.draftCode).not.toContain("小恐龙跳一跳");
        expect(JSON.stringify(schema)).toContain("star 或 dodge");
        expect(JSON.stringify(schema)).not.toContain("小恐龙跳一跳");
        expect(JSON.stringify(schema)).not.toContain("立刻调用工具 choose_puzzle");
        expect(JSON.stringify(schema)).not.toContain("立刻调用工具 submit_answer");
    });

    it("plays interactive rounds and returns a score instead of flashing a puzzle", async () => {
        const simulator = new SimulatorService();
        const runtime = new LuaRuntimeService(simulator);
        const session = simulator.create("student");
        const schema = buildDecryptGameSchema("lua-module-id") as {
            nodes: Array<{ id: string; data?: { inputsValues?: Record<string, unknown> } }>;
        };
        const dealNode = schema.nodes.find((node) => node.id === "lua_deal_1");
        expect(dealNode?.data?.inputsValues).toMatchObject({
            timeout_ms: { type: "constant", content: 40000 },
        });

        for (const [game, title] of [
            ["star", "接住小星星"],
            ["dodge", "左右躲障碍"],
        ] as const) {
            const result = await runtime.execute(
                DECRYPT_TEMPLATE_LUA.draftCode,
                { game, timeout_ms: 600 },
                session.id,
            );
            expect(result.output).toMatchObject({
                action: "deal",
                game,
                title,
                correct: false,
            });
            expect(result.output.message).toMatch(/分/);
        }
    });
});

import { LuaRuntimeService } from "../lua/lua-runtime.service";
import { SimulatorService } from "../simulator/simulator.service";
import {
    buildDecryptGameSchema,
    DECRYPT_TEMPLATE_LUA_A,
    DECRYPT_TEMPLATE_LUA_B,
} from "./programming-project-templates";

jest.mock("@buildingai/errors", () => ({
    HttpErrorFactory: {
        badRequest: (message: string) => new Error(message),
        notFound: (message: string) => new Error(message),
    },
}));

describe("decrypt programming project template", () => {
    it("asks Xiaozhi to pick Lua code A or B", () => {
        const schema = JSON.stringify(buildDecryptGameSchema("a-id", "b-id"));
        expect(schema).toContain("Lua 代码 A");
        expect(schema).toContain("Lua 代码 B");
        expect(schema).toContain("choose_code");
        expect(schema).not.toContain("正方形");
        expect(schema).not.toContain("圆形");
        expect(DECRYPT_TEMPLATE_LUA_A.draftCode).not.toMatch(/require\(["']speech["']\)/);
    });

    it("branches from Xiaozhi MCP into two Lua demo animations", () => {
        const schema = buildDecryptGameSchema("a-id", "b-id") as {
            nodes: Array<{ id: string; type: string; data?: { luaModuleId?: string } }>;
            edges: Array<{ sourceNodeID: string; targetNodeID: string; sourcePortID?: string }>;
        };

        expect(schema.nodes.some((node) => node.type === "speech")).toBe(false);
        expect(schema.nodes.map((node) => node.id)).toEqual([
            "start_0",
            "agent_host",
            "webhook_choose_1",
            "condition_code",
            "lua_a",
            "lua_b",
            "end_0",
        ]);
        expect(schema.nodes.find((node) => node.id === "lua_a")?.data?.luaModuleId).toBe("a-id");
        expect(schema.nodes.find((node) => node.id === "lua_b")?.data?.luaModuleId).toBe("b-id");
        expect(schema.edges).toEqual(
            expect.arrayContaining([
                { sourceNodeID: "agent_host", targetNodeID: "webhook_choose_1" },
                {
                    sourceNodeID: "webhook_choose_1",
                    targetNodeID: "condition_code",
                    sourcePortID: "received",
                },
                {
                    sourceNodeID: "condition_code",
                    targetNodeID: "lua_b",
                    sourcePortID: "if_b",
                },
                {
                    sourceNodeID: "condition_code",
                    targetNodeID: "lua_a",
                    sourcePortID: "else",
                },
            ]),
        );
    });

    it("plays each demo animation and returns a completion message", async () => {
        const simulator = new SimulatorService();
        const runtime = new LuaRuntimeService(simulator);
        const session = simulator.create("student");

        const demoA = await runtime.execute(
            DECRYPT_TEMPLATE_LUA_A.draftCode,
            { timeout_ms: 600 },
            session.id,
        );
        expect(demoA.output).toMatchObject({
            action: "show",
            code: "A",
            title: "Lua 代码 A",
            correct: true,
        });
        expect(demoA.output.message).toContain("Lua 代码 A");

        const demoB = await runtime.execute(
            DECRYPT_TEMPLATE_LUA_B.draftCode,
            { timeout_ms: 600 },
            session.id,
        );
        expect(demoB.output).toMatchObject({
            action: "show",
            code: "B",
            title: "Lua 代码 B",
            correct: true,
        });
        expect(demoB.output.message).toContain("Lua 代码 B");
    });
});

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
        expect(DECRYPT_TEMPLATE_LUA.draftCode).toContain("alert.show");
        expect(DECRYPT_TEMPLATE_LUA.draftCode).not.toMatch(/require\(["']speech["']\)/);
        expect(DECRYPT_TEMPLATE_LUA.draftCode).not.toContain("speech.say");
    });

    it("wires welcome and timeout prompts through Lua announce, not workflow speech nodes", () => {
        const schema = buildDecryptGameSchema("lua-module-id") as {
            nodes: Array<{ id: string; type: string }>;
            edges: Array<{ sourceNodeID: string; targetNodeID: string }>;
        };

        expect(schema.nodes.some((node) => node.type === "speech")).toBe(false);
        expect(schema.nodes.map((node) => node.id)).toEqual(
            expect.arrayContaining(["lua_intro", "lua_bye", "lua_idle", "lua_no_answer"]),
        );
        expect(schema.edges).toEqual(
            expect.arrayContaining([
                { sourceNodeID: "agent_host", targetNodeID: "lua_intro" },
                { sourceNodeID: "lua_intro", targetNodeID: "webhook_choose_1" },
                { sourceNodeID: "lua_judge_2", targetNodeID: "lua_bye" },
                { sourceNodeID: "lua_bye", targetNodeID: "end_0" },
            ]),
        );
        expect(JSON.stringify(schema)).toContain("题目已经由程序在设备屏幕上公布");
        expect(JSON.stringify(schema)).not.toContain("设备和语音里公布");
        expect(JSON.stringify(schema)).not.toContain("立刻调用工具 choose_puzzle");
        expect(JSON.stringify(schema)).not.toContain("立刻调用工具 submit_answer");
    });

    it("announces template text through alert.show", async () => {
        const simulator = new SimulatorService();
        const runtime = new LuaRuntimeService(simulator);
        const session = simulator.create("student");

        const result = await runtime.execute(
            DECRYPT_TEMPLATE_LUA.draftCode,
            { action: "announce", message: "欢迎来到解密馆" },
            session.id,
        );

        expect(result.output).toMatchObject({
            action: "announce",
            message: "欢迎来到解密馆",
        });
        expect(simulator.get(session.id).cubecat.lastAlert).toBe("欢迎来到解密馆");
    });
});

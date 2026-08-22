import { workflowNeedsCubeCat } from "./workflow-runtime-requirements";

describe("workflowNeedsCubeCat", () => {
    it("does not require CubeCat for Home Assistant only workflows", () => {
        expect(
            workflowNeedsCubeCat({
                nodes: [
                    { type: "start", data: {} },
                    { type: "smart_home", data: { provider: "homeassistant", deviceId: "light-1" } },
                    { type: "end", data: {} },
                ],
            }),
        ).toBe(false);
    });

    it("requires CubeCat when a Lua or speech node is present", () => {
        expect(
            workflowNeedsCubeCat({
                nodes: [
                    { type: "start", data: {} },
                    { type: "lua", data: { luaModuleId: "mod-1" } },
                    { type: "end", data: {} },
                ],
            }),
        ).toBe(true);
        expect(
            workflowNeedsCubeCat({
                nodes: [{ type: "loop", blocks: [{ type: "user_lua_abc", data: {} }] }],
            }),
        ).toBe(true);
    });
});

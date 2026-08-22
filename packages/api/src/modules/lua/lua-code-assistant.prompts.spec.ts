import { DEVICE_SYSTEM_PROMPT } from "./lua-code-assistant.prompts";

describe("Lua code assistant prompt", () => {
    it("teaches alert.show and forbids the removed speech module", () => {
        expect(DEVICE_SYSTEM_PROMPT).toContain('require("alert")');
        expect(DEVICE_SYSTEM_PROMPT).toContain("alert.show");
        expect(DEVICE_SYSTEM_PROMPT).toContain('require("speech")');
        expect(DEVICE_SYSTEM_PROMPT).toContain("speech.say");
        expect(DEVICE_SYSTEM_PROMPT).toMatch(/已改名为 require\("alert"\)/);
        expect(DEVICE_SYSTEM_PROMPT).not.toMatch(/local speech = require\("speech"\)/);
        expect(DEVICE_SYSTEM_PROMPT).not.toMatch(/speech\.say\("/);
    });
});

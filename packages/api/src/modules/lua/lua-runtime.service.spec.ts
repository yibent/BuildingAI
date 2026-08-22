import { SimulatorService } from "../simulator/simulator.service";
import { LuaRuntimeService } from "./lua-runtime.service";

jest.mock("@buildingai/errors", () => ({
    HttpErrorFactory: {
        badRequest: (message: string) => new Error(message),
        notFound: (message: string) => new Error(message),
    },
}));

describe("LuaRuntimeService", () => {
    let service: LuaRuntimeService;

    beforeEach(() => {
        service = new LuaRuntimeService(new SimulatorService());
    });

    it("executes a module with JSON-compatible inputs and outputs", async () => {
        const result = await service.execute(
            `function main(params)
                return { sum = params.a + params.b, nested = { ok = true } }
            end`,
            { a: 2, b: 3 },
        );

        expect(result.output).toEqual({ sum: 5, nested: { ok: true } });
        expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it("rejects scripts without a main function", async () => {
        await expect(service.validate("local value = 1")).rejects.toThrow("main(params)");
    });

    it("terminates scripts that exceed the execution deadline", async () => {
        await expect(
            service.execute("function main(params) while true do end end"),
        ).rejects.toThrow("执行超时");
    }, 10_000);

    it("does not expose operating system libraries", async () => {
        const result = await service.execute(
            "function main(params) return { osAvailable = os ~= nil, ioAvailable = io ~= nil } end",
        );
        expect(result.output).toEqual({ osAvailable: false, ioAvailable: false });
    });

    it("exposes CubeCat modules through require", async () => {
        const result = await service.execute(`
            function main()
                local runtime = require("runtime")
                local device = require("device")
                local ui = require("ui")
                device.set_brightness(40)
                local width, height = ui.screen_size()
                runtime.sleep(20)
                return { width = width, height = height, now = runtime.now_ms() }
            end
        `);
        expect(result.output).toEqual({ width: 480, height: 800, now: 20 });
    });

    it("commits CubeCat device operations after successful execution", async () => {
        const simulator = new SimulatorService();
        service = new LuaRuntimeService(simulator);
        const session = simulator.create("student");
        await service.execute(
            `function main()
                local device = require("device")
                local alert = require("alert")
                device.set_brightness(40)
                alert.show("你好")
                return { ok = true }
            end`,
            {},
            session.id,
        );
        expect(simulator.get(session.id).cubecat).toMatchObject({
            brightness: 40,
            lastAlert: "你好",
        });
    });

    it("does not commit device operations when the script fails", async () => {
        const simulator = new SimulatorService();
        service = new LuaRuntimeService(simulator);
        const session = simulator.create("student");
        await expect(
            service.execute(
                `function main()
                    local device = require("device")
                    device.set_brightness(10)
                    error("stop")
                end`,
                {},
                session.id,
            ),
        ).rejects.toThrow("stop");
        expect(simulator.get(session.id).cubecat.brightness).toBe(80);
    });

    it("rejects the removed speech module instead of pretending it can do TTS", async () => {
        await expect(
            service.execute(`
                function main()
                    require("speech")
                    return { ok = true }
                end
            `),
        ).rejects.toThrow(/speech/);
    });

    it("accepts both firmware and CubeMax ui constructor calling conventions", async () => {
        const result = await service.execute(`
            function main()
                local ui = require("ui")
                local screen = ui.screen({ background = 0x101820 })
                ui.label({ parent = screen, text = "firmware" })
                ui.label(screen, { text = "legacy", color = 0xffffff })
                ui.load(screen)
                return { ok = true }
            end
        `);
        expect(result.output).toEqual({ ok: true });
    });
});

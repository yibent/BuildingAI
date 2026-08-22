import type { ProgrammingProjectPublishedSnapshot } from "@buildingai/db/entities";
import { HttpErrorFactory } from "@buildingai/errors";
import type { LuaExecutorInput } from "@flowgram.ai/runtime-js";
import { Injectable } from "@nestjs/common";

import { LuaDeviceGatewayService } from "../lua-device/lua-device-gateway.service";
import { LuaModuleService } from "../lua/lua-module.service";
import { LuaRuntimeService } from "../lua/lua-runtime.service";
import { XiaozhiMcpService } from "../organization/services/xiaozhi-mcp.service";
import { formatLuaResultForXiaozhi } from "./workflow-callback";
import { WorkflowRuntimeDeviceService } from "./workflow-runtime-device.service";

type RuntimeContext = NonNullable<LuaExecutorInput["runtimeContext"]>;

const USER_LUA_TYPE_PREFIX = "user_lua_";

function resolveLuaModuleId(node: { type: string; data?: Record<string, unknown> }): string | undefined {
    const fromData = node.data?.luaModuleId;
    if (typeof fromData === "string" && fromData) return fromData;
    if (node.type.startsWith(USER_LUA_TYPE_PREFIX)) {
        const fromType = node.type.slice(USER_LUA_TYPE_PREFIX.length);
        return fromType || undefined;
    }
    return undefined;
}

function isPublishedSnapshot(value: unknown): value is ProgrammingProjectPublishedSnapshot {
    return (
        !!value &&
        typeof value === "object" &&
        (value as ProgrammingProjectPublishedSnapshot).version === 1 &&
        Array.isArray((value as ProgrammingProjectPublishedSnapshot).luaModules)
    );
}

@Injectable()
export class WorkflowLuaExecutorService {
    constructor(
        private readonly luaModuleService: LuaModuleService,
        private readonly luaRuntimeService: LuaRuntimeService,
        private readonly luaDeviceGatewayService: LuaDeviceGatewayService,
        private readonly runtimeDeviceService: WorkflowRuntimeDeviceService,
        private readonly mcpService: XiaozhiMcpService,
    ) {}

    async execute(input: LuaExecutorInput): Promise<Record<string, unknown>> {
        if (!input.userId) throw HttpErrorFactory.unauthorized("Lua 节点需要登录后执行");
        const moduleId = resolveLuaModuleId(input.node);
        if (!moduleId) {
            throw HttpErrorFactory.badRequest("Lua 节点尚未选择模块");
        }
        const context = input.runtimeContext;
        const snapshot = isPublishedSnapshot(context?.publishedSnapshot)
            ? context.publishedSnapshot
            : undefined;
        let source: string;
        let moduleName = "Lua 模块";

        if (snapshot) {
            const luaModule = snapshot.luaModules.find((item) => item.id === moduleId);
            if (!luaModule) {
                throw HttpErrorFactory.badRequest("已发布工程未包含当前 Lua 模块");
            }
            source = luaModule.code;
            moduleName = luaModule.name;
        } else if (context?.projectId) {
            const luaModule = await this.luaModuleService.findOne(moduleId, input.userId);
            if (luaModule.projectId !== context.projectId) {
                throw HttpErrorFactory.badRequest("Lua 模块不属于当前工程");
            }
            source = luaModule.draftCode;
            moduleName = luaModule.name;
        } else {
            return (
                await this.luaModuleService.executePublished(moduleId, input.userId, input.inputs)
            ).output;
        }

        try {
            const output = await this.executeForTarget(
                source,
                moduleName,
                moduleId,
                input.userId,
                input.inputs,
                context,
            );
            this.completeXiaozhiCallback(context, output);
            return output;
        } catch (error) {
            this.completeXiaozhiCallback(context, {
                action: "error",
                message: error instanceof Error ? error.message : String(error),
                correct: false,
            });
            throw error;
        }
    }

    private resolveAgentId(context?: RuntimeContext): string | undefined {
        const snapshot = isPublishedSnapshot(context?.publishedSnapshot)
            ? context?.publishedSnapshot
            : undefined;
        const fromSnapshot = snapshot?.runtime.xiaozhiAgentId;
        const fromContext = context?.xiaozhiAgentId;
        if (typeof fromSnapshot === "string" && fromSnapshot) return fromSnapshot;
        if (typeof fromContext === "string" && fromContext) return fromContext;
        return undefined;
    }

    private completeXiaozhiCallback(
        context: RuntimeContext | undefined,
        output: Record<string, unknown>,
    ) {
        if (output.action === "announce") return;
        const agentId = this.resolveAgentId(context);
        if (!agentId) return;
        this.mcpService.completeWorkflowCallback(agentId, formatLuaResultForXiaozhi(output), output);
    }

    private async executeForTarget(
        source: string,
        moduleName: string,
        moduleId: string,
        userId: string,
        inputs: Record<string, unknown>,
        context?: RuntimeContext,
    ): Promise<Record<string, unknown>> {
        const target = context?.runtimeTarget ?? "local";
        if (target !== "device") {
            return (
                await this.luaRuntimeService.execute(source, inputs, context?.simulatorSessionId)
            ).output;
        }

        const deviceId = await this.runtimeDeviceService.resolveLuaDeviceId(userId, context);
        const usesUi = /\brequire\s*\(\s*["']ui["']\s*\)/.test(source);
        const usesCamera = /\brequire\s*\(\s*["']camera["']\s*\)/.test(source);
        const requiredCapabilities = ["lua"];
        if (usesCamera) requiredCapabilities.push("camera");
        const run = await this.luaDeviceGatewayService.createRun(userId, deviceId, {
            name: moduleName.slice(0, 100),
            moduleId,
            projectId: context?.projectId,
            source,
            params: inputs,
            requiredCapabilities,
            timeoutMs: usesUi || usesCamera ? 60_000 : 15_000,
        });
        const completed = await this.luaDeviceGatewayService.waitForRun(userId, deviceId, run.id);
        if (completed.status !== "succeeded") {
            throw HttpErrorFactory.badRequest(completed.error?.message ?? "CubeCat 执行失败");
        }
        return completed.result &&
            typeof completed.result === "object" &&
            !Array.isArray(completed.result)
            ? (completed.result as Record<string, unknown>)
            : { result: completed.result };
    }
}

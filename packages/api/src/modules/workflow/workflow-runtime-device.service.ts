import type { ProgrammingProjectPublishedSnapshot } from "@buildingai/db/entities";
import { HttpErrorFactory } from "@buildingai/errors";
import { Injectable, Logger } from "@nestjs/common";

import { LuaDeviceGatewayService } from "../lua-device/lua-device-gateway.service";
import { XiaozhiService } from "../organization/services/xiaozhi.service";
import { matchLuaDeviceId } from "./workflow-runtime-device";

type RuntimeDeviceContext = {
    runtimeTarget?: "local" | "simulator" | "device";
    xiaozhiAgentId?: string;
    deviceId?: string;
    publishedSnapshot?: unknown;
};

function isPublishedSnapshot(value: unknown): value is ProgrammingProjectPublishedSnapshot {
    return (
        !!value &&
        typeof value === "object" &&
        (value as ProgrammingProjectPublishedSnapshot).version === 1
    );
}

@Injectable()
export class WorkflowRuntimeDeviceService {
    private readonly logger = new Logger(WorkflowRuntimeDeviceService.name);

    constructor(
        private readonly xiaozhiService: XiaozhiService,
        private readonly luaDeviceGatewayService: LuaDeviceGatewayService,
    ) {}

    resolveCubeCatId(context?: RuntimeDeviceContext): string | undefined {
        const snapshot = isPublishedSnapshot(context?.publishedSnapshot)
            ? context?.publishedSnapshot
            : undefined;
        const fromSnapshot = snapshot?.runtime.xiaozhiAgentId;
        const fromContext = context?.xiaozhiAgentId;
        if (typeof fromSnapshot === "string" && fromSnapshot) return fromSnapshot;
        if (typeof fromContext === "string" && fromContext) return fromContext;
        return undefined;
    }

    async resolveLuaDeviceId(userId: string, context?: RuntimeDeviceContext): Promise<string> {
        if (context?.deviceId) return context.deviceId;

        const cubeCatId = this.resolveCubeCatId(context);
        if (cubeCatId) {
            const cubeCatDevices = await this.xiaozhiService.listDevicesForUser(userId, cubeCatId);
            if (!cubeCatDevices.length) {
                throw HttpErrorFactory.badRequest("这台 CubeCat 还没有绑定硬件");
            }
            const luaDevices = await this.luaDeviceGatewayService.listAllDevices();
            const match = matchLuaDeviceId(luaDevices, cubeCatDevices);
            if (match?.online) return match.deviceId;
            if (match) {
                throw HttpErrorFactory.badRequest(
                    "CubeCat 已绑定，但脚本通道未连接。请在设备上打开远程脚本后再试",
                );
            }
            this.logger.warn(
                `Lua channel mismatch cubeCat=${cubeCatDevices
                    .map(
                        (device) =>
                            `${device.macAddress || "-"}/${device.clientId || "-"}/${device.online ? "on" : "off"}`,
                    )
                    .join(",") || "none"} lua=${
                    luaDevices
                        .map(
                            (device) =>
                                `${device.deviceId}/${device.macAddress || "-"}/${device.online ? "on" : "off"}`,
                        )
                        .join(",") || "none"
                }`,
            );
            throw HttpErrorFactory.badRequest(
                "找不到这台 CubeCat 的脚本通道。请确认设备已联网并打开远程脚本",
            );
        }

        throw HttpErrorFactory.badRequest("请先在工程设置中选择 CubeCat 设备");
    }
}

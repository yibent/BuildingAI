import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import {
    ProgrammingProjectTool,
    programmingProjectToolKey,
    type ProgrammingProjectPublishedSnapshot,
} from "@buildingai/db/entities";
import { Repository } from "@buildingai/db/typeorm";
import { Injectable } from "@nestjs/common";

import { HomeAssistantService } from "../smart-home/home-assistant.service";
import type { SmartHomeControlCommand, SmartHomeProvider } from "./smart-home-control";

export type WorkflowSmartHomeExecutorInput = {
    userId?: string;
    runtimeContext?: {
        projectId?: string;
        publishedSnapshot?: unknown;
    };
    node: {
        id: string;
        type: string;
        data?: {
            provider?: SmartHomeProvider;
            deviceId?: string;
            command?: SmartHomeControlCommand;
        };
    };
    inputs: Record<string, unknown>;
};

@Injectable()
export class WorkflowSmartHomeExecutorService {
    constructor(
        @InjectRepository(ProgrammingProjectTool)
        private readonly projectToolRepository: Repository<ProgrammingProjectTool>,
        private readonly homeAssistantService: HomeAssistantService,
    ) {}

    async execute(input: WorkflowSmartHomeExecutorInput): Promise<Record<string, unknown>> {
        if (!input.userId) throw new Error("智能家居节点需要登录后执行");
        const provider = input.node.data?.provider;
        const deviceId = input.node.data?.deviceId;
        if (provider !== "homeassistant") {
            throw new Error("智能家居节点尚未选择 Home Assistant 设备");
        }
        if (!deviceId) throw new Error("智能家居节点尚未选择设备");

        await this.assertProjectToolAccess(input, deviceId);

        const command = mergeCommand(input.node.data?.command, input.inputs);
        try {
            const updated = await this.homeAssistantService.controlDevice(input.userId, deviceId, {
                on: command.on,
                brightness:
                    typeof command.brightness === "number"
                        ? Math.round(command.brightness)
                        : undefined,
                color: typeof command.color === "string" ? command.color : undefined,
                colorTemp:
                    typeof command.colorTemp === "number" ? Math.round(command.colorTemp) : undefined,
            });
            return {
                success: true,
                deviceId: updated.id,
                name: updated.name,
                online: updated.online,
                state: updated.state,
            };
        } catch (error) {
            throw new Error(error instanceof Error ? error.message : "智能家居控制失败");
        }
    }

    private async assertProjectToolAccess(
        input: WorkflowSmartHomeExecutorInput,
        deviceId: string,
    ): Promise<void> {
        const snapshot = input.runtimeContext?.publishedSnapshot;
        if (isPublishedSnapshot(snapshot)) {
            const allowed = snapshot.tools.some(
                (tool) =>
                    programmingProjectToolKey(tool) ===
                    programmingProjectToolKey({ kind: "homeassistant", deviceId }),
            );
            if (!allowed) throw new Error("该物联网设备未包含在已发布工程中");
            return;
        }
        if (!input.runtimeContext?.projectId) return;
        const enabled = await this.projectToolRepository.findOne({
            where: {
                projectId: input.runtimeContext.projectId,
                toolKey: programmingProjectToolKey({ kind: "homeassistant", deviceId }),
            },
        });
        if (!enabled) throw new Error("该物联网设备未加入当前工程");
    }
}

function isPublishedSnapshot(value: unknown): value is ProgrammingProjectPublishedSnapshot {
    return (
        !!value &&
        typeof value === "object" &&
        (value as ProgrammingProjectPublishedSnapshot).version === 1 &&
        Array.isArray((value as ProgrammingProjectPublishedSnapshot).tools)
    );
}

function mergeCommand(
    command: SmartHomeControlCommand | undefined,
    inputs: Record<string, unknown>,
): SmartHomeControlCommand {
    const next: SmartHomeControlCommand = { ...(command ?? {}) };
    if (typeof inputs.on === "boolean") next.on = inputs.on;
    if (typeof inputs.brightness === "number") next.brightness = inputs.brightness;
    if (typeof inputs.colorTemp === "number") next.colorTemp = inputs.colorTemp;
    if (typeof inputs.color === "string") next.color = inputs.color;
    return next;
}

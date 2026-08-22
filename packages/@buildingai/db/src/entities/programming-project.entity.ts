import { AppEntity } from "../decorators/app-entity.decorator";
import { Column, Index } from "../typeorm";

import { BaseEntity } from "./base";

export type ProgrammingRuntimeTarget = "local" | "simulator" | "device";

/** The two intentionally different programming experiences. */
export type ProgrammingProjectType = "conversation" | "application";

export type ProgrammingProjectToolKind = "mcp" | "homeassistant";

export type ProgrammingProjectToolSnapshot = {
    kind: ProgrammingProjectToolKind;
    mcpServerId?: string;
    toolName?: string;
    deviceId?: string;
};

export function programmingProjectToolKind(
    value: string | null | undefined,
): ProgrammingProjectToolKind {
    return value === "homeassistant" ? value : "mcp";
}

export function programmingProjectToolKey(tool: {
    kind?: string | null;
    mcpServerId?: string | null;
    toolName?: string | null;
    deviceId?: string | null;
}): string {
    const kind = programmingProjectToolKind(tool.kind);
    if (kind === "mcp") return `mcp:${tool.mcpServerId ?? ""}:${tool.toolName ?? ""}`;
    return `${kind}:${tool.deviceId ?? ""}`;
}

export function normalizeProgrammingProjectTool(tool: {
    kind?: string | null;
    mcpServerId?: string | null;
    toolName?: string | null;
    deviceId?: string | null;
}): ProgrammingProjectToolSnapshot {
    const kind = programmingProjectToolKind(tool.kind);
    if (kind === "mcp") {
        return {
            kind,
            ...(tool.mcpServerId ? { mcpServerId: tool.mcpServerId } : {}),
            ...(tool.toolName ? { toolName: tool.toolName } : {}),
        };
    }
    return {
        kind,
        ...(tool.deviceId ? { deviceId: tool.deviceId } : {}),
    };
}

export type ProgrammingProjectLuaSnapshot = {
    id: string;
    name: string;
    code: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
};

export type ProgrammingProjectPublishedSnapshot = {
    version: 1;
    workflow: {
        id: string;
        name: string;
        schema: Record<string, unknown>;
    };
    luaModules: ProgrammingProjectLuaSnapshot[];
    tools: ProgrammingProjectToolSnapshot[];
    runtime: {
        target: ProgrammingRuntimeTarget;
        simulatorSessionId?: string;
        deviceId?: string;
        xiaozhiAgentId?: string;
    };
    publishedAt: string;
};

@AppEntity({ name: "programming_project", comment: "编程工程" })
@Index(["createBy", "updatedAt"])
@Index(["mainWorkflowId"], { unique: true })
export class ProgrammingProject extends BaseEntity {
    @Column({ length: 100, comment: "工程名称" })
    name: string;

    @Column({ type: "text", nullable: true, comment: "工程描述" })
    description?: string | null;

    @Column({
        name: "project_type",
        type: "varchar",
        length: 20,
        default: "conversation",
        comment: "工程类型：对话流或应用",
    })
    projectType: ProgrammingProjectType;

    @Column({ name: "main_workflow_id", type: "uuid", nullable: true, comment: "主流程ID" })
    mainWorkflowId?: string | null;

    @Column({
        name: "runtime_target",
        type: "varchar",
        length: 16,
        default: "local",
        comment: "对话流默认 local；应用工程创建时为 simulator",
    })
    runtimeTarget: ProgrammingRuntimeTarget;

    @Column({ name: "simulator_session_id", type: "uuid", nullable: true })
    simulatorSessionId?: string | null;

    @Column({ name: "device_id", type: "varchar", length: 36, nullable: true })
    deviceId?: string | null;

    @Column({ name: "xiaozhi_agent_id", type: "uuid", nullable: true, comment: "工程绑定的方糖猫智能体" })
    xiaozhiAgentId?: string | null;

    @Column({ name: "is_published", type: "boolean", default: false })
    isPublished: boolean;

    @Column({ name: "published_at", type: "timestamptz", nullable: true })
    publishedAt?: Date | null;

    @Column({ name: "published_snapshot", type: "jsonb", nullable: true })
    publishedSnapshot?: ProgrammingProjectPublishedSnapshot | null;

    @Column({ name: "create_by", type: "varchar", length: 255 })
    createBy: string;
}

@AppEntity({ name: "programming_project_tool", comment: "编程工程可调用工具" })
@Index(["projectId", "toolKey"], { unique: true })
@Index(["projectId"])
export class ProgrammingProjectTool extends BaseEntity {
    @Column({ name: "project_id", type: "uuid" })
    projectId: string;

    @Column({ name: "kind", type: "varchar", length: 16, default: "mcp", comment: "工具类型" })
    kind: ProgrammingProjectToolKind;

    @Column({ name: "mcp_server_id", type: "varchar", length: 255, nullable: true })
    mcpServerId?: string | null;

    @Column({ name: "tool_name", type: "varchar", length: 255, nullable: true })
    toolName?: string | null;

    @Column({ name: "device_id", type: "varchar", length: 255, nullable: true, comment: "物联网设备ID" })
    deviceId?: string | null;

    @Column({ name: "tool_key", type: "varchar", length: 512, comment: "去重键" })
    toolKey: string;
}

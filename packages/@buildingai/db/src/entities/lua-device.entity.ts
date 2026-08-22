import { Column, Entity, Index } from "../typeorm";

import { BaseEntity } from "./base";

export type LuaDeviceLimits = {
    maxScriptBytes: number;
    maxParamsBytes: number;
    maxChunkBytes: number;
    maxMessageBytes: number;
    maxLogBytes: number;
};

export type LuaDeviceRuntime = {
    executionModel: string;
    apiVersion: string;
    transferStorage: string;
    maxRunTimeoutMs: number;
    macAddress?: string;
    clientId?: string;
};

export type LuaDeviceRunStatus =
    | "queued"
    | "preparing"
    | "transferring"
    | "running"
    | "stopping"
    | "waiting_for_device"
    | "succeeded"
    | "failed"
    | "stopped"
    | "timed_out";

@Entity("lua_physical_device")
@Index(["deviceId"], { unique: true })
@Index(["displayName"])
export class LuaPhysicalDevice extends BaseEntity {
    @Column({ name: "device_id", type: "varchar", length: 36 })
    deviceId: string;

    @Column({ name: "display_name", type: "varchar", length: 100 })
    displayName: string;

    @Column({ name: "firmware_version", type: "varchar", length: 32, nullable: true })
    firmwareVersion?: string | null;

    @Column({ name: "boot_id", type: "varchar", length: 36, nullable: true })
    bootId?: string | null;

    @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
    capabilities: string[];

    @Column({ type: "jsonb", nullable: true })
    limits?: LuaDeviceLimits | null;

    @Column({ type: "jsonb", nullable: true })
    runtime?: LuaDeviceRuntime | null;

    @Column({ name: "last_seen_at", type: "timestamptz", nullable: true })
    lastSeenAt?: Date | null;

}

@Entity("lua_device_connection")
@Index(["connectionId"], { unique: true })
@Index(["deviceId", "connectedAt"])
export class LuaDeviceConnection extends BaseEntity {
    @Column({ name: "connection_id", type: "uuid" })
    connectionId: string;

    @Column({ name: "device_id", type: "varchar", length: 36 })
    deviceId: string;

    @Column({ name: "boot_id", type: "varchar", length: 36 })
    bootId: string;

    @Column({ name: "remote_address", type: "varchar", length: 100, nullable: true })
    remoteAddress?: string | null;

    @Column({ name: "connected_at", type: "timestamptz" })
    connectedAt: Date;

    @Column({ name: "disconnected_at", type: "timestamptz", nullable: true })
    disconnectedAt?: Date | null;

    @Column({ name: "close_code", type: "integer", nullable: true })
    closeCode?: number | null;
}

@Entity("lua_device_run")
@Index(["deviceId", "createdAt"])
@Index(["createBy", "createdAt"])
@Index(["projectId", "createdAt"])
export class LuaDeviceRun extends BaseEntity {
    @Column({ name: "device_id", type: "varchar", length: 36 })
    deviceId: string;

    @Column({ name: "create_by", type: "varchar", length: 255 })
    createBy: string;

    @Column({ name: "module_id", type: "uuid", nullable: true })
    moduleId?: string | null;

    @Column({ name: "project_id", type: "uuid", nullable: true })
    projectId?: string | null;

    @Column({ type: "varchar", length: 100 })
    name: string;

    @Column({ type: "text" })
    source: string;

    @Column({ name: "source_sha256", type: "char", length: 64 })
    sourceSha256: string;

    @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
    params: unknown;

    @Column({ name: "params_json", type: "text" })
    paramsJson: string;

    @Column({ name: "params_sha256", type: "char", length: 64 })
    paramsSha256: string;

    @Column({ name: "required_capabilities", type: "jsonb", default: () => "'[\"lua\"]'::jsonb" })
    requiredCapabilities: string[];

    @Column({ type: "varchar", length: 32, default: "queued" })
    status: LuaDeviceRunStatus;

    @Column({ name: "timeout_ms", type: "integer" })
    timeoutMs: number;

    @Column({ name: "chunk_bytes", type: "integer", default: 1024 })
    chunkBytes: number;

    @Column({ name: "next_chunk_index", type: "integer", default: 0 })
    nextChunkIndex: number;

    @Column({ type: "jsonb", nullable: true })
    result?: unknown;

    @Column({ type: "jsonb", nullable: true })
    error?: { code: string; message: string; line?: number } | null;

    @Column({ name: "started_at", type: "timestamptz", nullable: true })
    startedAt?: Date | null;

    @Column({ name: "finished_at", type: "timestamptz", nullable: true })
    finishedAt?: Date | null;
}

@Entity("lua_device_run_log")
@Index(["runId", "sequence"], { unique: true })
export class LuaDeviceRunLog extends BaseEntity {
    @Column({ name: "run_id", type: "uuid" })
    runId: string;

    @Column({ type: "integer" })
    sequence: number;

    @Column({ type: "varchar", length: 8 })
    level: string;

    @Column({ type: "varchar", length: 1024 })
    text: string;
}

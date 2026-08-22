import { AppEntity } from "../decorators/app-entity.decorator";
import { Column, Index, Unique } from "../typeorm";
import { SoftDeleteBaseEntity } from "./base";

export const HomeAssistantAuthMode = {
    TOKEN: "token",
    PASSWORD: "password",
} as const;

export type HomeAssistantAuthModeType =
    (typeof HomeAssistantAuthMode)[keyof typeof HomeAssistantAuthMode];

export const HomeAssistantInstanceStatus = {
    ACTIVE: "active",
    AUTH_ERROR: "auth_error",
    SYNC_ERROR: "sync_error",
} as const;

export type HomeAssistantInstanceStatusType =
    (typeof HomeAssistantInstanceStatus)[keyof typeof HomeAssistantInstanceStatus];

export type HomeAssistantLightState = {
    on: boolean;
    brightness: number | null;
    color: string | null;
    colorTemp: number | null;
    colorMode: string | null;
    minKelvin: number | null;
    maxKelvin: number | null;
    supportedColorModes: string[];
};

@AppEntity({ name: "home_assistant_instance", comment: "Home Assistant 连接" })
@Unique("UQ_home_assistant_instance_owner", ["ownerUserId"])
export class HomeAssistantInstance extends SoftDeleteBaseEntity {
    @Index()
    @Column({ type: "uuid", comment: "绑定账号的系统用户ID" })
    ownerUserId: string;

    @Column({ length: 80, default: "Home Assistant", comment: "连接备注" })
    label: string;

    @Column({ type: "text", comment: "Home Assistant 根地址" })
    baseUrl: string;

    @Column({ type: "varchar", length: 16, default: HomeAssistantAuthMode.TOKEN })
    authMode: HomeAssistantAuthModeType;

    @Column({ length: 120, nullable: true, comment: "HA 登录用户名" })
    username: string | null;

    @Column({ type: "text", comment: "加密的访问令牌" })
    accessTokenEncrypted: string;

    @Column({ type: "text", nullable: true, comment: "加密的刷新令牌" })
    refreshTokenEncrypted: string | null;

    @Column({ type: "timestamptz", nullable: true, comment: "访问令牌过期时间" })
    accessTokenExpiresAt: Date | null;

    @Column({ length: 40, nullable: true, comment: "HA 版本" })
    haVersion: string | null;

    @Column({ length: 120, nullable: true, comment: "HA 位置名称" })
    locationName: string | null;

    @Column({
        type: "varchar",
        length: 16,
        default: HomeAssistantInstanceStatus.ACTIVE,
    })
    status: HomeAssistantInstanceStatusType;

    @Column({ type: "timestamptz", nullable: true, comment: "最近同步时间" })
    lastSyncAt: Date | null;

    @Column({ type: "text", nullable: true, comment: "最近一次错误" })
    lastError: string | null;
}

@AppEntity({ name: "home_assistant_device", comment: "Home Assistant 实体快照" })
@Unique("UQ_home_assistant_device_instance_entity", ["instanceId", "entityId"])
export class HomeAssistantDevice extends SoftDeleteBaseEntity {
    @Index()
    @Column({ type: "uuid", comment: "所属 HA 连接" })
    instanceId: string;

    @Index()
    @Column({ length: 255, comment: "HA entity_id" })
    entityId: string;

    @Column({ length: 255, nullable: true, comment: "HA unique_id" })
    uniqueId: string | null;

    @Column({ length: 160, comment: "显示名称" })
    name: string;

    @Index()
    @Column({ length: 32, comment: "HA domain" })
    domain: string;

    @Index()
    @Column({ length: 32, default: "other", comment: "设备分类" })
    category: string;

    @Column({ length: 80, nullable: true, comment: "区域 ID" })
    areaId: string | null;

    @Column({ length: 120, nullable: true, comment: "区域名称" })
    areaName: string | null;

    @Column({ type: "boolean", default: false })
    online: boolean;

    @Column({ type: "jsonb", default: () => "'{}'::jsonb", comment: "规范化后的灯光/开关状态" })
    state: HomeAssistantLightState & Record<string, unknown>;

    @Column({ type: "jsonb", default: () => "'{}'::jsonb", comment: "HA 原始 attributes" })
    attributes: Record<string, unknown>;

    @Column({ type: "timestamptz", nullable: true })
    lastStateAt: Date | null;
}

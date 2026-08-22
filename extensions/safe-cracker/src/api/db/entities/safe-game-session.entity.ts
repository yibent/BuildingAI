import { ExtensionEntity } from "@buildingai/core/decorators";
import { Column, CreateDateColumn, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

import {
    GameStatus,
    type GameStatusType,
    PasswordMode,
    type PasswordModeType,
} from "../../shared/contract";

/**
 * 一局保险箱游戏。
 *
 * 设备接管本身由 ClassroomKit 的会话负责（快照、恢复、超时兜底都在那边），
 * 这张表只存游戏自己的规则与进度，通过 `kitSessionKey` 关联过去。
 */
@ExtensionEntity()
export class SafeGameSession {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Index()
    @Column({ type: "uuid", comment: "所属班级" })
    organizationId: string;

    @Index()
    @Column({ type: "uuid", comment: "发起游戏的老师" })
    ownerUserId: string;

    /** 传给 ClassroomKit 的会话标识，结束时用它归还设备。 */
    @Column({ type: "varchar", length: 120, comment: "ClassroomKit 会话标识" })
    kitSessionKey: string;

    @Column({ type: "varchar", length: 120, default: "破解保险箱" })
    title: string;

    @Index()
    @Column({ type: "varchar", length: 16, default: GameStatus.DRAFT })
    status: GameStatusType;

    @Column({ type: "text", comment: "提示词模板，含 {{password}} 占位" })
    promptTemplate: string;

    @Column({ type: "varchar", length: 16, default: PasswordMode.PER_STUDENT })
    passwordMode: PasswordModeType;

    @Column({ type: "int", default: 4 })
    passwordLength: number;

    @Column({ type: "int", default: 15 })
    durationMinutes: number;

    @Column({ type: "boolean", default: true, comment: "允许方糖猫通过 MCP 主动上报" })
    allowDeviceReport: boolean;

    @Column({ type: "boolean", default: true, comment: "允许学生在学生端输入密码" })
    allowStudentInput: boolean;

    @Column({ type: "boolean", default: true, comment: "是否启用学生端页面" })
    enableStudentView: boolean;

    @Column({ type: "boolean", default: true, comment: "游戏期间禁止学生改自己的方糖猫" })
    lockStudentEdits: boolean;

    @Column({ type: "timestamptz", nullable: true })
    startedAt: Date | null;

    @Column({ type: "timestamptz", nullable: true, comment: "到点自动结束" })
    endsAt: Date | null;

    @Column({ type: "timestamptz", nullable: true })
    endedAt: Date | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

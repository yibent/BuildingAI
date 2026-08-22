import { ExtensionEntity } from "@buildingai/core/decorators";
import { Column, CreateDateColumn, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

import {
    ParticipantStatus,
    type ParticipantStatusType,
    type SolveViaType,
} from "../../shared/contract";

/**
 * 一局游戏里的一台方糖猫（及其对应的学生）。
 *
 * 以 `agentBindingId` 为准而不是学生ID：方糖猫的 MCP 上报只能定位到设备，
 * 而且设备不一定分发给了学生（老师演示、备用机）。学生信息是设备身上的附属。
 */
@ExtensionEntity()
@Index(["sessionId", "agentBindingId"], { unique: true })
export class SafeGameParticipant {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Index()
    @Column({ type: "uuid" })
    sessionId: string;

    @Index()
    @Column({ type: "uuid", comment: "方糖猫绑定ID" })
    agentBindingId: string;

    @Column({ type: "varchar", length: 100 })
    agentName: string;

    @Index()
    @Column({ type: "uuid", nullable: true, comment: "设备分发给的学生" })
    studentUserId: string | null;

    // 可空列必须显式写 type：`string | null` 经 reflect-metadata 反射出来是 Object，
    // TypeORM 推不出列类型，启动时直接 DataTypeNotSupportedError。
    @Column({ type: "varchar", length: 100, nullable: true })
    studentName: string | null;

    @Column({ type: "varchar", length: 16, comment: "这台设备守着的密码" })
    password: string;

    @Column({ type: "varchar", length: 16, default: ParticipantStatus.RACING })
    status: ParticipantStatusType;

    @Column({ type: "int", default: 0 })
    attempts: number;

    @Column({ type: "timestamptz", nullable: true })
    solvedAt: Date | null;

    @Column({ type: "int", nullable: true, comment: "破解耗时（毫秒）" })
    elapsedMs: number | null;

    @Column({ type: "varchar", length: 16, nullable: true })
    solvedVia: SolveViaType | null;

    /** 开始时提示词是否成功下发。没下发成功的设备学生怎么问都问不出密码。 */
    @Column({ type: "boolean", default: false })
    ready: boolean;

    @Column({ type: "text", nullable: true })
    readyError: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

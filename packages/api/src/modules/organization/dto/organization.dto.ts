import {
    CubeCatDeviceType,
    type CubeCatDeviceTypeValue,
    OrganizationRole,
    type OrganizationRoleType,
} from "@buildingai/db/entities";
import { Type } from "class-transformer";
import {
    ArrayMaxSize,
    ArrayMinSize,
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsString,
    IsUUID,
    Length,
    Matches,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from "class-validator";

const ORGANIZATION_ROLES = Object.values(OrganizationRole);
const CUBECAT_DEVICE_TYPES = Object.values(CubeCatDeviceType);

export class CreateOrganizationDto {
    @IsString()
    @IsNotEmpty({ message: "组织名称不能为空" })
    @Length(2, 80, { message: "组织名称长度应为2-80个字符" })
    name: string;
}

export class AddOrganizationMemberDto {
    @IsUUID(4, { message: "用户ID格式不正确" })
    userId: string;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayUnique()
    @IsIn(ORGANIZATION_ROLES, { each: true })
    roles: OrganizationRoleType[] = [OrganizationRole.TEACHER];
}

export class UpdateOrganizationMemberDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayUnique()
    @IsIn(ORGANIZATION_ROLES, { each: true })
    roles: OrganizationRoleType[];
}

export class CreateManagedAccountDto {
    @IsString()
    @Length(3, 20)
    @Matches(/^[a-zA-Z0-9_]+$/, { message: "用户名只能包含字母、数字和下划线" })
    username: string;

    @IsOptional()
    @IsString()
    @Length(2, 20)
    nickname?: string;

    @IsOptional()
    @IsString()
    @Length(2, 20)
    realName?: string;

    @IsOptional()
    @IsString()
    @Length(6, 20)
    @Matches(/^(?=.*[a-zA-Z])(?=.*\d).+$/, { message: "密码必须包含字母和数字" })
    password?: string;
}

export class BatchCreateManagedAccountsDto {
    @IsArray()
    @ArrayMinSize(1, { message: "至少需要一个子账号" })
    @ArrayMaxSize(100, { message: "每个组织最多创建100个托管子账号" })
    @ValidateNested({ each: true })
    @Type(() => CreateManagedAccountDto)
    accounts: CreateManagedAccountDto[];
}

export class BindXiaozhiAccountDto {
    @IsString()
    @Length(1, 40)
    label: string;

    @IsString()
    @Length(2, 120)
    username: string;

    @IsString()
    @Length(1, 200)
    password: string;

    @IsString()
    @Length(1, 12)
    captchaCode: string;

    @IsUUID(4, { message: "验证码会话格式不正确" })
    challengeId: string;
}

export class ReconnectXiaozhiAccountDto {
    @IsOptional()
    @IsString()
    @Length(2, 120)
    username?: string;

    @IsOptional()
    @IsString()
    @Length(1, 200)
    password?: string;

    @IsString()
    @Length(1, 12)
    captchaCode: string;

    @IsUUID(4, { message: "验证码会话格式不正确" })
    challengeId: string;
}

export class UpdateXiaozhiAccountDto {
    @IsString()
    @Length(1, 40, { message: "账号备注长度应为1-40个字符" })
    label: string;
}

export class AssignXiaozhiAgentDto {
    @IsOptional()
    @IsUUID(4, { message: "成员ID格式不正确" })
    assignedUserId: string | null;
}

export class OrganizationSearchDto {
    @IsOptional()
    @IsString()
    @MaxLength(80)
    keyword?: string;
}

export class BindXiaozhiDeviceDto {
    @IsString()
    @Length(4, 16, { message: "验证码长度应为4-16个字符" })
    @Matches(/^[a-zA-Z0-9]+$/, { message: "验证码只能包含字母和数字" })
    verificationCode: string;
}

export class UpdateDeviceAliasDto {
    @IsString()
    @Length(5, 40)
    macAddress: string;

    @IsString()
    @MaxLength(80, { message: "设备备注最长80个字符" })
    alias: string;
}

export class UpdateDeviceAutoUpdateDto {
    @IsString()
    @Length(5, 40)
    macAddress: string;

    @IsBoolean()
    autoUpdate: boolean;
}

export class UpdateCubeCatDeviceTypeDto {
    @IsIn(CUBECAT_DEVICE_TYPES, { message: "方糖猫设备型号不受支持" })
    deviceType: CubeCatDeviceTypeValue;
}

export class UpdateCubeCatDeviceSettingsDto {
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(100)
    volume?: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(100)
    brightness?: number;

    @IsOptional()
    @IsBoolean()
    doNotDisturb?: boolean;
}

export class PublishBuildingAgentToCubeCatDto {
    @IsUUID(4, { message: "目标方糖猫智能体ID格式不正确" })
    targetAgentId: string;

    @IsString()
    @Length(1, 120, { message: "请选择模型" })
    model: string;

    @IsString()
    @Length(1, 160, { message: "请选择音色" })
    voice: string;

    @IsOptional()
    @IsString()
    @MaxLength(40)
    language?: string;

    @IsOptional()
    @IsString()
    @MaxLength(12000, { message: "角色设定不能超过12000个字符" })
    character?: string;

    @IsOptional()
    @IsIn(["slow", "normal", "fast"])
    asrSpeed?: "slow" | "normal" | "fast";

    @IsOptional()
    @IsIn(["slow", "normal", "fast"])
    ttsSpeechSpeed?: "slow" | "normal" | "fast";

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(-3)
    @Max(3)
    ttsPitch?: number;

    @IsOptional()
    @IsIn(["OFF", "SHORT_TERM", "LONG_TERM"])
    memoryType?: "OFF" | "SHORT_TERM" | "LONG_TERM";

    @IsOptional()
    @IsBoolean()
    teenMode?: boolean;
}

export class RenameXiaozhiAgentDto {
    @IsString()
    @IsNotEmpty({ message: "智能体名称不能为空" })
    @Length(1, 40, { message: "智能体名称长度应为1-40个字符" })
    name: string;
}

export class UpdateXiaozhiAgentConfigDto {
    @IsObject({ message: "智能体配置格式不正确" })
    config: Record<string, unknown>;
}

export class UpdateConfigLocksDto {
    @IsArray()
    @ArrayMaxSize(20)
    @ArrayUnique()
    @IsString({ each: true })
    @MaxLength(40, { each: true })
    keys: string[];
}

export class LinkBuildingAgentDto {
    @IsOptional()
    @IsUUID(4, { message: "智能体ID格式不正确" })
    agentId?: string | null;
}

export class SaveXiaozhiSceneDto {
    @IsString()
    @IsNotEmpty({ message: "场景名称不能为空" })
    @Length(1, 60, { message: "场景名称长度应为1-60个字符" })
    name: string;

    @IsOptional()
    @IsString()
    @MaxLength(300, { message: "场景备注最长300个字符" })
    description?: string;

    @IsOptional()
    @IsObject({ message: "场景配置格式不正确" })
    config?: Record<string, unknown>;

    @IsOptional()
    @IsUUID(4, { message: "复制来源智能体ID格式不正确" })
    sourceAgentId?: string;
}

export class ApplyXiaozhiSceneDto {
    @IsArray()
    @ArrayMinSize(1, { message: "至少选择一个目标智能体" })
    @ArrayMaxSize(200, { message: "一次最多应用到200个智能体" })
    @ArrayUnique({ message: "目标智能体不能重复" })
    @IsUUID(4, { each: true, message: "智能体ID格式不正确" })
    agentIds: string[];
}

export class SaveXiaozhiQuickCommandDto {
    @IsString()
    @IsNotEmpty({ message: "指令名称不能为空" })
    @Length(1, 60, { message: "指令名称长度应为1-60个字符" })
    name: string;

    @IsUUID(4, { message: "场景ID格式不正确" })
    sceneId: string;

    @IsOptional()
    @IsBoolean()
    pinned?: boolean;

    @IsArray()
    @ArrayMinSize(1, { message: "至少选择一个目标智能体" })
    @ArrayMaxSize(200, { message: "一条指令最多包含200个智能体" })
    @ArrayUnique({ message: "目标智能体不能重复" })
    @IsUUID(4, { each: true, message: "智能体ID格式不正确" })
    agentIds: string[];
}

export class ChatHistoryQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(50)
    pageSize?: number;
}

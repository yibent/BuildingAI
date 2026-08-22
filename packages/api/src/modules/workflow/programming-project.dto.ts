import type { ProgrammingProjectType } from "@buildingai/db/entities";
import { Transform, Type } from "class-transformer";
import {
    ArrayMaxSize,
    IsArray,
    IsIn,
    IsInt,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from "class-validator";

export class QueryProgrammingProjectDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    pageSize?: number = 50;

    @IsOptional()
    @IsString()
    keyword?: string;
}

export class CreateProgrammingProjectDto {
    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @IsNotEmpty({ message: "工程名称不能为空" })
    @MaxLength(100, { message: "工程名称不能超过100个字符" })
    name: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string;

    @IsOptional()
    @IsIn(["conversation", "application"])
    projectType?: ProgrammingProjectType = "conversation";

    @IsOptional()
    @IsObject()
    schema?: Record<string, unknown>;

    @IsOptional()
    @IsIn(["decrypt"])
    template?: "decrypt";
}

export class UpdateProgrammingProjectDto {
    @IsOptional()
    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @IsNotEmpty({ message: "工程名称不能为空" })
    @MaxLength(100)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string;

    @IsOptional()
    @IsIn(["local", "simulator", "device"])
    runtimeTarget?: "local" | "simulator" | "device";

    @IsOptional()
    @IsString()
    simulatorSessionId?: string | null;

    @IsOptional()
    @IsString()
    deviceId?: string | null;

    @IsOptional()
    @IsString()
    xiaozhiAgentId?: string | null;
}

export class ProgrammingProjectToolDto {
    @IsOptional()
    @IsIn(["mcp", "homeassistant"])
    kind?: "mcp" | "homeassistant";

    @IsOptional()
    @IsString()
    @MaxLength(255)
    mcpServerId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    toolName?: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    deviceId?: string;
}

export class ReplaceProgrammingProjectToolsDto {
    @IsArray()
    @ArrayMaxSize(500)
    @ValidateNested({ each: true })
    @Type(() => ProgrammingProjectToolDto)
    tools: ProgrammingProjectToolDto[];
}

export class ImportProgrammingProjectLuaDto {
    @IsString()
    @IsNotEmpty()
    moduleId: string;
}

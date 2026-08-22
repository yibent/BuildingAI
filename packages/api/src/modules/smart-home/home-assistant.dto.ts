import { Type } from "class-transformer";
import {
    IsBoolean,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    IsUrl,
    Max,
    MaxLength,
    Min,
} from "class-validator";

export class UpsertHomeAssistantInstanceDto {
    @IsUrl({ require_tld: false, protocols: ["http", "https"] }, { message: "请填写有效的 HA 地址" })
    baseUrl: string;

    @IsOptional()
    @IsString()
    @MaxLength(80)
    label?: string;

    @IsOptional()
    @IsIn(["token", "password"])
    authMode?: "token" | "password";

    @IsOptional()
    @IsString()
    @MaxLength(8_000)
    token?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    username?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    password?: string;
}

export class UpdateHomeAssistantInstanceDto {
    @IsOptional()
    @IsString()
    @MaxLength(80)
    label?: string;
}

export class QueryHomeAssistantDevicesDto {
    @IsOptional()
    @IsString()
    @MaxLength(32)
    category?: string;

    @IsOptional()
    @IsString()
    @MaxLength(80)
    areaId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    keyword?: string;
}

export class HomeAssistantLightCommandDto {
    @IsOptional()
    @IsBoolean()
    on?: boolean;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    brightness?: number;

    @IsOptional()
    @IsString()
    @MaxLength(16)
    color?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1000)
    @Max(10000)
    colorTemp?: number;
}

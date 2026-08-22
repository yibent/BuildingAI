import type { UserPlayground } from "@buildingai/db";
import { Playground } from "@buildingai/decorators/playground.decorator";
import { UUIDValidationPipe } from "@buildingai/pipe/param-validate.pipe";
import { WebController } from "@common/decorators/controller.decorator";
import { Body, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";

import {
    HomeAssistantLightCommandDto,
    QueryHomeAssistantDevicesDto,
    UpdateHomeAssistantInstanceDto,
    UpsertHomeAssistantInstanceDto,
} from "./home-assistant.dto";
import { HomeAssistantService } from "./home-assistant.service";

@WebController("smart-home")
export class HomeAssistantController {
    constructor(private readonly homeAssistantService: HomeAssistantService) {}

    @Get("ha/instance")
    getInstance(@Playground() user: UserPlayground) {
        return this.homeAssistantService.getInstance(user.id);
    }

    @Put("ha/instance")
    upsertInstance(@Playground() user: UserPlayground, @Body() dto: UpsertHomeAssistantInstanceDto) {
        return this.homeAssistantService.upsertInstance(user.id, dto);
    }

    @Patch("ha/instance")
    updateInstance(
        @Playground() user: UserPlayground,
        @Body() dto: UpdateHomeAssistantInstanceDto,
    ) {
        if (!dto.label) return this.homeAssistantService.getInstance(user.id);
        return this.homeAssistantService.updateInstance(user.id, dto.label);
    }

    @Delete("ha/instance")
    removeInstance(@Playground() user: UserPlayground) {
        return this.homeAssistantService.removeInstance(user.id);
    }

    @Post("ha/instance/sync")
    sync(@Playground() user: UserPlayground) {
        return this.homeAssistantService.sync(user.id);
    }

    @Get("ha/devices")
    listDevices(@Playground() user: UserPlayground, @Query() filters: QueryHomeAssistantDevicesDto) {
        return this.homeAssistantService.listDevices(user.id, filters);
    }

    @Get("ha/devices/:deviceId")
    getDevice(
        @Playground() user: UserPlayground,
        @Param("deviceId", UUIDValidationPipe) deviceId: string,
    ) {
        return this.homeAssistantService.getDevice(user.id, deviceId);
    }

    @Post("ha/devices/:deviceId/refresh")
    refreshDevice(
        @Playground() user: UserPlayground,
        @Param("deviceId", UUIDValidationPipe) deviceId: string,
    ) {
        return this.homeAssistantService.refreshDevice(user.id, deviceId);
    }

    @Post("ha/devices/:deviceId/command")
    controlDevice(
        @Playground() user: UserPlayground,
        @Param("deviceId", UUIDValidationPipe) deviceId: string,
        @Body() command: HomeAssistantLightCommandDto,
    ) {
        return this.homeAssistantService.controlDevice(user.id, deviceId, command);
    }
}

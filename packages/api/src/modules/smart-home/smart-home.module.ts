import { TypeOrmModule } from "@buildingai/db/@nestjs/typeorm";
import { HomeAssistantDevice, HomeAssistantInstance } from "@buildingai/db/entities";
import { Module } from "@nestjs/common";

import { HomeAssistantController } from "./home-assistant.controller";
import { HomeAssistantService } from "./home-assistant.service";

@Module({
    imports: [TypeOrmModule.forFeature([HomeAssistantInstance, HomeAssistantDevice])],
    controllers: [HomeAssistantController],
    providers: [HomeAssistantService],
    exports: [HomeAssistantService],
})
export class SmartHomeModule {}

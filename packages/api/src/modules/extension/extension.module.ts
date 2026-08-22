import {
    ExtensionStatus,
    ExtensionSupportTerminal,
    ExtensionType,
} from "@buildingai/constants/shared/extension.constant";
import { getCachedExtensionList, loadExtensionModule } from "@buildingai/core/modules";
import {
    ExtensionConfigService,
    ExtensionSchemaService,
    ExtensionsService,
    UploadModule,
} from "@buildingai/core/modules";
import { TypeOrmModule } from "@buildingai/db/@nestjs/typeorm";
import { Extension } from "@buildingai/db/entities";
import { DataSource } from "@buildingai/db/typeorm";
import { TerminalLogger } from "@buildingai/logger";
import { ExtensionFeatureScanService } from "@common/modules/auth/services/extension-feature-scan.service";
import { DynamicModule, Logger, Module, OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import fs from "fs-extra";
import path from "path";

import { AuthModule } from "../auth/auth.module";
import { Pm2Module } from "../pm2/pm2.module";
import { ExtensionConsoleController } from "./controllers/console/extension.controller";
import { ExtensionWebController } from "./controllers/web/extension.controller";
import { ExtensionMarketService } from "./services/extension-market.service";
import { ExtensionOperationService } from "./services/extension-operation.service";
import { ExtensionSeedService } from "./services/extension-seed.service";

@Module({
    imports: [],
    providers: [],
    exports: [],
})
export class ExtensionCoreModule implements OnModuleInit {
    static async register(): Promise<DynamicModule> {
        const loadedExtensions: DynamicModule[] = [];

        const extensionList = getCachedExtensionList();

        if (extensionList.length === 0) {
            TerminalLogger.info("Extensions", "No enabled extensions found");
        } else {
            TerminalLogger.info(
                "Extensions",
                `Found ${extensionList.length} enabled extension(s): ${extensionList.map((e) => e.name).join(", ")}`,
            );

            for (const extensionInfo of extensionList) {
                const extensionModule = await loadExtensionModule(extensionInfo);
                if (extensionModule) {
                    loadedExtensions.push(extensionModule);
                }
            }
        }

        return {
            module: ExtensionCoreModule,
            imports: [
                AuthModule,
                Pm2Module,
                UploadModule,
                TypeOrmModule.forFeature([Extension]),
                ...loadedExtensions,
            ],
            providers: [
                ExtensionConfigService,
                ExtensionSchemaService,
                ExtensionsService,
                ExtensionMarketService,
                ExtensionOperationService,
                ExtensionSeedService,
            ],
            controllers: [ExtensionConsoleController, ExtensionWebController],
            exports: [],
        };
    }

    private readonly logger = new Logger(ExtensionCoreModule.name);

    constructor(private readonly moduleRef: ModuleRef) {}

    /**
     * Execute initialization tasks on module init
     * - Clean extension operation locks
     * - Execute seeds for newly installed extensions
     * - Sync extension member features (incremental update)
     *
     * Called after all modules are initialized
     */
    async onModuleInit() {
        // Clean extension operation locks on startup
        await ExtensionOperationService.cleanAllLocks();

        const extensionList = getCachedExtensionList();
        if (extensionList.length === 0) {
            return;
        }

        // Get DataSource from the module
        const dataSource = this.moduleRef.get(DataSource, { strict: false });
        const seedService = new ExtensionSeedService(dataSource);

        // Give locally-developed extensions their database row before anything
        // downstream looks for one.
        await this.registerMissingLocalExtensions(extensionList);

        await seedService.executeNewExtensionSeeds(extensionList);

        // Sync extension member features (incremental update)
        await this.syncAllExtensionFeatures(extensionList);
    }

    /**
     * 给 extensions.json 里已启用、但数据库里没有记录的本地扩展补上记录。
     *
     * 市场安装流程会同时写目录和数据库；而在仓库里直接开发的扩展只有目录，
     * 于是它虽然能被加载、路由也通，却**不会出现在应用中心列表**（列表查的是
     * `extension` 表里 status=ENABLED 的行）。这个差异非常难查：接口全都正常，
     * 只是列表是空的。这里按 manifest 补齐，让"放进 extensions/ 就能用"成立。
     *
     * 只新增，不更新已有记录 —— 管理员在后台改过的别名、排序、标签不该被启动覆盖。
     */
    private async registerMissingLocalExtensions(
        extensionList: {
            identifier: string;
            name: string;
            version: string;
            description?: string;
            path: string;
        }[],
    ): Promise<void> {
        try {
            const extensionsService = this.moduleRef.get(ExtensionsService, { strict: false });

            for (const info of extensionList) {
                const existing = await extensionsService.findByIdentifier(info.identifier);
                if (existing) continue;

                // ExtensionInfo.name 是目录名，展示名和图标只在 manifest 里，
                // 不读 manifest 的话应用中心会显示成 "safe-cracker" 这种目录名。
                const manifest = await this.readManifest(info.path);

                await extensionsService.create({
                    name: manifest?.name || info.name,
                    identifier: info.identifier,
                    version: manifest?.version || info.version,
                    description: manifest?.description ?? info.description,
                    icon: manifest?.icon,
                    homepage: manifest?.homepage,
                    author: manifest?.author,
                    type:
                        manifest?.type === "functional"
                            ? ExtensionType.FUNCTIONAL
                            : ExtensionType.APPLICATION,
                    supportTerminal: [ExtensionSupportTerminal.WEB],
                    status: ExtensionStatus.ENABLED,
                    isLocal: true,
                    config: manifest?.config,
                });
                this.logger.log(
                    `本地扩展 ${info.identifier} 已补齐数据库记录（${manifest?.name || info.name}）`,
                );
            }
        } catch (error) {
            // 补记录失败不该拦住启动：扩展本身仍然可用，只是列表里看不到。
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`补齐本地扩展数据库记录失败: ${message}`);
        }
    }

    /** 读扩展目录下的 manifest.json；读不到就返回 null，由调用方回退。 */
    private async readManifest(extensionPath: string): Promise<{
        name?: string;
        version?: string;
        description?: string;
        icon?: string;
        homepage?: string;
        type?: string;
        author?: { avatar?: string; name: string; homepage?: string };
        config?: Record<string, unknown>;
    } | null> {
        try {
            return await fs.readJson(path.join(extensionPath, "manifest.json"));
        } catch {
            return null;
        }
    }

    /**
     * 同步所有已启用插件的会员功能
     *
     * 增量更新逻辑：
     * - 扫描到的功能如果数据库没有，则新增
     * - 扫描到的功能如果数据库有，则更新名称和描述
     * - 数据库有但扫描不到的功能，则删除
     *
     * @param extensionList 已启用的插件列表
     */
    private async syncAllExtensionFeatures(
        extensionList: { identifier: string; name: string }[],
    ): Promise<void> {
        try {
            const extensionsService = this.moduleRef.get(ExtensionsService, { strict: false });
            const featureScanService = this.moduleRef.get(ExtensionFeatureScanService, {
                strict: false,
            });

            this.logger.log("开始同步插件会员功能...");

            for (const extensionInfo of extensionList) {
                try {
                    // 从数据库获取插件记录以获取 extensionId
                    const extension = await extensionsService.findByIdentifier(
                        extensionInfo.identifier,
                    );

                    if (!extension) {
                        this.logger.warn(
                            `插件 ${extensionInfo.identifier} 未在数据库中找到，跳过功能同步`,
                        );
                        continue;
                    }

                    const result = await featureScanService.scanAndSyncExtensionFeatures(
                        extensionInfo.identifier,
                        extension.id,
                    );

                    if (result.added > 0 || result.updated > 0 || result.removed > 0) {
                        this.logger.log(
                            `插件 ${extensionInfo.identifier} 功能同步完成: 新增 ${result.added}, 更新 ${result.updated}, 删除 ${result.removed}`,
                        );
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    this.logger.error(
                        `同步插件 ${extensionInfo.identifier} 功能失败: ${errorMessage}`,
                    );
                    // 不抛出错误，继续处理其他插件
                }
            }

            this.logger.log("插件会员功能同步完成");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`同步插件会员功能失败: ${errorMessage}`);
            // 不抛出错误，避免影响应用启动
        }
    }
}

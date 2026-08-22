import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import {
    AiWorkflow,
    LuaModule,
    ProgrammingProject,
    type ProgrammingProjectPublishedSnapshot,
    ProgrammingProjectTool,
    type ProgrammingProjectToolSnapshot,
    ProgrammingTrigger,
    normalizeProgrammingProjectTool,
    programmingProjectToolKey,
} from "@buildingai/db/entities";
import { Repository } from "@buildingai/db/typeorm";
import { HttpErrorFactory } from "@buildingai/errors";
import { LuaDeviceGatewayService } from "@modules/lua-device/lua-device-gateway.service";
import { HomeAssistantService } from "@modules/smart-home/home-assistant.service";
import { Injectable } from "@nestjs/common";

import type { CreateLuaModuleDto, QueryLuaModuleDto } from "../lua/lua-module.dto";
import { CreateLuaDeviceRunDto } from "../lua-device/lua-device.dto";
import { LuaModuleService } from "../lua/lua-module.service";
import { XiaozhiService } from "../organization/services/xiaozhi.service";
import { SimulatorService } from "../simulator/simulator.service";
import { WorkflowRuntimeDeviceService } from "./workflow-runtime-device.service";
import type { SimulatorBoardType } from "../simulator/simulator.types";
import {
    CreateProgrammingProjectDto,
    ProgrammingProjectToolDto,
    QueryProgrammingProjectDto,
    UpdateProgrammingProjectDto,
} from "./programming-project.dto";
import {
    buildDecryptGameSchema,
    DECRYPT_TEMPLATE_ID,
    DECRYPT_TEMPLATE_LUA_A,
    DECRYPT_TEMPLATE_LUA_B,
} from "./programming-project-templates";
import { WorkflowService } from "./workflow.service";

type WorkflowReferences = {
    luaModuleIds: string[];
    tools: ProgrammingProjectToolSnapshot[];
};

export type ProgrammingProjectDetail = ProgrammingProject & {
    mainWorkflow: AiWorkflow;
    tools: ProgrammingProjectToolSnapshot[];
    luaModuleCount: number;
};

export type ProgrammingProjectListResult = {
    items: ProgrammingProjectDetail[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function uniqueTools(
    tools: Array<{
        kind?: string | null;
        mcpServerId?: string | null;
        toolName?: string | null;
        deviceId?: string | null;
    }>,
): ProgrammingProjectToolSnapshot[] {
    const seen = new Set<string>();
    const result: ProgrammingProjectToolSnapshot[] = [];
    for (const tool of tools) {
        const normalized = normalizeProgrammingProjectTool(tool);
        if (normalized.kind === "mcp" && (!normalized.mcpServerId || !normalized.toolName)) continue;
        if (normalized.kind !== "mcp" && !normalized.deviceId) continue;
        const key = programmingProjectToolKey(normalized);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(normalized);
    }
    return result;
}

function isPopulatedSchema(schema?: Record<string, unknown>): schema is Record<string, unknown> {
    return Boolean(schema && Array.isArray(schema.nodes) && schema.nodes.length > 0);
}

function nodeId(node: unknown): string | undefined {
    return isRecord(node) && typeof node.id === "string" ? node.id : undefined;
}

function nodeTypeOf(node: unknown): string | undefined {
    return isRecord(node) && typeof node.type === "string" ? node.type : undefined;
}

function edgeSource(edge: unknown): string | undefined {
    return isRecord(edge) && typeof edge.sourceNodeID === "string" ? edge.sourceNodeID : undefined;
}

function edgeTarget(edge: unknown): string | undefined {
    return isRecord(edge) && typeof edge.targetNodeID === "string" ? edge.targetNodeID : undefined;
}

function defaultStartNode(): Record<string, unknown> {
    return {
        id: "start_0",
        type: "start",
        meta: { position: { x: 180, y: 300 } },
        data: { title: "开始", outputs: { type: "object", properties: {} } },
    };
}

function defaultEndNode(): Record<string, unknown> {
    return {
        id: "end_0",
        type: "end",
        meta: { position: { x: 640, y: 300 } },
        data: {
            title: "结束",
            inputsValues: {},
            inputs: { type: "object", properties: {} },
        },
    };
}

function defaultMainWorkflowSchema(): Record<string, unknown> {
    return {
        nodes: [defaultStartNode(), defaultEndNode()],
        edges: [{ sourceNodeID: "start_0", targetNodeID: "end_0" }],
        globalVariable: { type: "object", required: [], properties: {} },
    };
}

function ensureStartAndEndNodes(schema: Record<string, unknown>): Record<string, unknown> {
    const nodes = Array.isArray(schema.nodes) ? [...schema.nodes] : [];
    const edges = Array.isArray(schema.edges) ? [...schema.edges] : [];

    let start = nodes.find((node) => nodeTypeOf(node) === "start");
    if (!start) {
        start = defaultStartNode();
        nodes.unshift(start);
    }
    let end = nodes.find((node) => nodeTypeOf(node) === "end");
    if (!end) {
        end = defaultEndNode();
        nodes.push(end);
    }

    const startId = nodeId(start);
    const endId = nodeId(end);
    if (!startId || !endId) {
        return { ...schema, nodes, edges };
    }

    const others = nodes.filter(
        (node) => nodeTypeOf(node) !== "start" && nodeTypeOf(node) !== "end",
    );
    if (!edges.some((edge) => edgeSource(edge) === startId)) {
        edges.push({
            sourceNodeID: startId,
            targetNodeID: nodeId(others[0]) ?? endId,
        });
    }
    if (!edges.some((edge) => edgeTarget(edge) === endId)) {
        edges.push({
            sourceNodeID: nodeId(others[others.length - 1]) ?? startId,
            targetNodeID: endId,
        });
    }

    return { ...schema, nodes, edges };
}

@Injectable()
export class ProgrammingProjectService {
    constructor(
        @InjectRepository(ProgrammingProject)
        private readonly projectRepository: Repository<ProgrammingProject>,
        @InjectRepository(ProgrammingProjectTool)
        private readonly projectToolRepository: Repository<ProgrammingProjectTool>,
        @InjectRepository(AiWorkflow)
        private readonly workflowRepository: Repository<AiWorkflow>,
        @InjectRepository(LuaModule)
        private readonly luaModuleRepository: Repository<LuaModule>,
        private readonly workflowService: WorkflowService,
        private readonly luaModuleService: LuaModuleService,
        private readonly simulatorService: SimulatorService,
        private readonly luaDeviceGatewayService: LuaDeviceGatewayService,
        private readonly xiaozhiService: XiaozhiService,
        private readonly runtimeDeviceService: WorkflowRuntimeDeviceService,
        private readonly homeAssistantService: HomeAssistantService,
    ) {}

    async findAll(
        userId: string,
        query: QueryProgrammingProjectDto,
    ): Promise<ProgrammingProjectListResult> {
        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? 50;
        const keyword = query.keyword?.trim();
        const qb = this.projectRepository
            .createQueryBuilder("project")
            .where("project.createBy = :userId", { userId })
            .orderBy("project.updatedAt", "DESC")
            .addOrderBy("project.createdAt", "DESC")
            .skip((page - 1) * pageSize)
            .take(pageSize);

        if (keyword) {
            qb.andWhere("(project.name ILIKE :keyword OR project.description ILIKE :keyword)", {
                keyword: `%${keyword}%`,
            });
        }

        const [projects, total] = await qb.getManyAndCount();
        const items = await Promise.all(projects.map((project) => this.toDetail(project)));
        return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }

    async findOne(id: string, userId: string): Promise<ProgrammingProject> {
        const project = await this.projectRepository.findOne({ where: { id, createBy: userId } });
        if (!project) throw HttpErrorFactory.notFound("编程工程不存在");
        return project;
    }

    async findDetail(id: string, userId: string): Promise<ProgrammingProjectDetail> {
        const project = await this.ensureApplicationSimulator(await this.findOne(id, userId), userId);
        return this.toDetail(project);
    }

    async create(
        userId: string,
        dto: CreateProgrammingProjectDto,
    ): Promise<ProgrammingProjectDetail> {
        const project = await this.projectRepository.manager.transaction(async (manager) => {
            const projectRepository = manager.getRepository(ProgrammingProject);
            const workflowRepository = manager.getRepository(AiWorkflow);
            const luaModuleRepository = manager.getRepository(LuaModule);
            const projectType = dto.projectType ?? "conversation";
            const createdProject = await projectRepository.save(
                projectRepository.create({
                    name: dto.name,
                    description: dto.description ?? "",
                    projectType,
                    createBy: userId,
                    runtimeTarget: projectType === "application" ? "simulator" : "local",
                    isPublished: false,
                }),
            );

            let schema: Record<string, unknown>;
            if (dto.template === DECRYPT_TEMPLATE_ID) {
                if (createdProject.projectType !== "application") {
                    throw HttpErrorFactory.badRequest("只有应用工程可以使用模板");
                }
                const codeA = await luaModuleRepository.save(
                    luaModuleRepository.create({
                        name: DECRYPT_TEMPLATE_LUA_A.name,
                        description: DECRYPT_TEMPLATE_LUA_A.description,
                        draftCode: DECRYPT_TEMPLATE_LUA_A.draftCode,
                        inputSchema: DECRYPT_TEMPLATE_LUA_A.inputSchema,
                        outputSchema: DECRYPT_TEMPLATE_LUA_A.outputSchema,
                        testParams: DECRYPT_TEMPLATE_LUA_A.testParams,
                        assistantMessages: [],
                        createBy: userId,
                        projectId: createdProject.id,
                    }),
                );
                const codeB = await luaModuleRepository.save(
                    luaModuleRepository.create({
                        name: DECRYPT_TEMPLATE_LUA_B.name,
                        description: DECRYPT_TEMPLATE_LUA_B.description,
                        draftCode: DECRYPT_TEMPLATE_LUA_B.draftCode,
                        inputSchema: DECRYPT_TEMPLATE_LUA_B.inputSchema,
                        outputSchema: DECRYPT_TEMPLATE_LUA_B.outputSchema,
                        testParams: DECRYPT_TEMPLATE_LUA_B.testParams,
                        assistantMessages: [],
                        createBy: userId,
                        projectId: createdProject.id,
                    }),
                );
                schema = buildDecryptGameSchema(codeA.id, codeB.id);
            } else {
                schema = isPopulatedSchema(dto.schema) ? dto.schema : defaultMainWorkflowSchema();
            }
            schema = ensureStartAndEndNodes(schema);

            const workflow = await workflowRepository.save(
                workflowRepository.create({
                    name: dto.name,
                    description: dto.description ?? "",
                    schema,
                    createBy: userId,
                    projectId: createdProject.id,
                    isMain: true,
                    isPublished: false,
                }),
            );
            createdProject.mainWorkflowId = workflow.id;
            return projectRepository.save(createdProject);
        });
        return this.toDetail(await this.ensureApplicationSimulator(project, userId));
    }

    async update(
        id: string,
        userId: string,
        dto: UpdateProgrammingProjectDto,
    ): Promise<ProgrammingProjectDetail> {
        const project = await this.findOne(id, userId);
        if (dto.name !== undefined) project.name = dto.name;
        if (dto.description !== undefined) project.description = dto.description;

        let target = dto.runtimeTarget ?? project.runtimeTarget;
        if (project.projectType === "application" && target === "local") {
            target = "simulator";
        }
        let simulatorSessionId =
            dto.simulatorSessionId !== undefined
                ? dto.simulatorSessionId
                : project.simulatorSessionId;
        let deviceId = dto.deviceId !== undefined ? dto.deviceId : project.deviceId;
        let xiaozhiAgentId =
            dto.xiaozhiAgentId !== undefined ? dto.xiaozhiAgentId || null : project.xiaozhiAgentId;

        if (target === "local") {
            simulatorSessionId = null;
            deviceId = null;
        } else if (target === "simulator") {
            this.assertApplicationOnly(project, "硬件仿真");
            simulatorSessionId = this.resolveSimulatorSessionId(
                project,
                userId,
                simulatorSessionId,
            );
            deviceId = null;
        } else if (xiaozhiAgentId) {
            await this.xiaozhiService.requireAccessibleAgent(userId, xiaozhiAgentId);
            deviceId = null;
            simulatorSessionId = null;
        } else if (deviceId) {
            const devices = await this.luaDeviceGatewayService.listAllDevices();
            if (!devices.some((device) => device.deviceId === deviceId.toLowerCase())) {
                throw HttpErrorFactory.notFound("CubeCat 设备不存在");
            }
            simulatorSessionId = null;
        } else {
            throw HttpErrorFactory.badRequest("请选择 CubeCat 设备");
        }

        project.runtimeTarget = target;
        project.simulatorSessionId = simulatorSessionId;
        project.deviceId = deviceId;
        project.xiaozhiAgentId = xiaozhiAgentId;
        const saved = await this.projectRepository.save(project);

        if (dto.name !== undefined || dto.description !== undefined) {
            const workflow = await this.getMainWorkflow(saved, userId);
            if (dto.name !== undefined) workflow.name = dto.name;
            if (dto.description !== undefined) workflow.description = dto.description;
            await this.workflowRepository.save(workflow);
        }

        return this.toDetail(saved);
    }

    async replaceTools(
        id: string,
        userId: string,
        tools: ProgrammingProjectToolDto[],
    ): Promise<ProgrammingProjectDetail> {
        const project = await this.findOne(id, userId);
        const deduped = uniqueTools(tools);
        await this.assertToolsOwned(userId, deduped);
        await this.projectRepository.manager.transaction(async (manager) => {
            const repository = manager.getRepository(ProgrammingProjectTool);
            await repository.delete({ projectId: project.id });
            if (deduped.length) {
                await repository.save(
                    deduped.map((tool) =>
                        repository.create({
                            projectId: project.id,
                            kind: tool.kind,
                            mcpServerId: tool.mcpServerId ?? null,
                            toolName: tool.toolName ?? null,
                            deviceId: tool.deviceId ?? null,
                            toolKey: programmingProjectToolKey(tool),
                        }),
                    ),
                );
            }
        });
        project.updatedAt = new Date();
        await this.projectRepository.save(project);
        return this.toDetail(project);
    }

    async assertToolEnabled(
        projectId: string,
        userId: string,
        mcpServerId: string,
        toolName: string,
    ): Promise<void> {
        await this.findOne(projectId, userId);
        const enabled = await this.projectToolRepository.findOne({
            where: {
                projectId,
                toolKey: programmingProjectToolKey({
                    kind: "mcp",
                    mcpServerId,
                    toolName,
                }),
            },
        });
        if (!enabled) {
            throw HttpErrorFactory.badRequest(`工具 ${toolName} 未加入当前工程`);
        }
    }

    async publish(id: string, userId: string): Promise<ProgrammingProjectDetail> {
        const project = await this.findOne(id, userId);
        const workflow = await this.getMainWorkflow(project, userId);
        this.workflowService.assertPublishableSchema(workflow.schema, project.projectType);
        const schema = workflow.schema as Record<string, unknown>;
        const references = this.extractReferences(schema);
        const modules = await Promise.all(
            references.luaModuleIds.map(async (moduleId) => {
                const luaModule = await this.luaModuleService.findOne(moduleId, userId);
                if (luaModule.projectId !== project.id) {
                    throw HttpErrorFactory.badRequest(
                        `Lua 模块「${luaModule.name}」不属于当前工程`,
                    );
                }
                await this.luaModuleService.validateDraft(luaModule);
                return {
                    id: luaModule.id,
                    name: luaModule.name,
                    code: luaModule.draftCode,
                    inputSchema: luaModule.inputSchema as Record<string, unknown>,
                    outputSchema: luaModule.outputSchema as Record<string, unknown>,
                };
            }),
        );
        const enabledTools = await this.listToolRefs(project.id);
        const enabledToolKeys = new Set(enabledTools.map((tool) => programmingProjectToolKey(tool)));
        const unavailableTools = references.tools.filter(
            (tool) => !enabledToolKeys.has(programmingProjectToolKey(tool)),
        );
        if (unavailableTools.length) {
            throw HttpErrorFactory.badRequest(
                `主流程引用了未加入工程的工具：${unavailableTools
                    .map((tool) => tool.toolName || tool.deviceId || programmingProjectToolKey(tool))
                    .join("、")}`,
            );
        }
        await this.assertRuntimeTarget(project, userId);

        const publishedAt = new Date();
        const snapshot: ProgrammingProjectPublishedSnapshot = {
            version: 1,
            workflow: { id: workflow.id, name: workflow.name, schema },
            luaModules: modules,
            tools: enabledTools,
            runtime: {
                target: project.runtimeTarget,
                ...(project.simulatorSessionId
                    ? { simulatorSessionId: project.simulatorSessionId }
                    : {}),
                ...(project.deviceId ? { deviceId: project.deviceId } : {}),
                ...(project.xiaozhiAgentId ? { xiaozhiAgentId: project.xiaozhiAgentId } : {}),
            },
            publishedAt: publishedAt.toISOString(),
        };

        await this.projectRepository.manager.transaction(async (manager) => {
            workflow.isPublished = true;
            workflow.publishedAt = publishedAt;
            workflow.publishedSchema = schema;
            await manager.getRepository(AiWorkflow).save(workflow);

            project.isPublished = true;
            project.publishedAt = publishedAt;
            project.publishedSnapshot = snapshot;
            await manager.getRepository(ProgrammingProject).save(project);
        });

        return this.toDetail(project);
    }

    async unpublish(id: string, userId: string): Promise<ProgrammingProjectDetail> {
        const project = await this.findOne(id, userId);
        if (!project.isPublished) throw HttpErrorFactory.badRequest("该工程当前未发布");
        const workflow = await this.getMainWorkflow(project, userId);
        await this.projectRepository.manager.transaction(async (manager) => {
            project.isPublished = false;
            workflow.isPublished = false;
            await manager.getRepository(ProgrammingProject).save(project);
            await manager.getRepository(AiWorkflow).save(workflow);
        });
        return this.toDetail(project);
    }

    async findPublished(
        id: string,
        userId: string,
    ): Promise<{ project: ProgrammingProject; snapshot: ProgrammingProjectPublishedSnapshot }> {
        const project = await this.findOne(id, userId);
        if (!project.isPublished || !project.publishedSnapshot) {
            throw HttpErrorFactory.badRequest("该工程当前未发布");
        }
        return { project, snapshot: project.publishedSnapshot };
    }

    async remove(id: string, userId: string): Promise<void> {
        const project = await this.findOne(id, userId);
        this.simulatorService.removeForProject(project.id, userId);
        await this.projectRepository.manager.transaction(async (manager) => {
            await manager.getRepository(ProgrammingProjectTool).delete({ projectId: project.id });
            await manager
                .getRepository(ProgrammingTrigger)
                .delete({ projectId: project.id, createBy: userId });
            await manager.getRepository(LuaModule).delete({ projectId: project.id });
            await manager.getRepository(AiWorkflow).delete({ projectId: project.id });
            await manager
                .getRepository(ProgrammingProject)
                .delete({ id: project.id, createBy: userId });
        });
    }

    async listLuaModules(userId: string, projectId: string, query: QueryLuaModuleDto) {
        const project = await this.findOne(projectId, userId);
        this.assertApplicationOnly(project, "Lua 模块");
        return this.luaModuleService.findAll(userId, { ...query, projectId });
    }

    async createLuaModule(userId: string, projectId: string, dto: CreateLuaModuleDto) {
        const project = await this.findOne(projectId, userId);
        this.assertApplicationOnly(project, "Lua 模块");
        return this.luaModuleService.create(userId, dto, projectId);
    }

    async listUnassignedLuaModules(userId: string, projectId: string) {
        const project = await this.findOne(projectId, userId);
        this.assertApplicationOnly(project, "Lua 模块");
        return this.luaModuleService.findAll(userId, {
            page: 1,
            pageSize: 100,
            unassigned: true,
        });
    }

    async importLuaModule(userId: string, projectId: string, moduleId: string) {
        const project = await this.findOne(projectId, userId);
        this.assertApplicationOnly(project, "Lua 模块");
        return this.luaModuleService.cloneIntoProject(moduleId, userId, projectId);
    }

    async listSimulatorSessions(userId: string, projectId: string) {
        const project = await this.findOne(projectId, userId);
        this.assertApplicationOnly(project, "硬件仿真");
        return this.simulatorService.list(userId, projectId);
    }

    async createSimulatorSession(
        userId: string,
        projectId: string,
        name?: string,
        boardType?: SimulatorBoardType,
    ) {
        const project = await this.findOne(projectId, userId);
        this.assertApplicationOnly(project, "硬件仿真");
        return this.simulatorService.create(userId, name, boardType, projectId);
    }

    async getRuntimeSelection(projectId: string, userId: string) {
        const project = await this.findOne(projectId, userId);
        await this.assertRuntimeTarget(project, userId);
        let deviceId = project.deviceId ?? undefined;
        if (project.runtimeTarget === "device") {
            deviceId = await this.runtimeDeviceService.resolveLuaDeviceId(userId, {
                runtimeTarget: "device",
                xiaozhiAgentId: project.xiaozhiAgentId ?? undefined,
                deviceId: project.xiaozhiAgentId ? undefined : deviceId,
            });
        }
        return {
            projectId: project.id,
            runtimeTarget: project.runtimeTarget,
            simulatorSessionId: project.simulatorSessionId ?? undefined,
            deviceId,
            xiaozhiAgentId: project.xiaozhiAgentId ?? undefined,
        };
    }

    async createLuaRun(userId: string, projectId: string, dto: CreateLuaDeviceRunDto) {
        const project = await this.findOne(projectId, userId);
        this.assertApplicationOnly(project, "Lua 模块");
        if (project.runtimeTarget !== "device") {
            throw HttpErrorFactory.badRequest("请先把运行目标设为 CubeCat 设备");
        }
        const deviceId = await this.runtimeDeviceService.resolveLuaDeviceId(userId, {
            runtimeTarget: "device",
            xiaozhiAgentId: project.xiaozhiAgentId ?? undefined,
            deviceId: project.xiaozhiAgentId ? undefined : (project.deviceId ?? undefined),
        });
        return this.luaDeviceGatewayService.createRun(userId, deviceId, {
            ...dto,
            projectId: project.id,
        });
    }

    private async toDetail(project: ProgrammingProject): Promise<ProgrammingProjectDetail> {
        const [mainWorkflow, tools, luaModuleCount] = await Promise.all([
            this.getMainWorkflow(project, project.createBy),
            this.listToolRefs(project.id),
            this.luaModuleRepository.count({
                where: { projectId: project.id, createBy: project.createBy },
            }),
        ]);
        return Object.assign(project, { mainWorkflow, tools, luaModuleCount });
    }

    private async getMainWorkflow(
        project: ProgrammingProject,
        userId: string,
    ): Promise<AiWorkflow> {
        const workflow = project.mainWorkflowId
            ? await this.workflowRepository.findOne({
                  where: { id: project.mainWorkflowId, projectId: project.id, createBy: userId },
              })
            : await this.workflowRepository.findOne({
                  where: { projectId: project.id, createBy: userId, isMain: true },
              });
        if (!workflow) throw HttpErrorFactory.badRequest("工程缺少主流程");
        return workflow;
    }

    private async listToolRefs(projectId: string): Promise<ProgrammingProjectToolSnapshot[]> {
        const rows = await this.projectToolRepository.find({
            where: { projectId },
            order: { createdAt: "ASC" },
        });
        return rows.map((row) => normalizeProgrammingProjectTool(row));
    }

    private async assertToolsOwned(
        userId: string,
        tools: ProgrammingProjectToolSnapshot[],
    ): Promise<void> {
        await Promise.all(
            tools.map(async (tool) => {
                if (tool.kind === "homeassistant") {
                    if (!tool.deviceId) throw HttpErrorFactory.badRequest("智能家居设备缺少 deviceId");
                    await this.homeAssistantService.getDevice(userId, tool.deviceId);
                    return;
                }
                if (!tool.mcpServerId || !tool.toolName) {
                    throw HttpErrorFactory.badRequest("MCP 工具缺少服务或名称");
                }
            }),
        );
    }

    private extractReferences(schema: Record<string, unknown>): WorkflowReferences {
        const luaModuleIds = new Set<string>();
        const tools: ProgrammingProjectToolSnapshot[] = [];
        const seen = new Set<object>();
        const visit = (value: unknown): void => {
            if (!value || typeof value !== "object" || seen.has(value)) return;
            seen.add(value);
            if (Array.isArray(value)) {
                value.forEach(visit);
                return;
            }
            const node = value as Record<string, unknown>;
            const data = isRecord(node.data) ? node.data : undefined;
            if (typeof data?.luaModuleId === "string" && data.luaModuleId) {
                luaModuleIds.add(data.luaModuleId);
            }
            if (
                node.type === "mcp" &&
                typeof data?.mcpServerId === "string" &&
                data.mcpServerId &&
                typeof data.toolName === "string" &&
                data.toolName
            ) {
                tools.push({
                    kind: "mcp",
                    mcpServerId: data.mcpServerId,
                    toolName: data.toolName,
                });
            }
            if (
                node.type === "smart_home" &&
                data?.provider === "homeassistant" &&
                typeof data?.deviceId === "string" &&
                data.deviceId
            ) {
                tools.push({
                    kind: data.provider,
                    deviceId: data.deviceId,
                });
            }
            Object.values(node).forEach(visit);
        };
        visit(schema);
        return { luaModuleIds: [...luaModuleIds], tools: uniqueTools(tools) };
    }

    private assertApplicationOnly(project: ProgrammingProject, feature: string): void {
        if (project.projectType === "application") return;
        throw HttpErrorFactory.badRequest(`对话流工程不支持${feature}`);
    }

    private async ensureApplicationSimulator(
        project: ProgrammingProject,
        userId: string,
    ): Promise<ProgrammingProject> {
        if (project.projectType !== "application") return project;
        if (project.runtimeTarget === "device") return project;
        const simulatorSessionId = this.resolveSimulatorSessionId(
            project,
            userId,
            project.simulatorSessionId,
        );
        if (
            project.runtimeTarget === "simulator" &&
            project.simulatorSessionId === simulatorSessionId
        ) {
            return project;
        }
        project.runtimeTarget = "simulator";
        project.simulatorSessionId = simulatorSessionId;
        return this.projectRepository.save(project);
    }

    private resolveSimulatorSessionId(
        project: ProgrammingProject,
        userId: string,
        preferredId?: string | null,
    ): string {
        if (preferredId) {
            try {
                this.simulatorService.getForProjectUser(preferredId, userId, project.id);
                return preferredId;
            } catch {
                // Session expired after process restart; create or reuse below.
            }
        }
        const existing = this.simulatorService.list(userId, project.id)[0];
        if (existing) return existing.id;
        return this.simulatorService.create(userId, "CubeCat 仿真", "cubecat-p4", project.id).id;
    }

    private async assertRuntimeTarget(project: ProgrammingProject, userId: string): Promise<void> {
        if (project.projectType !== "application" && project.runtimeTarget === "local") return;
        if (project.runtimeTarget === "local" || project.runtimeTarget === "simulator") {
            this.assertApplicationOnly(project, "硬件仿真");
            const simulatorSessionId = this.resolveSimulatorSessionId(
                project,
                userId,
                project.simulatorSessionId,
            );
            if (
                project.runtimeTarget !== "simulator" ||
                project.simulatorSessionId !== simulatorSessionId
            ) {
                project.runtimeTarget = "simulator";
                project.simulatorSessionId = simulatorSessionId;
                await this.projectRepository.save(project);
            }
            return;
        }
        if (project.xiaozhiAgentId) {
            await this.xiaozhiService.requireAccessibleAgent(userId, project.xiaozhiAgentId);
            return;
        }
        if (!project.deviceId) throw HttpErrorFactory.badRequest("请选择 CubeCat 设备");
        const devices = await this.luaDeviceGatewayService.listAllDevices();
        if (!devices.some((device) => device.deviceId === project.deviceId!.toLowerCase())) {
            throw HttpErrorFactory.notFound("CubeCat 设备不存在");
        }
    }
}

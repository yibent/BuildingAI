import { TypeOrmModule } from "@buildingai/db/@nestjs/typeorm";
import {
    AccountLog,
    Agent,
    AiMcpServer,
    AiMcpTool,
    AiWorkflow,
    ClassroomEvent,
    ClassroomInteraction,
    Extension,
    Organization,
    OrganizationAppGrant,
    OrganizationAssignment,
    OrganizationAssignmentSubmission,
    OrganizationMember,
    OrganizationQuota,
    OrganizationQuotaLog,
    User,
    XiaozhiAccount,
    XiaozhiAgentBinding,
    XiaozhiDeviceProfile,
    XiaozhiMcpConnection,
    XiaozhiMcpSettings,
    XiaozhiQuickCommand,
    XiaozhiScene,
} from "@buildingai/db/entities";
import { AiMcpModule } from "@modules/ai/mcp/ai-mcp.module";
import { UserModule } from "@modules/user/user.module";
import { Module } from "@nestjs/common";

import { ClassroomKitController } from "./controllers/classroom-kit.controller";
import { ClassroomPublicController } from "./controllers/classroom-public.controller";
import { OrganizationController } from "./controllers/organization.controller";
import { OrganizationConsoleController } from "./controllers/organization-console.controller";
import { AssignmentService } from "./services/assignment.service";
import { ClassroomService } from "./services/classroom.service";
import { ClassroomSessionSweeperService } from "./services/classroom-session-sweeper.service";
import { ClassroomWorkspaceAdapter } from "./services/classroom-workspace.adapter";
import { OrganizationService } from "./services/organization.service";
import { OrganizationAppService } from "./services/organization-app.service";
import { OrganizationConsoleService } from "./services/organization-console.service";
import { OrganizationQuotaService } from "./services/organization-quota.service";
import { WorkflowWebhookToolRegistry } from "./services/workflow-webhook-tool-registry.service";
import { XiaozhiService } from "./services/xiaozhi.service";
import { XiaozhiAutomationService } from "./services/xiaozhi-automation.service";
import { XiaozhiCredentialCryptoService } from "./services/xiaozhi-credential-crypto.service";
import { XiaozhiMcpGatewayService, XiaozhiMcpService } from "./services/xiaozhi-mcp.service";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            AccountLog,
            Agent,
            AiMcpServer,
            AiMcpTool,
            AiWorkflow,
            Extension,
            Organization,
            OrganizationAppGrant,
            OrganizationAssignment,
            OrganizationAssignmentSubmission,
            OrganizationMember,
            OrganizationQuota,
            OrganizationQuotaLog,
            User,
            XiaozhiAccount,
            XiaozhiAgentBinding,
            XiaozhiDeviceProfile,
            XiaozhiScene,
            XiaozhiQuickCommand,
            XiaozhiMcpConnection,
            XiaozhiMcpSettings,
            ClassroomInteraction,
            ClassroomEvent,
        ]),
        UserModule,
        AiMcpModule,
    ],
    controllers: [
        OrganizationController,
        OrganizationConsoleController,
        ClassroomPublicController,
        ClassroomKitController,
    ],
    providers: [
        OrganizationService,
        XiaozhiCredentialCryptoService,
        XiaozhiService,
        XiaozhiAutomationService,
        XiaozhiMcpGatewayService,
        XiaozhiMcpService,
        WorkflowWebhookToolRegistry,
        ClassroomService,
        ClassroomWorkspaceAdapter,
        ClassroomSessionSweeperService,
        AssignmentService,
        OrganizationAppService,
        OrganizationQuotaService,
        OrganizationConsoleService,
    ],
    exports: [
        OrganizationService,
        ClassroomService,
        XiaozhiService,
        XiaozhiMcpService,
        WorkflowWebhookToolRegistry,
    ],
})
export class OrganizationModule {}

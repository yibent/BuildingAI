import {
  programmingProjectToolKey,
  useHomeAssistantDevicesQuery,
  useMcpServersAllQuery,
  type HomeAssistantDevice,
  type ProgrammingProjectToolRef,
} from "@buildingai/services/web";
import { nanoid } from "nanoid";
import {
  createContext,
  useContext,
  useMemo,
  type FC,
  type ReactNode,
} from "react";

import { useOptionalProgrammingProject } from "../../programming/context";
import iconDevice from "../assets/icon-device.svg";
import iconMCP from "../assets/icon-mcp.svg";
import { WorkflowNodeType } from "../nodes/constants";
import {
  defaultCommandForCategory,
  getCategoryLabel,
} from "../nodes/smart-home/controls";
import type { FlowNodeRegistry } from "../typings";
import {
  createMcpInputsValues,
  createMcpOutputsSchema,
  createMcpToolInputsSchema,
} from "../utils/mcp-schema";

export type ProjectToolItem =
  | {
      kind: "mcp";
      key: string;
      title: string;
      description: string;
      mcpServerId: string;
      toolName: string;
      serverLabel: string;
      inputSchema?: Record<string, unknown>;
    }
  | {
      kind: "homeassistant";
      key: string;
      title: string;
      description: string;
      deviceId: string;
      category: string;
      categoryLabel: string;
      online: boolean;
      provider: "homeassistant";
    };

type ProjectToolsContextValue = {
  tools: ProjectToolItem[];
  registries: FlowNodeRegistry[];
  isLoading: boolean;
};

const ProjectToolsContext = createContext<ProjectToolsContextValue>({
  tools: [],
  registries: [],
  isLoading: false,
});

export function useProjectTools(): ProjectToolsContextValue {
  return useContext(ProjectToolsContext);
}

function selectedToolRefs(tools: ProgrammingProjectToolRef[]): ProgrammingProjectToolRef[] {
  return tools.map((tool) =>
    tool.kind === "homeassistant" ? tool : { ...tool, kind: "mcp" as const },
  );
}

function createMcpRegistry(tool: Extract<ProjectToolItem, { kind: "mcp" }>): FlowNodeRegistry {
  return {
    type: `project_tool_${tool.key}`,
    info: {
      icon: iconMCP,
      description: tool.description,
    },
    meta: {
      nodePanelLabel: tool.title,
      nodePanelGroup: "tools",
      nodePanelGroupLabel: "工具",
      nodePanelVisible: true,
      toolKey: tool.key,
      size: { width: 320, height: 390 },
    },
    onAdd() {
      const inputs = createMcpToolInputsSchema(tool.inputSchema);
      return {
        id: `mcp_${nanoid(5)}`,
        type: WorkflowNodeType.MCP,
        data: {
          title: tool.title,
          mcpServerId: tool.mcpServerId,
          toolName: tool.toolName,
          toolBound: true,
          toolInputSchema: tool.inputSchema ?? {},
          inputs,
          inputsValues: createMcpInputsValues(inputs),
          outputs: createMcpOutputsSchema(),
          timeoutMs: 60000,
          failOnToolError: true,
        },
      };
    },
  };
}

function createDeviceRegistry(
  tool: Extract<ProjectToolItem, { kind: "homeassistant" }>,
): FlowNodeRegistry {
  return {
    type: `project_tool_${tool.key}`,
    info: {
      icon: iconDevice,
      description: tool.description,
    },
    meta: {
      nodePanelLabel: tool.title,
      nodePanelGroup: "tools",
      nodePanelGroupLabel: "工具",
      nodePanelVisible: true,
      toolKey: tool.key,
      size: { width: 360, height: 460 },
    },
    onAdd() {
      return {
        id: `smarthome_${nanoid(5)}`,
        type: WorkflowNodeType.SmartHome,
        meta: { position: { x: 400, y: 0 } },
        data: {
          title: tool.title,
          provider: tool.provider,
          deviceId: tool.deviceId,
          deviceName: tool.title,
          category: tool.category,
          command: defaultCommandForCategory(tool.category),
          outputs: {
            type: "object",
            properties: {
              success: { type: "boolean", title: "执行成功" },
              deviceId: { type: "string", title: "设备 ID" },
              name: { type: "string", title: "设备名称" },
              online: { type: "boolean", title: "在线" },
              state: { type: "object", title: "设备状态" },
            },
          },
        },
      };
    },
  };
}

function deviceDescription(device: {
  category: string;
  categoryLabel?: string;
  areaName?: string | null;
  online: boolean;
}) {
  return [
    getCategoryLabel(device.category, device.categoryLabel),
    device.areaName,
    device.online ? "在线" : "离线",
  ]
    .filter(Boolean)
    .join(" · ");
}

export const ProjectToolsProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const project = useOptionalProgrammingProject();
  const projectTools = project?.tools;
  const selected = selectedToolRefs(projectTools ?? []);
  const enabled = Boolean(project);
  const mcpQuery = useMcpServersAllQuery({ isDisabled: false }, { enabled });
  const devicesQuery = useHomeAssistantDevicesQuery(undefined, { enabled });

  const tools = useMemo<ProjectToolItem[]>(() => {
    const devicesById = new Map((devicesQuery.data ?? []).map((device) => [device.id, device]));
    const items: ProjectToolItem[] = [];

    for (const reference of selected) {
      if (reference.kind === "homeassistant" && reference.deviceId) {
        const device = devicesById.get(reference.deviceId) as HomeAssistantDevice | undefined;
        items.push({
          kind: "homeassistant",
          key: programmingProjectToolKey(reference),
          title: device?.name || "Home Assistant 设备",
          description: device ? deviceDescription(device) : "Home Assistant 设备",
          deviceId: reference.deviceId,
          category: device?.category || "other",
          categoryLabel: device?.categoryLabel || "其他设备",
          online: device?.online ?? false,
          provider: "homeassistant",
        });
        continue;
      }
      if (!reference.mcpServerId || !reference.toolName) continue;
      const server = (mcpQuery.data ?? []).find((item) => item.id === reference.mcpServerId);
      const tool = server?.tools?.find((item) => item.name === reference.toolName);
      items.push({
        kind: "mcp",
        key: programmingProjectToolKey(reference),
        title: tool?.title || tool?.name || reference.toolName,
        description: tool?.description || server?.alias || server?.name || "MCP 工具",
        mcpServerId: reference.mcpServerId,
        toolName: reference.toolName,
        serverLabel: server?.alias || server?.name || "MCP",
        inputSchema: tool?.inputSchema as Record<string, unknown> | undefined,
      });
    }
    return items;
  }, [devicesQuery.data, mcpQuery.data, projectTools]);

  const registries = useMemo(
    () =>
      tools.map((tool) =>
        tool.kind === "mcp" ? createMcpRegistry(tool) : createDeviceRegistry(tool),
      ),
    [tools],
  );

  return (
    <ProjectToolsContext.Provider
      value={{
        tools,
        registries,
        isLoading: mcpQuery.isLoading || devicesQuery.isLoading,
      }}
    >
      {children}
    </ProjectToolsContext.Provider>
  );
};

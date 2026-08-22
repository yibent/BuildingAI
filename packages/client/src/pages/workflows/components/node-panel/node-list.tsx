/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import type { WorkflowNodeEntity, WorkflowPortEntity } from "@flowgram.ai/free-layout-editor";
import { useClientContext } from "@flowgram.ai/free-layout-editor";
import type { NodePanelRenderProps } from "@flowgram.ai/free-node-panel-plugin";
import {
  Activity,
  Blocks,
  BookUser,
  BrainCircuit,
  ChevronRight,
  Cpu,
  GitBranch,
  Link2,
  LockKeyhole,
  Search,
  Sparkles,
  Variable,
  Wrench,
  X,
} from "lucide-react";
import type { FC, KeyboardEvent, MouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";

import { useProjectTools } from "../../context/ProjectToolsContext";
import { useUserLuaNodes } from "../../context/UserLuaNodesContext";
import { nodeRegistries, WorkflowNodeType } from "../../nodes";
import type { FlowNodeRegistry } from "../../typings";
import { canContainNode } from "../../utils";

type NodeCategoryId =
  | "frequent"
  | "tools"
  | "ai"
  | "logic"
  | "device"
  | "app"
  | "integration"
  | "user-lua";

type NodeCategory = {
  id: NodeCategoryId;
  label: string;
  description: string;
  icon: typeof Activity;
};

const CATEGORIES: NodeCategory[] = [
  {
    id: "frequent",
    label: "常用",
    description: "最常用的节点",
    icon: Sparkles,
  },
  {
    id: "tools",
    label: "工具",
    description: "工程已启用的 MCP 与物联网设备",
    icon: Wrench,
  },
  {
    id: "ai",
    label: "AI",
    description: "大模型对话与理解",
    icon: BrainCircuit,
  },
  {
    id: "logic",
    label: "逻辑",
    description: "条件分支与循环控制",
    icon: GitBranch,
  },
  {
    id: "device",
    label: "设备",
    description: "硬件控制与设备交互",
    icon: Cpu,
  },
  {
    id: "app",
    label: "智能交互",
    description: "智能体、等待、回传与感知",
    icon: Activity,
  },
  {
    id: "integration",
    label: "连接",
    description: "MCP 工具与 HTTP 接口",
    icon: Link2,
  },
  {
    id: "user-lua",
    label: "我的模块",
    description: "用户自定义的 Lua 模块",
    icon: BookUser,
  },
];

const FREQUENT_NODE_TYPES = new Set<string>([
  WorkflowNodeType.LLM,
  WorkflowNodeType.MCP,
  WorkflowNodeType.Lua,
  WorkflowNodeType.Variable,
  WorkflowNodeType.Condition,
  WorkflowNodeType.HTTP,
  WorkflowNodeType.Agent,
]);

/**
 * 智能交互类节点（仅应用工作流可用）
 */
const APP_NODE_TYPES = new Set<string>([
  WorkflowNodeType.Agent,
  WorkflowNodeType.Wait,
  WorkflowNodeType.Webhook,
  WorkflowNodeType.Vision,
  WorkflowNodeType.Speech,
  WorkflowNodeType.DeviceControl,
  WorkflowNodeType.PhoneCamera,
]);

/**
 * 对话流不使用 Lua 模块与硬件仿真相关节点。
 */
const CONVERSATION_HIDDEN_NODE_TYPES = new Set<string>([...APP_NODE_TYPES, WorkflowNodeType.Lua]);

function isEmbeddedOrUserLuaNode(registry: FlowNodeRegistry): boolean {
  const group = String(registry.meta.nodePanelGroup ?? "");
  return group === "user-lua" || group.startsWith("embedded");
}

const CATEGORY_BY_TYPE: Partial<Record<WorkflowNodeType | string, NodeCategoryId>> = {
  [WorkflowNodeType.LLM]: "ai",
  [WorkflowNodeType.MCP]: "integration",
  [WorkflowNodeType.HTTP]: "integration",
  [WorkflowNodeType.Lua]: "device",
  [WorkflowNodeType.Variable]: "logic",
  [WorkflowNodeType.Condition]: "logic",
  [WorkflowNodeType.MultiCondition]: "logic",
  [WorkflowNodeType.Loop]: "logic",
  [WorkflowNodeType.Continue]: "logic",
  [WorkflowNodeType.Break]: "logic",
  [WorkflowNodeType.Code]: "device",
  [WorkflowNodeType.Comment]: "logic",
  [WorkflowNodeType.Agent]: "app",
  [WorkflowNodeType.Wait]: "app",
  [WorkflowNodeType.Webhook]: "app",
  [WorkflowNodeType.Vision]: "app",
  [WorkflowNodeType.Speech]: "app",
  [WorkflowNodeType.DeviceControl]: "app",
  [WorkflowNodeType.PhoneCamera]: "app",
  [WorkflowNodeType.SmartHome]: "tools",
};

function getCategoryId(registry: FlowNodeRegistry): NodeCategoryId {
  if (registry.meta.nodePanelGroup === "tools") return "tools";
  if (registry.meta.nodePanelGroup === "device") return "device";
  if (registry.meta.nodePanelGroup === "app") return "app";
  if (registry.meta.nodePanelGroup === "user-lua") return "user-lua";
  return CATEGORY_BY_TYPE[registry.type as string] ?? "logic";
}

function getNodeLabel(registry: FlowNodeRegistry): string {
  return registry.meta.nodePanelLabel ?? (registry.type as string);
}

function getNodeDescription(registry: FlowNodeRegistry): string {
  return registry.info?.description || "把这个积木拖入流程，完成一个具体步骤。";
}

export function getVisibleRegistries(params: {
  containerNode: WorkflowNodeEntity | undefined;
  fromPort?: WorkflowPortEntity;
  projectType?: "conversation" | "application";
  userLuaRegistries?: FlowNodeRegistry[];
  projectToolRegistries?: FlowNodeRegistry[];
}): FlowNodeRegistry[] {
  const {
    containerNode,
    fromPort,
    projectType = "conversation",
    userLuaRegistries = [],
    projectToolRegistries = [],
  } = params;

  return nodeRegistries
    .filter((registry) => registry.meta.nodePanelVisible !== false)
    .filter((registry) => {
      if (
        projectType === "conversation" &&
        (CONVERSATION_HIDDEN_NODE_TYPES.has(registry.type as string) ||
          isEmbeddedOrUserLuaNode(registry))
      ) {
        return false;
      }
      if (fromPort && registry.type === WorkflowNodeType.Comment) return false;
      if (registry.meta.onlyInContainer) {
        return registry.meta.onlyInContainer === containerNode?.flowNodeType;
      }
      if (containerNode && !canContainNode(registry.type, containerNode.flowNodeType)) {
        return false;
      }
      return true;
    })
    .concat(projectType === "conversation" ? [] : userLuaRegistries)
    .concat(projectToolRegistries);
}

interface NodeListProps {
  onSelect: NodePanelRenderProps["onSelect"];
  fromPort?: WorkflowPortEntity;
  containerNode?: WorkflowNodeEntity;
  enableMultiAdd?: boolean;
  projectType?: "conversation" | "application";
}

const ConversationNodesWrap = styled.div`
  width: 392px;
  max-height: 520px;
  box-sizing: border-box;
  overflow: auto;
  padding: 8px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12);

  &::-webkit-scrollbar {
    display: none;
  }
`;

const ConversationNodeGroupTitle = styled.div`
  color: #64748b;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
  padding: 10px 10px 5px;
`;

const ConversationNodeGroup = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 4px;
`;

const ConversationNode = styled.button`
  width: 100%;
  min-height: 44px;
  border: 0;
  border-radius: 9px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 7px 10px;
  gap: 10px;
  background: transparent;
  color: inherit;
  text-align: left;

  &:hover:not(:disabled) {
    background-color: #eff6ff;
    color: #1d4ed8;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.3;
  }
`;

function groupRegistries(registries: FlowNodeRegistry[]) {
  const groups: Array<{ id: string; label: string; registries: FlowNodeRegistry[] }> = [];
  registries.forEach((registry) => {
    const id = registry.meta.nodePanelGroup ?? "general";
    const label = registry.meta.nodePanelGroupLabel ?? "通用";
    let group = groups.find((item) => item.id === id);
    if (!group) {
      group = { id, label, registries: [] };
      groups.push(group);
    }
    group.registries.push(registry);
  });
  return groups;
}

/** The original compact popover palette used by conversation flows. */
export const ConversationNodeList: FC<NodeListProps> = ({ onSelect, containerNode, fromPort }) => {
  const context = useClientContext();
  const { registries: userLuaRegistries } = useUserLuaNodes();
  const { registries: projectToolRegistries } = useProjectTools();
  const groups = groupRegistries(
    getVisibleRegistries({
      containerNode,
      fromPort,
      projectType: "conversation",
      userLuaRegistries,
      projectToolRegistries,
    }),
  );

  return (
    <ConversationNodesWrap>
      {groups.map((group) => (
        <div key={group.id}>
          {groups.length > 1 && (
            <ConversationNodeGroupTitle>{group.label}</ConversationNodeGroupTitle>
          )}
          <ConversationNodeGroup>
            {group.registries.map((registry) => {
              const label = getNodeLabel(registry);
              const disabled = !(registry.canAdd?.(context) ?? true);
              return (
                <ConversationNode
                  key={registry.type as string}
                  type="button"
                  disabled={disabled}
                  data-testid={`demo-free-node-list-${registry.type as string}`}
                  title={label}
                  onClick={(event) => {
                    const json = registry.onAdd?.(context);
                    onSelect({
                      nodeType: (json?.type ?? registry.type) as string,
                      selectEvent: event,
                      nodeJSON: json,
                    });
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", fontSize: 18 }}>
                    {registry.info?.icon ? (
                      <img
                        alt=""
                        style={{ width: 20, height: 20, borderRadius: 5, display: "block" }}
                        src={registry.info.icon}
                      />
                    ) : (
                      <Blocks size={18} />
                    )}
                  </span>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: 13,
                      lineHeight: "18px",
                    }}
                  >
                    {label}
                  </span>
                </ConversationNode>
              );
            })}
          </ConversationNodeGroup>
        </div>
      ))}
    </ConversationNodesWrap>
  );
};

interface NodeCardProps {
  registry: FlowNodeRegistry;
  disabled: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

function NodeCard({ registry, disabled, onClick }: NodeCardProps) {
  const label = getNodeLabel(registry);
  return (
    <button
      type="button"
      className="workflow-node-library-card"
      data-testid={`demo-free-node-list-${registry.type as string}`}
      disabled={disabled}
      onClick={onClick}
      title={disabled ? "这个节点当前不能放在这里" : `${label}：${getNodeDescription(registry)}`}
    >
      <span className="workflow-node-library-card-icon" aria-hidden="true">
        {registry.info?.icon ? <img src={registry.info.icon} alt="" /> : <Blocks size={18} />}
      </span>
      <span className="workflow-node-library-card-copy">
        <span className="workflow-node-library-card-title">{label}</span>
        <span className="workflow-node-library-card-description">
          {getNodeDescription(registry)}
        </span>
      </span>
      <span className="workflow-node-library-card-action" aria-hidden="true">
        {disabled ? <LockKeyhole size={14} /> : <ChevronRight size={15} />}
      </span>
    </button>
  );
}

function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Escape") {
    event.currentTarget.blur();
  }
}

export const NodeList: FC<NodeListProps> = ({
  onSelect,
  containerNode,
  fromPort,
  enableMultiAdd = false,
  projectType = "application",
}) => {
  const context = useClientContext();
  const [activeCategory, setActiveCategory] = useState<NodeCategoryId>("frequent");
  const [keyword, setKeyword] = useState("");
  const { registries: userLuaRegistries, isLoading: isUserLuaLoading } = useUserLuaNodes();
  const { registries: projectToolRegistries, isLoading: isProjectToolsLoading } = useProjectTools();

  const registries = useMemo(
    () =>
      getVisibleRegistries({
        containerNode,
        fromPort,
        projectType,
        userLuaRegistries,
        projectToolRegistries,
      }),
    [containerNode, fromPort, projectType, projectToolRegistries, userLuaRegistries],
  );

  const visibleRegistries = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLocaleLowerCase();
    return registries.filter((registry) => {
      const label = getNodeLabel(registry).toLocaleLowerCase();
      const description = getNodeDescription(registry).toLocaleLowerCase();
      const matchesKeyword =
        !normalizedKeyword ||
        label.includes(normalizedKeyword) ||
        description.includes(normalizedKeyword);
      const matchesCategory =
        activeCategory === "frequent"
          ? FREQUENT_NODE_TYPES.has(registry.type as string)
          : getCategoryId(registry) === activeCategory;
      return matchesKeyword && matchesCategory;
    });
  }, [activeCategory, keyword, registries]);

  useEffect(() => {
    if (activeCategory === "tools" || activeCategory === "user-lua") return;
    const categoryHasNodes = registries.some((registry) =>
      activeCategory === "frequent"
        ? FREQUENT_NODE_TYPES.has(registry.type as string)
        : getCategoryId(registry) === activeCategory,
    );
    if (!categoryHasNodes) setActiveCategory("frequent");
  }, [activeCategory, registries]);

  const handleSelect = (event: MouseEvent<HTMLButtonElement>, registry: FlowNodeRegistry) => {
    const json = registry.onAdd?.(context);
    onSelect({
      nodeType: (json?.type ?? registry.type) as string,
      selectEvent: event,
      nodeJSON: json,
    });
  };

  const showUserLuaEmptyMessage = activeCategory === "user-lua" && !keyword.trim();
  const showToolsEmptyMessage = activeCategory === "tools" && !keyword.trim();

  return (
    <div className="workflow-node-library" role="dialog" aria-label="节点库">
      <header className="workflow-node-library-header">
        <div className="workflow-node-library-heading">
          <div className="workflow-node-library-heading-icon" aria-hidden="true">
            <Blocks size={18} />
          </div>
          <div>
            <div className="workflow-node-library-title">节点库</div>
            <div className="workflow-node-library-subtitle">
              {enableMultiAdd ? "连续点击即可添加多个节点" : "选择一个积木，放进你的流程"}
            </div>
          </div>
        </div>
        <div className="workflow-node-library-count">{registries.length} 个节点</div>
      </header>

      <div className="workflow-node-library-search">
        <Search size={15} aria-hidden="true" />
        <input
          value={keyword}
          onChange={(event) => {
            const nextKeyword = event.target.value;
            setKeyword(nextKeyword);
            if (nextKeyword.trim()) setActiveCategory("frequent");
          }}
          onKeyDown={handleSearchKeyDown}
          placeholder="搜索节点，例如：灯光、MCP、条件"
          aria-label="搜索节点"
        />
        {keyword && (
          <button
            type="button"
            className="workflow-node-library-search-clear"
            onClick={() => setKeyword("")}
            aria-label="清除搜索"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="workflow-node-library-body">
        <nav className="workflow-node-library-tabs" aria-label="节点分类">
          {CATEGORIES.filter(
            (category) =>
              projectType === "application" ||
              (category.id !== "user-lua" && category.id !== "app"),
          ).map((category) => {
            const Icon = category.icon;
            const isActive = category.id === activeCategory;
            return (
              <button
                key={category.id}
                type="button"
                className={["workflow-node-library-tab", isActive ? "is-active" : ""]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setActiveCategory(category.id)}
                title={category.description}
                aria-label={category.label}
                aria-pressed={isActive}
              >
                <Icon size={17} aria-hidden="true" />
              </button>
            );
          })}
        </nav>

        <section className="workflow-node-library-results" aria-live="polite">
          <div className="workflow-node-library-results-heading">
            <div>
              <strong>
                {CATEGORIES.find((category) => category.id === activeCategory)?.label ?? "节点"}
              </strong>
              <span>
                {keyword.trim()
                  ? `匹配“${keyword.trim()}”的节点`
                  : CATEGORIES.find((category) => category.id === activeCategory)?.description}
              </span>
            </div>
            <Activity size={15} aria-hidden="true" />
          </div>

          <div className="workflow-node-library-cards">
            {visibleRegistries.length > 0 ? (
              visibleRegistries.map((registry) => (
                <NodeCard
                  key={registry.meta.toolKey ?? (registry.type as string)}
                  registry={registry}
                  disabled={!(registry.canAdd?.(context) ?? true)}
                  onClick={(event) => handleSelect(event, registry)}
                />
              ))
            ) : (
              <div
                className={[
                  "workflow-node-library-empty",
                  showUserLuaEmptyMessage || showToolsEmptyMessage ? "is-message" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {showUserLuaEmptyMessage ? (
                  <span>{isUserLuaLoading ? "正在加载 Lua 模块…" : "当前工程暂无 Lua 模块"}</span>
                ) : showToolsEmptyMessage ? (
                  <>
                    <Variable size={20} aria-hidden="true" />
                    <strong>{isProjectToolsLoading ? "正在加载工具…" : "还没有可用的工具"}</strong>
                    <span>先到工程的工具页勾选 MCP 或物联网设备，再回到这里拖进画布。</span>
                  </>
                ) : (
                  <>
                    <Variable size={20} aria-hidden="true" />
                    <strong>没有找到合适的节点</strong>
                    <span>试试搜索“变量”“条件”或清空筛选。</span>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      <footer className="workflow-node-library-footer">
        <span>提示：从端口打开节点库时，只会显示可以连接到这里的积木。</span>
        <kbd>Esc</kbd>
      </footer>
    </div>
  );
};

/**
 * Webhook 节点 - 等待 CubeCat 通过常驻回传 MCP 把数据送回来。
 * 调用说明会在「设置智能体」执行时写入提示词，这里只等待消息。
 */

import { nanoid } from "nanoid";

import iconWebhook from "../../assets/icon-webhook.svg";
import type { FlowNodeRegistry } from "../../typings";
import { WorkflowNodeType } from "../constants";
import { formMeta } from "./form-meta";

let index = 0;

export const WebhookNodeRegistry: FlowNodeRegistry = {
  type: WorkflowNodeType.Webhook,
  info: {
    icon: iconWebhook,
    description: "等待 CubeCat 调用常驻回传工具。调用说明会自动写入前面的智能体提示词。",
  },
  meta: {
    nodePanelLabel: "回传端点",
    nodePanelGroup: "app",
    nodePanelGroupLabel: "智能交互",
    size: { width: 380, height: 500 },
    defaultPorts: [
      { type: "input" },
      { type: "output", portID: "received", label: "收到数据" },
      { type: "output", portID: "error", label: "错误" },
    ],
  },
  onAdd() {
    return {
      id: `webhook_${nanoid(5)}`,
      type: WorkflowNodeType.Webhook,
      data: {
        title: `回传端点_${++index}`,
        toolName: "",
        toolDescription: "",
        timeoutMs: 0,
        inputSchema: {
          type: "object",
          properties: {
            data: {
              type: "object",
              title: "回传数据",
              description: "从 CubeCat 回传的数据",
            },
            action: {
              type: "string",
              title: "动作类型",
              description: "标识用户执行的动作",
            },
          },
        },
        inputs: {
          type: "object",
          properties: {
            context: {
              type: "string",
              title: "上下文",
              description: "可选。会原样带到输出。",
            },
          },
        },
        inputsValues: {
          context: { type: "constant", content: "" },
        },
        outputs: {
          type: "object",
          properties: {
            received: {
              type: "boolean",
              title: "已收到",
              description: "是否成功接收回传数据",
            },
            data: {
              type: "object",
              title: "回传数据",
              description: "接收到的完整参数",
            },
            action: {
              type: "string",
              title: "动作",
              description: "回传参数里的 action 字段",
            },
            timestamp: {
              type: "number",
              title: "时间戳",
              description: "回传时间",
            },
            context: {
              type: "string",
              title: "上下文",
              description: "从输入带过来的上下文",
            },
          },
        },
      },
    };
  },
  formMeta,
};

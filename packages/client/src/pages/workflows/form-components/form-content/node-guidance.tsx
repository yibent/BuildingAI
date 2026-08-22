/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import type { FlowNodeEntity } from "@flowgram.ai/free-layout-editor";
import { ArrowDown, Lightbulb, Sparkles } from "lucide-react";

import { WorkflowNodeType } from "../../nodes/constants";
import type { FlowNodeRegistry } from "../../typings";
import {
  GuideCard,
  GuideExample,
  GuideHeader,
  GuideIcon,
  GuideLabel,
  GuideList,
  GuideResult,
  GuideText,
} from "./styles";

interface NodeGuidanceContent {
  summary: string;
  steps: string[];
  result: string;
  example?: string;
}

const NODE_GUIDANCE: Partial<Record<string, NodeGuidanceContent>> = {
  [WorkflowNodeType.LLM]: {
    summary: "让模型完成一件具体的理解或生成任务。",
    steps: ["先选择模型", "写清楚希望模型完成的事情", "需要时把上游变量插入提示词"],
    result: "模型会输出一段文本，后续节点可以继续使用它。",
    example: "把用户的问题改写成一句更清晰的任务说明。",
  },
  [WorkflowNodeType.MCP]: {
    summary: "调用一个已经接入系统的工具，让流程连接外部能力。",
    steps: ["选择 MCP 服务", "选择要执行的工具", "填写工具需要的参数"],
    result: "工具返回的数据会自动出现在后续节点的变量中。",
    example: "调用天气工具，查询用户所在城市的天气。",
  },
  [WorkflowNodeType.Speech]: {
    summary: "用通义千问把文字合成语音，经脚本通道直接在 CubeCat 上播放。",
    steps: [
      "在工程设置里把运行目标设为 CubeCat 设备",
      "填写要朗读的文字，或从上游变量接入",
      "需要时选择音色、语速，并决定是否等播完再继续",
    ],
    result: "设备喇叭播出合成语音。这不是 Lua，也不走 require(\"speech\")。",
    example: "把上一关的判定结果朗读给小朋友听。",
  },
  [WorkflowNodeType.Lua]: {
    summary: "在 CubeCat 或仿真设备上执行一个可复用的 Lua 模块。",
    steps: ["选择工程里的 Lua 模块", "把需要的输入接到变量", "查看模块会返回哪些结果"],
    result: "脚本的输出可以用来更新界面、判断条件或触发下一步。",
    example: "传入分钟数，让 CubeCat 显示一个倒计时界面。",
  },
  [WorkflowNodeType.Variable]: {
    summary: "给流程准备一个可以记住信息的变量，或更新已有变量。",
    steps: ["选择声明变量或赋值", "选中要保存的变量", "填写固定值或选择另一个变量"],
    result: "变量会出现在后续节点的输入选择器中。",
    example: "保存用户选择的难度，后面的条件节点就能读取它。",
  },
  [WorkflowNodeType.Condition]: {
    summary: "根据一个条件选择不同的下一步，就像程序里的 if。",
    steps: ["选择要比较的变量", "设置比较方式和目标值", "从对应出口连接下一步"],
    result: "每次运行只会进入满足条件的分支。",
    example: "如果分数大于 80，进入“挑战成功”分支。",
  },
  [WorkflowNodeType.MultiCondition]: {
    summary: "同时准备多组规则，把流程分成多个清晰的方向。",
    steps: ["为每个分支写出规则", "选择规则之间是全部满足还是满足其一", "给每个出口连接动作"],
    result: "流程会按照第一组满足的规则继续运行。",
  },
  [WorkflowNodeType.Loop]: {
    summary: "对一组数据重复执行相同的步骤，就像程序里的 for。",
    steps: ["选择要遍历的数组", "把要重复的节点拖进循环框", "需要时保存每次循环的结果"],
    result: "循环结束后，汇总结果会提供给后续节点。",
    example: "逐个朗读列表中的单词，并记录每个单词的结果。",
  },
  [WorkflowNodeType.HTTP]: {
    summary: "向一个网页接口发送请求，读取系统外部的数据。",
    steps: ["填写接口地址和请求方式", "按接口要求填写参数或请求体", "设置必要的超时时间"],
    result: "响应体、响应头和状态码会作为输出。",
    example: "从班级服务读取今天的任务列表。",
  },
  [WorkflowNodeType.Code]: {
    summary: "用一小段 JavaScript 对输入数据做自定义处理。",
    steps: ["确认输入变量", "在代码中读取 params", "返回后续节点需要的数据"],
    result: "返回值会按照输出结构提供给后续节点。",
    example: "把两个数字相加，再把结果命名为 total。",
  },
  [WorkflowNodeType.Webhook]: {
    summary: "停在这里，等到 CubeCat 用常驻回传工具把数据送回来。",
    steps: [
      "先在工程设置里绑定 CubeCat；运行应用时会自动接通回传 MCP",
      "填写事件名和参数；调用说明会自动写入前面的「设置智能体」提示词",
      "从「收到数据」连到下一步；可选地给「错误」接超时处理",
    ],
    result: "CubeCat 调用常驻回传工具后会进入等待；Lua 跑完后结果会回到对话里，小智再继续说。",
    example: "事件名填 choose_puzzle，前面的智能体提示词会要求它回传 game。",
  },
  [WorkflowNodeType.Wait]: {
    summary: "让流程在这里停一下，等到时间到、CubeCat 调用工具，或收到回传再继续。",
    steps: [
      "选择等待超时、MCP 调用或 Webhook",
      "超时要填等待时长；MCP/Webhook 要填工具名或标识",
      "把「继续」和「超时」分别连到不同的下一步",
    ],
    result: "等到事件后，回传数据会出现在输出里；超时则走超时出口。",
    example: "先设置智能体提示词，再等待 CubeCat 调用 timer_complete。",
  },
  [WorkflowNodeType.Agent]: {
    summary: "切换 CubeCat 的角色提示词，改变它之后怎么和用户说话。",
    steps: [
      "在工程设置里绑定 CubeCat 智能体；运行应用时会自动接通回传 MCP",
      "写好角色提示词；下游回传端点的调用说明会自动追加",
      "需要时把触发信息接到输入",
    ],
    result: "设备会使用新的角色提示词，其中已包含接下来该怎么回传。",
    example: "用户说「开始计时」后，把提示词切成计时助手。",
  },
  [WorkflowNodeType.Comment]: {
    summary: "在画布上写下解释，帮助同学读懂这段程序。",
    steps: ["写清楚这段流程的目的", "放在对应节点附近", "流程运行时它不会执行"],
    result: "团队成员可以直接在画布上理解你的思路。",
  },
};

function getGuidance(node: FlowNodeEntity, registry: FlowNodeRegistry): NodeGuidanceContent {
  return (
    NODE_GUIDANCE[node.flowNodeType as string] ?? {
      summary: registry.info?.description || "这个积木会完成一个具体的流程步骤。",
      steps: ["先阅读每个字段旁边的说明", "从上游变量或固定值中选择输入", "完成后连接到下一步"],
      result: "节点的输出会提供给下游节点继续使用。",
    }
  );
}

export function NodeGuidance({
  node,
  registry,
}: {
  node: FlowNodeEntity;
  registry: FlowNodeRegistry;
}) {
  const guidance = getGuidance(node, registry);

  return (
    <GuideCard data-testid="workflow-node-guidance">
      <GuideHeader>
        <GuideIcon aria-hidden="true">
          <Sparkles size={14} />
        </GuideIcon>
        <div>
          <GuideLabel>先看这里</GuideLabel>
          <GuideText>{guidance.summary}</GuideText>
        </div>
      </GuideHeader>

      <GuideList>
        {guidance.steps.map((step, index) => (
          <li key={step}>
            <span>{index + 1}</span>
            <div>{step}</div>
            {index < guidance.steps.length - 1 && <ArrowDown size={12} aria-hidden="true" />}
          </li>
        ))}
      </GuideList>

      <GuideResult>
        <Lightbulb size={14} aria-hidden="true" />
        <div>
          <strong>完成后</strong>
          <span>{guidance.result}</span>
        </div>
      </GuideResult>

      {guidance.example && <GuideExample>试试看：{guidance.example}</GuideExample>}
    </GuideCard>
  );
}

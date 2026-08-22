/**
 * 应用工程模板。
 *
 * 设置小智 → 等待 MCP 选择 Lua 代码 A/B → 播放一段几秒的演示动画。
 */

export const DECRYPT_TEMPLATE_ID = "decrypt";

const AGENT_PROMPT_CHOOSE = `你是 CubeCat 演示馆馆长。说话简短、清楚。

设备上有两段 Lua 演示可以播放，请问小朋友想看哪一段：
1. A：Lua 代码 A
2. B：Lua 代码 B

默认选 A，除非小朋友点名要 B。
选好后立刻回传。code 只能填 A 或 B。
回传之后请安静等待，不要继续说话，等工具返回设备上的结果后再根据结果说话。`;

const LUA_DEMO_IO = {
    inputSchema: {
        type: "object" as const,
        properties: {
            timeout_ms: {
                type: "number",
                title: "动画时长",
                description: "演示播放的最长毫秒数，默认 4000。点屏幕可以提前结束。",
            },
        },
    },
    outputSchema: {
        type: "object" as const,
        properties: {
            action: { type: "string", title: "动作" },
            code: { type: "string", title: "代码" },
            title: { type: "string", title: "名称" },
            message: { type: "string", title: "对玩家说的话" },
            correct: { type: "boolean", title: "是否完成" },
        },
    },
};

const LUA_CODE_A = `-- Lua 代码 A：自动播放的跳跃演示，不需要触摸操作
local runtime = require("runtime")
local device = require("device")
local ui = require("ui")

function main(params)
  params = params or {}
  local width, height = ui.screen_size()
  local screen = ui.screen({ background = 0xf7f3e8 })
  local ground_y = math.floor(height * 0.72)
  local hero_w, hero_h = 40, 48
  local hero_x = math.floor(width * 0.18)
  ui.rect({ parent = screen, x = 0, y = ground_y, width = width, height = 4, color = 0x5b4636 })
  ui.label({ parent = screen, text = "Lua 代码 A", x = 18, y = 16, color = 0x5b4636 })
  local hint = ui.label({ parent = screen, text = "演示播放中", x = 18, y = 56, color = 0xb45309 })
  local score_label = ui.label({ parent = screen, text = "0", x = width - 80, y = 16, width = 60, color = 0x5b4636 })
  local hero = ui.rect({
    parent = screen, x = hero_x, y = ground_y - hero_h,
    width = hero_w, height = hero_h, color = 0x365314, radius = 8,
  })
  local obstacle_h = 40
  local obstacle = ui.rect({
    parent = screen, x = width + 20, y = ground_y - obstacle_h,
    width = 22, height = obstacle_h, color = 0x166534, radius = 3,
  })
  ui.load(screen)

  local limit = tonumber(params.timeout_ms) or 4000
  if limit < 1500 then limit = 1500 end
  if limit > 12000 then limit = 12000 end
  local started = runtime.now_ms()
  local next_frame = started
  local hero_y = ground_y - hero_h
  local vy = 0
  local ox = width + 20
  local score = 0
  local scored = false
  local gravity = height * 2.6
  local jump_v = -height * 1.05
  local speed = width * 0.55

  while not runtime.cancelled() do
    if runtime.now_ms() - started >= limit then break end
    local ev = ui.poll_event(0)
    if ev and (ev.type == "pressed" or ev.type == "clicked") then break end

    local dt = 0.033
    local gap = ox - (hero_x + hero_w)
    if hero_y >= ground_y - hero_h - 1 and gap > 20 and gap < math.floor(width * 0.28) then
      vy = jump_v
    end
    vy = vy + gravity * dt
    hero_y = hero_y + vy * dt
    if hero_y >= ground_y - hero_h then
      hero_y = ground_y - hero_h
      vy = 0
    end
    ui.update(hero, { y = math.floor(hero_y) })

    ox = ox - speed * dt
    if ox + 22 < 0 then
      ox = width + 40
      scored = false
    end
    ui.update(obstacle, { x = math.floor(ox) })
    if not scored and ox + 22 < hero_x then
      scored = true
      score = score + 1
      ui.set_text(score_label, tostring(score))
    end

    next_frame = next_frame + 33
    local now = runtime.now_ms()
    if next_frame < now then next_frame = now end
    runtime.sleep_until(next_frame)
  end

  ui.set_text(hint, "演示结束")
  local message = "Lua 代码 A 执行完成。"
  device.notify(message)
  return {
    action = "show",
    code = "A",
    title = "Lua 代码 A",
    message = message,
    correct = true,
  }
end
`;

const LUA_CODE_B = `-- Lua 代码 B：自动播放的接星星演示，不需要触摸操作
local runtime = require("runtime")
local device = require("device")
local ui = require("ui")

function main(params)
  params = params or {}
  local width, height = ui.screen_size()
  local screen = ui.screen({ background = 0x0f172a })
  ui.label({ parent = screen, text = "Lua 代码 B", x = 18, y = 16, color = 0xfacc15 })
  local hint = ui.label({ parent = screen, text = "演示播放中", x = 18, y = 56, color = 0x93c5fd })
  local score_label = ui.label({ parent = screen, text = "0", x = width - 80, y = 16, width = 60, color = 0xf8fafc })
  local paddle_w, paddle_h = 72, 18
  local paddle_y = height - 90
  local paddle = ui.rect({
    parent = screen, x = math.floor(width / 2 - paddle_w / 2), y = paddle_y,
    width = paddle_w, height = paddle_h, color = 0x22c55e, radius = 8,
  })
  local star_size = 36
  local star = ui.rect({
    parent = screen, x = math.floor(width * 0.3), y = 80,
    width = star_size, height = star_size, color = 0xfacc15, radius = 18,
  })
  ui.load(screen)

  local limit = tonumber(params.timeout_ms) or 4000
  if limit < 1500 then limit = 1500 end
  if limit > 12000 then limit = 12000 end
  local started = runtime.now_ms()
  local next_frame = started
  local star_x = math.floor(width * 0.3)
  local star_y = 80
  local paddle_x = math.floor(width / 2 - paddle_w / 2)
  local score = 0
  local fall = height * 0.42

  while not runtime.cancelled() do
    if runtime.now_ms() - started >= limit then break end
    local ev = ui.poll_event(0)
    if ev and (ev.type == "pressed" or ev.type == "clicked") then break end

    local dt = 0.033
    local target = star_x + star_size / 2 - paddle_w / 2
    paddle_x = paddle_x + (target - paddle_x) * 0.18
    if paddle_x < 12 then paddle_x = 12 end
    if paddle_x > width - paddle_w - 12 then paddle_x = width - paddle_w - 12 end
    ui.update(paddle, { x = math.floor(paddle_x) })

    star_y = star_y + fall * dt
    if star_y + star_size >= paddle_y then
      score = score + 1
      ui.set_text(score_label, tostring(score))
      star_y = 70
      star_x = 24 + ((runtime.now_ms() * 11) % math.max(1, width - 80))
    end
    ui.update(star, { x = math.floor(star_x), y = math.floor(star_y) })

    next_frame = next_frame + 33
    local now = runtime.now_ms()
    if next_frame < now then next_frame = now end
    runtime.sleep_until(next_frame)
  end

  ui.set_text(hint, "演示结束")
  local message = "Lua 代码 B 执行完成。"
  device.notify(message)
  return {
    action = "show",
    code = "B",
    title = "Lua 代码 B",
    message = message,
    correct = true,
  }
end
`;

export const DECRYPT_TEMPLATE_LUA_A = {
    name: "Lua 代码 A",
    description: "自动播放几秒的跳跃演示动画。",
    draftCode: LUA_CODE_A,
    ...LUA_DEMO_IO,
    testParams: { timeout_ms: 1500 },
};

export const DECRYPT_TEMPLATE_LUA_B = {
    name: "Lua 代码 B",
    description: "自动播放几秒的接星星演示动画。",
    draftCode: LUA_CODE_B,
    ...LUA_DEMO_IO,
    testParams: { timeout_ms: 1500 },
};

export const DECRYPT_TEMPLATE_LUA_SQUARE = DECRYPT_TEMPLATE_LUA_A;
export const DECRYPT_TEMPLATE_LUA_CIRCLE = DECRYPT_TEMPLATE_LUA_B;
export const DECRYPT_TEMPLATE_LUA = DECRYPT_TEMPLATE_LUA_A;

const AGENT_OUTPUTS = {
    type: "object",
    properties: {
        success: { type: "boolean", title: "操作成功" },
        previousPrompt: { type: "string", title: "上一个提示词" },
        currentPrompt: { type: "string", title: "当前提示词" },
        agentName: { type: "string", title: "智能体名称" },
    },
};

const WEBHOOK_OUTPUTS = {
    type: "object",
    properties: {
        received: { type: "boolean", title: "已收到" },
        data: { type: "object", title: "回传数据" },
        action: { type: "string", title: "动作" },
        timestamp: { type: "number", title: "时间戳" },
        context: { type: "string", title: "上下文" },
    },
};

const LUA_OUTPUTS = LUA_DEMO_IO.outputSchema;

function constant(content: string | number | boolean) {
    return { type: "constant", content };
}

function ref(...content: string[]) {
    return { type: "ref", content };
}

function agentNode(
    id: string,
    title: string,
    promptName: string,
    prompt: string,
    trigger: { type: string; content: unknown },
    position: { x: number; y: number },
) {
    return {
        id,
        type: "agent",
        meta: { position },
        data: {
            title,
            action: "switch_prompt",
            promptName,
            inputs: {
                type: "object",
                properties: {
                    prompt: {
                        type: "string",
                        title: "提示词内容",
                        extra: { formComponent: "prompt-editor" },
                    },
                    trigger: { type: "string", title: "触发信息" },
                },
            },
            inputsValues: { prompt: constant(prompt), trigger },
            outputs: AGENT_OUTPUTS,
        },
    };
}

function webhookNode(
    id: string,
    title: string,
    toolName: string,
    toolDescription: string,
    property: { name: string; title: string; description: string },
    timeoutMs: number,
    position: { x: number; y: number },
) {
    return {
        id,
        type: "webhook",
        meta: { position },
        data: {
            title,
            toolName,
            toolDescription,
            timeoutMs,
            inputSchema: {
                type: "object",
                properties: {
                    [property.name]: {
                        type: "string",
                        title: property.title,
                        description: property.description,
                    },
                },
                required: [property.name],
            },
            inputs: {
                type: "object",
                properties: { context: { type: "string", title: "上下文" } },
            },
            inputsValues: { context: constant("") },
            outputs: WEBHOOK_OUTPUTS,
        },
    };
}

function luaNode(
    id: string,
    title: string,
    luaModuleId: string,
    inputsValues: Record<string, unknown>,
    position: { x: number; y: number },
) {
    return {
        id,
        type: "lua",
        meta: { position },
        data: {
            title,
            luaModuleId,
            inputs: {
                type: "object",
                properties: {
                    timeout_ms: { type: "number", title: "动画时长" },
                },
            },
            inputsValues,
            outputs: LUA_OUTPUTS,
        },
    };
}

export function buildDecryptGameSchema(
    codeAModuleId: string,
    codeBModuleId: string = codeAModuleId,
): Record<string, unknown> {
    const choose = {
        name: "code",
        title: "代码",
        description: "A 或 B",
    };

    return {
        nodes: [
            {
                id: "start_0",
                type: "start",
                meta: { position: { x: 80, y: 220 } },
                data: {
                    title: "开始",
                    outputs: { type: "object", properties: {} },
                },
            },
            agentNode("agent_host", "请馆长开场", "演示馆长", AGENT_PROMPT_CHOOSE, constant(""), {
                x: 360,
                y: 180,
            }),
            webhookNode(
                "webhook_choose_1",
                "等待选代码",
                "choose_code",
                "邀请结束后立刻回传所选演示。code 只能填 A 或 B。默认 A。",
                choose,
                60000,
                { x: 680, y: 160 },
            ),
            {
                id: "condition_code",
                type: "condition",
                meta: { position: { x: 1020, y: 160 } },
                data: {
                    title: "选代码",
                    conditions: [
                        {
                            key: "if_b",
                            value: {
                                left: ref("webhook_choose_1", "data", "code"),
                                operator: "eq",
                                right: constant("B"),
                            },
                        },
                        {
                            key: "if_b_cn",
                            value: {
                                left: ref("webhook_choose_1", "data", "code"),
                                operator: "eq",
                                right: constant("Lua代码B"),
                            },
                        },
                    ],
                },
            },
            luaNode(
                "lua_a",
                "Lua 代码 A",
                codeAModuleId,
                { timeout_ms: constant(4000) },
                { x: 1380, y: 40 },
            ),
            luaNode(
                "lua_b",
                "Lua 代码 B",
                codeBModuleId,
                { timeout_ms: constant(4000) },
                { x: 1380, y: 280 },
            ),
            {
                id: "end_0",
                type: "end",
                meta: { position: { x: 1760, y: 180 } },
                data: {
                    title: "结束",
                    inputsValues: {},
                    inputs: { type: "object", properties: {} },
                },
            },
        ],
        edges: [
            { sourceNodeID: "start_0", targetNodeID: "agent_host" },
            { sourceNodeID: "agent_host", targetNodeID: "webhook_choose_1" },
            {
                sourceNodeID: "webhook_choose_1",
                targetNodeID: "condition_code",
                sourcePortID: "received",
            },
            {
                sourceNodeID: "condition_code",
                targetNodeID: "lua_b",
                sourcePortID: "if_b",
            },
            {
                sourceNodeID: "condition_code",
                targetNodeID: "lua_b",
                sourcePortID: "if_b_cn",
            },
            {
                sourceNodeID: "condition_code",
                targetNodeID: "lua_a",
                sourcePortID: "else",
            },
            { sourceNodeID: "lua_a", targetNodeID: "end_0" },
            { sourceNodeID: "lua_b", targetNodeID: "end_0" },
            {
                sourceNodeID: "webhook_choose_1",
                targetNodeID: "end_0",
                sourcePortID: "error",
            },
        ],
        globalVariable: { type: "object", required: [], properties: {} },
    };
}

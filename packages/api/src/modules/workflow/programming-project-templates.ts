/**
 * 应用工程模板。
 *
 * 小游戏馆（最简）：设置小智 → 等待 MCP 回传选关 → 在屏幕上玩一局。
 * 两款游戏：接星星、左右躲避。没有语音播报节点。
 */

export const DECRYPT_TEMPLATE_ID = "decrypt";

const AGENT_PROMPT_CHOOSE = `你是 CubeCat 小游戏馆馆长。说话简短、活泼，带一点鼓励。

馆里有两款要在设备屏幕上用手玩的小游戏，不要自己编规则或替小朋友玩：
1. star：点掉天上掉下来的星星，接到 3 颗过关
2. dodge：按左/右躲开障碍，躲开 4 次过关

现在请邀请小朋友开始玩。默认选 star，除非小朋友点名要躲障碍。
选好后立刻回传。game 只能填 star 或 dodge。
回传之后请安静等待，不要继续说话，等工具返回设备上的游戏结果后再根据结果说话。`;

export const DECRYPT_TEMPLATE_LUA = {
    name: "小游戏馆",
    description: "在 CubeCat 屏幕上玩两款可交互小游戏：接星星、左右躲避。",
    draftCode: `-- 小游戏馆：两款要在屏幕上动手玩的关卡，玩完才返回
local runtime = require("runtime")
local device = require("device")
local alert = require("alert")
local ui = require("ui")

local function field_text(value, key)
  if type(value) == "table" then
    if value[key] ~= nil then
      return tostring(value[key])
    end
    return tostring(value.text or value.message or "")
  end
  return tostring(value or "")
end

local function normalize_game(value)
  local text = string.lower(field_text(value, "game"))
  if string.find(text, "dodge") or string.find(text, "躲") then
    return "dodge"
  end
  return "star"
end

local GAME_TITLE = {
  star = "接住小星星",
  dodge = "左右躲障碍",
}
local GAME_NEED = { star = 3, dodge = 4 }

local function drain_press()
  local last = nil
  local ev = ui.poll_event(0)
  while ev do
    if ev.type == "pressed" or ev.type == "clicked" then
      last = ev
    end
    ev = ui.poll_event(0)
  end
  return last
end

local function finish(game, ok, score, need)
  local title = GAME_TITLE[game]
  local message
  if ok then
    message = "过关了！" .. title .. "拿到 " .. tostring(score) .. " 分。"
    device.vibrate(200)
  else
    message = title .. "还差一点点。这次 " .. tostring(score) .. " 分，过关要 " .. tostring(need) .. " 分。"
  end
  device.notify(message)
  local nextGame = "star"
  if ok then
    if game == "star" then nextGame = "dodge" else nextGame = "star" end
  else
    if game == "dodge" then nextGame = "star" else nextGame = "dodge" end
  end
  return {
    action = "deal",
    game = game,
    title = title,
    puzzleText = "在屏幕上玩：" .. title .. "，拿到 " .. tostring(need) .. " 分过关。点屏幕就能操作。",
    secret = "",
    correct = ok,
    message = message,
    briefing = "上一关是" .. title .. "，玩家" .. (ok and "过关了" or "没有过关")
      .. "，得分 " .. tostring(score) .. "。请选一款不同的小游戏，建议下一关选 " .. nextGame .. "。",
    stars = ok and 1 or 0,
  }
end

local function play_loop(limit_ms, step)
  local started = runtime.now_ms()
  local next_frame = started
  while not runtime.cancelled() do
    if runtime.now_ms() - started >= limit_ms then
      return "timeout"
    end
    local outcome = step()
    if outcome then return outcome end
    next_frame = next_frame + 33
    local now = runtime.now_ms()
    if next_frame < now then next_frame = now end
    runtime.sleep_until(next_frame)
  end
  return "cancel"
end

local function play_star(need, limit_ms)
  local width, height = ui.screen_size()
  local screen = ui.screen({ background = 0x0f172a })
  ui.label({ parent = screen, text = "接住小星星  过 3 分", x = 18, y = 16, color = 0xfacc15 })
  local score_label = ui.label({ parent = screen, text = "0 / " .. tostring(need), x = width - 120, y = 16, width = 100, color = 0xf8fafc })
  local hint = ui.label({ parent = screen, text = "星星落下来时点它", x = 18, y = 56, color = 0x93c5fd })
  local star_w, star_h = 48, 48
  local star = {
    x = math.floor(width * 0.4),
    y = 80,
    object = ui.rect({
      parent = screen, x = math.floor(width * 0.4), y = 80,
      width = star_w, height = star_h, color = 0xfacc15, radius = 24,
    }),
  }
  ui.load(screen)
  local score = 0
  local fall = height * 0.28
  local outcome = play_loop(limit_ms, function()
    local ev = drain_press()
    star.y = star.y + fall * 0.033
    if star.y > height - 80 then
      star.y = 70
      star.x = 24 + (runtime.now_ms() % math.max(1, width - 80))
    end
    ui.update(star.object, { x = math.floor(star.x), y = math.floor(star.y) })
    if ev then
      local px = tonumber(ev.x) or -1
      local py = tonumber(ev.y) or -1
      if px >= star.x - 12 and px <= star.x + star_w + 12 and py >= star.y - 12 and py <= star.y + star_h + 12 then
        score = score + 1
        ui.set_text(score_label, tostring(score) .. " / " .. tostring(need))
        star.y = 70
        star.x = 24 + ((runtime.now_ms() * 7) % math.max(1, width - 80))
        device.vibrate(80)
        if score >= need then
          ui.set_text(hint, "过关！")
          return "win"
        end
      end
    end
    return nil
  end)
  return finish("star", outcome == "win", score, need)
end

local function play_dodge(need, limit_ms)
  local width, height = ui.screen_size()
  local screen = ui.screen({ background = 0x111827 })
  local lane_w = math.floor(width / 2)
  local player_y = height - 150
  ui.label({ parent = screen, text = "左右躲障碍  过 4 分", x = 18, y = 16, color = 0xe5e7eb })
  local score_label = ui.label({ parent = screen, text = "0 / " .. tostring(need), x = width - 120, y = 16, width = 100, color = 0xe5e7eb })
  local hint = ui.label({ parent = screen, text = "按左或右换边", x = 18, y = 56, color = 0x93c5fd })
  ui.button({ parent = screen, text = "左", event_id = "left", x = 24, y = height - 70, width = 120, height = 48, color = 0x1d4ed8, text_color = 0xffffff, radius = 8 })
  ui.button({ parent = screen, text = "右", event_id = "right", x = width - 144, y = height - 70, width = 120, height = 48, color = 0xb45309, text_color = 0xffffff, radius = 8 })
  local lane = 0
  local player = ui.rect({
    parent = screen, x = math.floor(lane_w * 0.5 - 22), y = player_y,
    width = 44, height = 44, color = 0x22c55e, radius = 8,
  })
  local block = {
    lane = 1,
    y = 80,
    scored = false,
    object = ui.rect({
      parent = screen, x = math.floor(lane_w + lane_w * 0.5 - 22), y = 80,
      width = 44, height = 44, color = 0xef4444, radius = 6,
    }),
  }
  ui.load(screen)
  local score = 0
  local fall = height * 0.32
  local function place_player()
    local x = math.floor(lane * lane_w + lane_w * 0.5 - 22)
    ui.update(player, { x = x })
  end
  local function place_block()
    local x = math.floor(block.lane * lane_w + lane_w * 0.5 - 22)
    ui.update(block.object, { x = x, y = math.floor(block.y) })
  end
  local outcome = play_loop(limit_ms, function()
    local ev = drain_press()
    if ev then
      if ev.id == "left" then lane = 0 end
      if ev.id == "right" then lane = 1 end
      place_player()
    end
    block.y = block.y + fall * 0.033
    if block.y > player_y + 50 then
      if not block.scored then
        score = score + 1
        block.scored = true
        ui.set_text(score_label, tostring(score) .. " / " .. tostring(need))
        if score >= need then
          ui.set_text(hint, "过关！")
          return "win"
        end
      end
      block.y = 70
      block.lane = 1 - block.lane
      block.scored = false
    end
    place_block()
    if block.y + 40 > player_y and block.y < player_y + 44 and block.lane == lane then
      ui.update(player, { color = 0xb91c1c })
      ui.set_text(hint, "撞到了")
      return "lose"
    end
    return nil
  end)
  return finish("dodge", outcome == "win", score, need)
end

local function play(game, params)
  local need = GAME_NEED[game] or 3
  local limit = tonumber(params and params.timeout_ms) or 40000
  if limit < 2500 then limit = 2500 end
  if limit > 50000 then limit = 50000 end
  if game == "dodge" then return play_dodge(need, limit) end
  return play_star(need, limit)
end

function main(params)
  math.randomseed(runtime.now_ms())
  params = params or {}
  return play(normalize_game(params.game), params)
end
`,
    inputSchema: {
        type: "object" as const,
        properties: {
            game: {
                type: "string",
                title: "游戏",
                description: "star 或 dodge。也可以是带 game 字段的回传对象。",
            },
            timeout_ms: {
                type: "number",
                title: "游戏时限",
                description: "一局最长毫秒数，默认 40000。",
            },
        },
    },
    outputSchema: {
        type: "object" as const,
        properties: {
            action: { type: "string", title: "动作" },
            game: { type: "string", title: "游戏" },
            title: { type: "string", title: "关卡名称" },
            puzzleText: { type: "string", title: "题目" },
            secret: { type: "string", title: "标准答案" },
            correct: { type: "boolean", title: "是否过关" },
            message: { type: "string", title: "对玩家说的话" },
            briefing: { type: "string", title: "给小智的战绩" },
            stars: { type: "number", title: "星数" },
        },
    },
    testParams: { game: "star", timeout_ms: 2500 },
};

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

const LUA_OUTPUTS = {
    type: "object",
    properties: {
        action: { type: "string", title: "动作" },
        game: { type: "string", title: "游戏" },
        title: { type: "string", title: "关卡名称" },
        puzzleText: { type: "string", title: "题目" },
        secret: { type: "string", title: "标准答案" },
        correct: { type: "boolean", title: "是否过关" },
        message: { type: "string", title: "对玩家说的话" },
        briefing: { type: "string", title: "给小智的战绩" },
        stars: { type: "number", title: "星数" },
    },
};

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
                    game: { type: "string", title: "游戏" },
                    timeout_ms: { type: "number", title: "游戏时限" },
                },
            },
            inputsValues,
            outputs: LUA_OUTPUTS,
        },
    };
}

export function buildDecryptGameSchema(luaModuleId: string): Record<string, unknown> {
    const choose = {
        name: "game",
        title: "游戏",
        description: "star 或 dodge",
    };

    return {
        nodes: [
            {
                id: "start_0",
                type: "start",
                meta: { position: { x: 80, y: 200 } },
                data: {
                    title: "开始",
                    outputs: { type: "object", properties: {} },
                },
            },
            agentNode("agent_host", "请馆长开场", "小游戏馆长", AGENT_PROMPT_CHOOSE, constant(""), {
                x: 380,
                y: 160,
            }),
            webhookNode(
                "webhook_choose_1",
                "等待选关",
                "choose_puzzle",
                "邀请结束后立刻回传所选游戏。game 只能填 star 或 dodge。默认 star。",
                choose,
                60000,
                { x: 720, y: 140 },
            ),
            luaNode(
                "lua_deal_1",
                "玩游戏",
                luaModuleId,
                {
                    game: ref("webhook_choose_1", "data"),
                    timeout_ms: constant(40000),
                },
                { x: 1060, y: 40 },
            ),
            {
                id: "end_0",
                type: "end",
                meta: { position: { x: 1400, y: 160 } },
                data: {
                    title: "结束",
                    inputsValues: {
                        result: ref("lua_deal_1", "message"),
                    },
                    inputs: {
                        type: "object",
                        properties: {
                            result: { type: "string", title: "游戏结果" },
                        },
                    },
                },
            },
        ],
        edges: [
            { sourceNodeID: "start_0", targetNodeID: "agent_host" },
            { sourceNodeID: "agent_host", targetNodeID: "webhook_choose_1" },
            {
                sourceNodeID: "webhook_choose_1",
                targetNodeID: "lua_deal_1",
                sourcePortID: "received",
            },
            { sourceNodeID: "lua_deal_1", targetNodeID: "end_0" },
            {
                sourceNodeID: "webhook_choose_1",
                targetNodeID: "end_0",
                sourcePortID: "error",
            },
        ],
        globalVariable: { type: "object", required: [], properties: {} },
    };
}

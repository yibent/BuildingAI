/**
 * 应用工程模板。
 *
 * 小游戏馆：
 *   三款小游戏都在 CubeCat 屏幕上玩（点、跳、躲），玩完才返回结果；
 *   小智只负责主持，并根据玩家是否过关挑选下一关。
 */

export const DECRYPT_TEMPLATE_ID = "decrypt";

const AGENT_PROMPT_CHOOSE = `你是 CubeCat 小游戏馆馆长。说话简短、活泼，带一点鼓励。

馆里有三款要在设备屏幕上用手玩的小游戏，不要自己编规则或替小朋友玩：
1. dino：小恐龙跳一跳，跳过障碍拿到 2 分就过关
2. star：点掉天上掉下来的星星，接到 3 颗过关
3. dodge：按左/右躲开障碍，躲开 4 次过关

现在请邀请小朋友开始玩。第一关默认选 dino，除非小朋友点名要更难的。`;

const AGENT_PROMPT_ADAPT = `你是 CubeCat 小游戏馆馆长。上一关已经由设备上的小游戏判定完毕。

根据工作流触发信息里的战绩，挑选下一款「不同的」小游戏：
- 过关了：升一档（dino→star→dodge）
- 没过关：换一款更简单或同级的，不要重复上一关

选好后立刻回传。game 只能填 dino、star 或 dodge。
不要宣布下一关的通关条件之外的内容。`;

export const DECRYPT_TEMPLATE_LUA = {
    name: "小游戏馆",
    description: "在 CubeCat 屏幕上玩三款可交互小游戏：恐龙跳跃、接星星、左右躲避。",
    draftCode: `-- 小游戏馆：三款要在屏幕上动手玩的关卡，玩完才返回
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

local function announce(text)
  alert.show(text)
  local ms = 400 + #text * 40
  if ms > 2500 then ms = 2500 end
  runtime.sleep(ms)
end

local function normalize_game(value)
  local text = string.lower(field_text(value, "game"))
  if string.find(text, "star") or string.find(text, "星星") or string.find(text, "lock") or string.find(text, "锁") then
    return "star"
  end
  if string.find(text, "dodge") or string.find(text, "躲") or string.find(text, "trail") or string.find(text, "暗号") then
    return "dodge"
  end
  return "dino"
end

local function normalize_action(value)
  local text = string.lower(field_text(value, "action"))
  if string.find(text, "announce") or string.find(text, "播报") or string.find(text, "提示") then
    return "announce"
  end
  return "deal"
end

local GAME_TITLE = {
  dino = "小恐龙跳一跳",
  star = "接住小星星",
  dodge = "左右躲障碍",
}
local GAME_NEED = { dino = 2, star = 3, dodge = 4 }

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
  announce(message)
  local nextGame = "dino"
  if ok then
    if game == "dino" then nextGame = "star" else nextGame = "dodge" end
  else
    if game == "dodge" then nextGame = "star" else nextGame = "dino" end
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

local function play_dino(need, limit_ms)
  local width, height = ui.screen_size()
  local screen = ui.screen({ background = 0xf7f3e8 })
  local ground_y = math.floor(height * 0.72)
  local dino_w, dino_h = 36, 48
  local dino_x = math.floor(width * 0.16)
  ui.rect({ parent = screen, x = 0, y = ground_y, width = width, height = 4, color = 0x5b4636 })
  ui.label({ parent = screen, text = "小恐龙跳一跳  过 2 分", x = 18, y = 16, color = 0x5b4636 })
  local score_label = ui.label({ parent = screen, text = "0 / " .. tostring(need), x = width - 120, y = 16, width = 100, color = 0x5b4636 })
  local hint = ui.label({ parent = screen, text = "点屏幕跳跃", x = 18, y = 56, color = 0xb45309 })
  local dino = ui.rect({
    parent = screen, x = dino_x, y = ground_y - dino_h,
    width = dino_w, height = dino_h, color = 0x365314, radius = 6,
  })
  local cactus_h = 44
  local cactus = {
    x = width + 40,
    width = 22,
    height = cactus_h,
    scored = false,
    object = ui.rect({
      parent = screen, x = width + 40, y = ground_y - cactus_h,
      width = 22, height = cactus_h, color = 0x166534, radius = 3,
    }),
  }
  ui.load(screen)
  local dino_y = ground_y - dino_h
  local vy = 0
  local score = 0
  local gravity = height * 2.6
  local jump_v = -height * 1.05
  local speed = width * 0.42
  local dead = false
  local outcome = play_loop(limit_ms, function()
    local ev = drain_press()
    if ev and not dead and dino_y >= ground_y - dino_h - 1 then
      vy = jump_v
    end
    if dead then return nil end
    local dt = 0.033
    vy = vy + gravity * dt
    dino_y = dino_y + vy * dt
    if dino_y >= ground_y - dino_h then
      dino_y = ground_y - dino_h
      vy = 0
    end
    ui.update(dino, { y = math.floor(dino_y) })
    cactus.x = cactus.x - speed * dt
    if cactus.x + cactus.width < 0 then
      cactus.x = width + 30
      cactus.scored = false
    end
    ui.update(cactus.object, { x = math.floor(cactus.x) })
    local hit = dino_x + dino_w - 6 > cactus.x
      and dino_x + 6 < cactus.x + cactus.width
      and dino_y + dino_h - 4 > ground_y - cactus.height
    if hit then
      dead = true
      ui.update(dino, { color = 0xb91c1c })
      ui.set_text(hint, "撞到了")
      return "lose"
    end
    if not cactus.scored and cactus.x + cactus.width < dino_x then
      cactus.scored = true
      score = score + 1
      ui.set_text(score_label, tostring(score) .. " / " .. tostring(need))
      if score >= need then
        ui.set_text(hint, "过关！")
        return "win"
      end
    end
    return nil
  end)
  return finish("dino", outcome == "win", score, need)
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
  local need = GAME_NEED[game] or 2
  local limit = tonumber(params and params.timeout_ms) or 40000
  if limit < 2500 then limit = 2500 end
  if limit > 50000 then limit = 50000 end
  alert.show("开始：" .. GAME_TITLE[game] .. "，过关要 " .. tostring(need) .. " 分")
  runtime.sleep(700)
  if game == "star" then return play_star(need, limit) end
  if game == "dodge" then return play_dodge(need, limit) end
  return play_dino(need, limit)
end

function main(params)
  math.randomseed(runtime.now_ms())
  params = params or {}
  local action = normalize_action(params.action)
  if action == "announce" then
    local text = field_text(params.message, "message")
    if text ~= "" then
      device.notify(text)
      announce(text)
    end
    return {
      action = "announce",
      game = "",
      title = "",
      puzzleText = "",
      secret = "",
      correct = false,
      message = text,
      briefing = "",
      stars = 0,
    }
  end
  return play(normalize_game(params.game), params)
end
`,
    inputSchema: {
        type: "object" as const,
        properties: {
            action: {
                type: "string",
                title: "动作",
                description: "deal 开始一局屏幕小游戏，announce 屏幕播报提示。",
            },
            game: {
                type: "string",
                title: "游戏",
                description: "dino、star 或 dodge。也可以是带 game 字段的回传对象。",
            },
            message: {
                type: "string",
                title: "播报文字",
                description: "announce 时显示在 CubeCat 上的提示。",
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
    testParams: { action: "deal", game: "dino", timeout_ms: 2500 },
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
                    action: { type: "string", title: "动作" },
                    game: { type: "string", title: "游戏" },
                    message: { type: "string", title: "播报文字" },
                    timeout_ms: { type: "number", title: "游戏时限" },
                },
            },
            inputsValues,
            outputs: LUA_OUTPUTS,
        },
    };
}

function announceNode(
    id: string,
    title: string,
    luaModuleId: string,
    text: string,
    position: { x: number; y: number },
) {
    return luaNode(
        id,
        title,
        luaModuleId,
        {
            action: constant("announce"),
            message: constant(text),
        },
        position,
    );
}

export function buildDecryptGameSchema(luaModuleId: string): Record<string, unknown> {
    const choose = {
        name: "game",
        title: "游戏",
        description: "dino、star 或 dodge",
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
            announceNode(
                "lua_intro",
                "欢迎进馆",
                luaModuleId,
                "欢迎来到小游戏馆。请对着我说：想玩小恐龙、接星星，还是躲障碍。",
                { x: 720, y: 160 },
            ),
            webhookNode(
                "webhook_choose_1",
                "等待选第一关",
                "choose_puzzle",
                "邀请结束后立刻回传所选游戏。game 只能填 dino、star 或 dodge。第一关默认 dino。",
                choose,
                60000,
                { x: 1060, y: 140 },
            ),
            luaNode(
                "lua_deal_1",
                "玩第一关",
                luaModuleId,
                {
                    action: constant("deal"),
                    game: ref("webhook_choose_1", "data"),
                    timeout_ms: constant(40000),
                },
                { x: 1420, y: 40 },
            ),
            agentNode(
                "agent_adapt",
                "请馆长选下一关",
                "动态选关",
                AGENT_PROMPT_ADAPT,
                ref("lua_deal_1", "briefing"),
                { x: 1760, y: 160 },
            ),
            webhookNode(
                "webhook_choose_2",
                "等待选第二关",
                "choose_puzzle",
                "根据上一关战绩挑选下一款不同的小游戏后立刻回传。game 只能填 dino、star 或 dodge。",
                choose,
                45000,
                { x: 2100, y: 140 },
            ),
            luaNode(
                "lua_deal_2",
                "玩第二关",
                luaModuleId,
                {
                    action: constant("deal"),
                    game: ref("webhook_choose_2", "data"),
                    timeout_ms: constant(40000),
                },
                { x: 2440, y: 40 },
            ),
            announceNode(
                "lua_bye",
                "今天关门",
                luaModuleId,
                "小游戏馆今天先到这里。你已经完成探险，下次再来挑战新的关卡。",
                { x: 2780, y: 160 },
            ),
            announceNode(
                "lua_idle",
                "没有开始",
                luaModuleId,
                "馆长等了一会儿，没等到选关。今天先不开门啦。",
                { x: 1060, y: 480 },
            ),
            {
                id: "end_0",
                type: "end",
                meta: { position: { x: 3120, y: 160 } },
                data: {
                    title: "结束",
                    inputsValues: {
                        round1: ref("lua_deal_1", "message"),
                        round2: ref("lua_deal_2", "message"),
                    },
                    inputs: {
                        type: "object",
                        properties: {
                            round1: { type: "string", title: "第一关" },
                            round2: { type: "string", title: "第二关" },
                        },
                    },
                },
            },
        ],
        edges: [
            { sourceNodeID: "start_0", targetNodeID: "agent_host" },
            { sourceNodeID: "agent_host", targetNodeID: "lua_intro" },
            { sourceNodeID: "lua_intro", targetNodeID: "webhook_choose_1" },
            {
                sourceNodeID: "webhook_choose_1",
                targetNodeID: "lua_deal_1",
                sourcePortID: "received",
            },
            { sourceNodeID: "lua_deal_1", targetNodeID: "agent_adapt" },
            { sourceNodeID: "agent_adapt", targetNodeID: "webhook_choose_2" },
            {
                sourceNodeID: "webhook_choose_2",
                targetNodeID: "lua_deal_2",
                sourcePortID: "received",
            },
            { sourceNodeID: "lua_deal_2", targetNodeID: "lua_bye" },
            { sourceNodeID: "lua_bye", targetNodeID: "end_0" },
            {
                sourceNodeID: "webhook_choose_1",
                targetNodeID: "lua_idle",
                sourcePortID: "error",
            },
            { sourceNodeID: "lua_idle", targetNodeID: "end_0" },
            {
                sourceNodeID: "webhook_choose_2",
                targetNodeID: "lua_bye",
                sourcePortID: "error",
            },
        ],
        globalVariable: { type: "object", required: [], properties: {} },
    };
}

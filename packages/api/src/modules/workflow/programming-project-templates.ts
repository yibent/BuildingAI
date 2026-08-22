/**
 * 应用工程模板。
 *
 * 解密馆：
 *   Lua 在 CubeCat 上出题、展示、判定（三款不同小游戏）；
 *   小智只负责主持，并根据玩家是否解开，挑选下一关的游戏。
 */

export const DECRYPT_TEMPLATE_ID = "decrypt";

const AGENT_PROMPT_CHOOSE = `你是 CubeCat 解密馆馆长。说话简短、神秘，带一点鼓励。

馆里有三款由程序出题的小游戏，不要自己出题或判对错：
1. caesar：移位密码，入门
2. lock：线索密码锁，进阶
3. trail：两步暗号，高难

现在请邀请小朋友开始探险。第一关默认选 caesar，除非小朋友点名要更难的。`;

const AGENT_PROMPT_LISTEN = `你是 CubeCat 解密馆馆长。题目已经由程序在设备屏幕上公布。

不要公布或编造答案。听小朋友说出答案后立刻回传。
- 移位密码：answer 填三个大写英文字母，例如 CAT
- 数字类关卡：answer 只填阿拉伯数字，例如 124
如果听不清，请再问一次，确认后再回传。`;

const AGENT_PROMPT_ADAPT = `你是 CubeCat 解密馆馆长。上一关已经由程序判定完毕。

根据工作流触发信息里的战绩，挑选下一款「不同的」小游戏：
- 解开了：升一档难度（caesar→lock→trail）
- 没解开：换一款更简单或同级的，不要重复上一关

选好后立刻回传。game 只能填 caesar、lock 或 trail。
不要自己出题，不要宣布下一题的答案。`;

export const DECRYPT_TEMPLATE_LUA = {
    name: "解密馆",
    description: "按所选游戏出题，并在 CubeCat 上展示、播报和判定答案。",
    draftCode: `-- 解密馆：三款小游戏都在这里出题和判定，不负责听人说话
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
  local ms = 400 + #text * 80
  if ms > 8000 then ms = 8000 end
  runtime.sleep(ms)
end

local function present(title, body)
  local screen = ui.screen({ background = 0x101820 })
  local width = 432
  if ui.screen_size then
    local screen_w = ui.screen_size()
    if type(screen_w) == "number" and screen_w > 48 then
      width = screen_w - 48
    end
  end
  ui.label({
    parent = screen,
    x = 24,
    y = 32,
    width = width,
    text = tostring(title),
    color = 0xF5C14A,
  })
  ui.label({
    parent = screen,
    x = 24,
    y = 96,
    width = width,
    text = tostring(body),
    color = 0xFFFFFF,
  })
  ui.load(screen)
  device.notify(title)
  announce(title .. "。" .. body)
end

local function pick(list)
  return list[math.random(#list)]
end

local function shift_letter(ch, n)
  local b = string.byte(ch)
  if b >= 65 and b <= 90 then
    return string.char((b - 65 + n) % 26 + 65)
  end
  return ch
end

local function caesar_encode(word, n)
  local out = {}
  for i = 1, #word do
    out[i] = shift_letter(string.sub(word, i, i), n)
  end
  return table.concat(out)
end

local function only_digits(text)
  return (string.gsub(text, "[^0-9]", ""))
end

local function normalize_game(value)
  local text = string.lower(field_text(value, "game"))
  if string.find(text, "trail") or string.find(text, "暗号") or string.find(text, "两步") then
    return "trail"
  end
  if string.find(text, "lock") or string.find(text, "锁") then
    return "lock"
  end
  if string.find(text, "caesar") or string.find(text, "shift") or string.find(text, "移位") then
    return "caesar"
  end
  return "caesar"
end

local function normalize_action(value)
  local text = string.lower(field_text(value, "action"))
  if string.find(text, "announce") or string.find(text, "播报") or string.find(text, "提示") then
    return "announce"
  end
  if string.find(text, "judge") or string.find(text, "判") then
    return "judge"
  end
  return "deal"
end

local CAESAR_WORDS = { "CAT", "DOG", "SUN", "BED", "CUP", "HAT", "PEN", "MAP" }

local LOCKS = {
  { secret = "124", clue = "百位是最小的正整数，十位是一加一，个位是二的两倍。" },
  { secret = "268", clue = "百位是最小的质数，十位是三的两倍，个位是四的两倍。" },
  { secret = "359", clue = "百位是二加一，十位是二加三，个位是三的三倍。" },
}

local TRAILS = {
  { secret = "17", clue = "先算 3 加 5，得到幸运数。再把幸运数乘 2，最后加 1。密码是几？" },
  { secret = "13", clue = "先算 4 加 2，得到暗号。再把暗号乘 2，最后加 1。密码是几？" },
  { secret = "21", clue = "先算 5 加 5，得到暗号。再把暗号乘 2，最后加 1。密码是几？" },
}

local GAME_TITLE = {
  caesar = "第一档 移位密码",
  lock = "第二档 线索密码锁",
  trail = "第三档 两步暗号",
}

local function deal_caesar()
  local word = pick(CAESAR_WORDS)
  local cipher = caesar_encode(word, 1)
  return {
    secret = word,
    puzzleText = "每个字母在字母表里往后跳 1 位。密文是 " .. cipher .. "，原文是什么？请说出三个字母。",
  }
end

local function deal_lock()
  local item = pick(LOCKS)
  return {
    secret = item.secret,
    puzzleText = "这是一把三位数字锁。" .. item.clue .. "请按百位、十位、个位的顺序说出密码。",
  }
end

local function deal_trail()
  local item = pick(TRAILS)
  return {
    secret = item.secret,
    puzzleText = item.clue,
  }
end

local function suggest_next(game, correct)
  if correct then
    if game == "caesar" then return "lock" end
    return "trail"
  end
  if game == "trail" then return "lock" end
  return "caesar"
end

local function deal(game)
  local puzzle
  if game == "lock" then
    puzzle = deal_lock()
  elseif game == "trail" then
    puzzle = deal_trail()
  else
    game = "caesar"
    puzzle = deal_caesar()
  end
  local title = GAME_TITLE[game]
  present(title, puzzle.puzzleText)
  return {
    action = "deal",
    game = game,
    title = title,
    puzzleText = puzzle.puzzleText,
    secret = puzzle.secret,
    correct = false,
    message = title .. "已经出题。",
    briefing = "",
    stars = 0,
  }
end

local function answers_match(game, secret, answer)
  local expected = string.upper(tostring(secret or ""))
  local got = string.upper(tostring(answer or ""))
  got = string.gsub(got, "%s+", "")
  if game == "lock" or game == "trail" then
    expected = only_digits(expected)
    got = only_digits(got)
  end
  return expected ~= "" and got == expected
end

local function judge(game, secret, answer)
  local ok = answers_match(game, secret, answer)
  local title = GAME_TITLE[game] or "解密"
  local message
  if ok then
    message = "暗号正确！你解开了" .. title .. "。"
    device.vibrate(240)
  else
    message = "这道暗号还没解开。正确答案稍后由馆长带着你看下一关。"
  end
  device.notify(message)
  announce(message)
  local nextGame = suggest_next(game, ok)
  local briefing = "上一关是" .. title .. "，玩家" .. (ok and "解开了" or "没有解开")
    .. "。请选一款不同的小游戏，建议下一关选 " .. nextGame .. "。"
  return {
    action = "judge",
    game = game,
    title = title,
    puzzleText = "",
    secret = secret,
    correct = ok,
    message = message,
    briefing = briefing,
    stars = ok and 1 or 0,
  }
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
  local game = normalize_game(params.game)
  if action == "judge" then
    return judge(game, field_text(params.secret, "secret"), field_text(params.answer, "answer"))
  end
  return deal(game)
end
`,
    inputSchema: {
        type: "object" as const,
        properties: {
            action: {
                type: "string",
                title: "动作",
                description: "deal 出题，judge 判定，announce 屏幕播报提示。",
            },
            game: {
                type: "string",
                title: "游戏",
                description: "caesar、lock 或 trail。也可以是带 game 字段的回传对象。",
            },
            secret: {
                type: "string",
                title: "标准答案",
                description: "判定时使用，出题时不用填。",
            },
            answer: {
                type: "string",
                title: "玩家答案",
                description: "判定时使用。也可以是带 answer 字段的回传对象。",
            },
            message: {
                type: "string",
                title: "播报文字",
                description: "announce 时显示在 CubeCat 上的提示。",
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
            correct: { type: "boolean", title: "是否解开" },
            message: { type: "string", title: "对玩家说的话" },
            briefing: { type: "string", title: "给小智的战绩" },
            stars: { type: "number", title: "星数" },
        },
    },
    testParams: { action: "deal", game: "caesar" },
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
        correct: { type: "boolean", title: "是否解开" },
        message: { type: "string", title: "对玩家说的话" },
        briefing: { type: "string", title: "给小智的战绩" },
        stars: { type: "number", title: "星数" },
    },
};

function constant(content: string) {
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
                    secret: { type: "string", title: "标准答案" },
                    answer: { type: "string", title: "玩家答案" },
                    message: { type: "string", title: "播报文字" },
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
        description: "caesar、lock 或 trail",
    };
    const answer = {
        name: "answer",
        title: "答案",
        description: "玩家说出的原文",
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
            agentNode("agent_host", "请馆长开场", "解密馆长", AGENT_PROMPT_CHOOSE, constant(""), {
                x: 380,
                y: 160,
            }),
            announceNode(
                "lua_intro",
                "欢迎进馆",
                luaModuleId,
                "欢迎来到解密馆。请对着我说：想玩移位密码、密码锁，还是两步暗号。",
                { x: 720, y: 160 },
            ),
            webhookNode(
                "webhook_choose_1",
                "等待选第一关",
                "choose_puzzle",
                "邀请结束后立刻回传所选游戏。game 只能填 caesar、lock 或 trail。第一关默认 caesar，除非小朋友点名要更难的。",
                choose,
                60000,
                { x: 1060, y: 140 },
            ),
            luaNode(
                "lua_deal_1",
                "出第一题",
                luaModuleId,
                {
                    action: constant("deal"),
                    game: ref("webhook_choose_1", "data"),
                },
                { x: 1420, y: 40 },
            ),
            agentNode(
                "agent_listen_1",
                "请馆长收答案",
                "收听答案",
                AGENT_PROMPT_LISTEN,
                ref("lua_deal_1", "puzzleText"),
                { x: 1760, y: 160 },
            ),
            webhookNode(
                "webhook_answer_1",
                "等待第一关答案",
                "submit_answer",
                "听清答案后立刻回传。移位密码填三个大写字母，数字关只填阿拉伯数字。",
                answer,
                90000,
                { x: 2100, y: 140 },
            ),
            luaNode(
                "lua_judge_1",
                "判定第一关",
                luaModuleId,
                {
                    action: constant("judge"),
                    game: ref("lua_deal_1", "game"),
                    secret: ref("lua_deal_1", "secret"),
                    answer: ref("webhook_answer_1", "data"),
                },
                { x: 2460, y: 40 },
            ),
            agentNode(
                "agent_adapt",
                "请馆长选下一关",
                "动态选关",
                AGENT_PROMPT_ADAPT,
                ref("lua_judge_1", "briefing"),
                { x: 2460, y: 560 },
            ),
            webhookNode(
                "webhook_choose_2",
                "等待选第二关",
                "choose_puzzle",
                "根据上一关战绩挑选下一款不同的小游戏后立刻回传。game 只能填 caesar、lock 或 trail。",
                choose,
                45000,
                { x: 2820, y: 540 },
            ),
            luaNode(
                "lua_deal_2",
                "出第二题",
                luaModuleId,
                {
                    action: constant("deal"),
                    game: ref("webhook_choose_2", "data"),
                },
                { x: 3180, y: 440 },
            ),
            agentNode(
                "agent_listen_2",
                "请馆长再收答案",
                "收听答案",
                AGENT_PROMPT_LISTEN,
                ref("lua_deal_2", "puzzleText"),
                { x: 3540, y: 560 },
            ),
            webhookNode(
                "webhook_answer_2",
                "等待第二关答案",
                "submit_answer",
                "听清第二关答案后立刻回传。",
                answer,
                90000,
                { x: 3900, y: 540 },
            ),
            luaNode(
                "lua_judge_2",
                "判定第二关",
                luaModuleId,
                {
                    action: constant("judge"),
                    game: ref("lua_deal_2", "game"),
                    secret: ref("lua_deal_2", "secret"),
                    answer: ref("webhook_answer_2", "data"),
                },
                { x: 4260, y: 440 },
            ),
            announceNode(
                "lua_bye",
                "今天关门",
                luaModuleId,
                "解密馆今天先到这里。你已经完成探险，下次再来挑战新的暗号。",
                { x: 4620, y: 560 },
            ),
            announceNode(
                "lua_idle",
                "没有开始",
                luaModuleId,
                "馆长等了一会儿，没等到选关。今天先不开门啦。",
                { x: 1060, y: 900 },
            ),
            announceNode(
                "lua_no_answer",
                "没有听到答案",
                luaModuleId,
                "我等了好久都没听到答案，这一关先记作未解开。",
                { x: 2100, y: 900 },
            ),
            {
                id: "end_0",
                type: "end",
                meta: { position: { x: 4980, y: 560 } },
                data: {
                    title: "结束",
                    inputsValues: {
                        round1: ref("lua_judge_1", "message"),
                        round2: ref("lua_judge_2", "message"),
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
            { sourceNodeID: "lua_deal_1", targetNodeID: "agent_listen_1" },
            { sourceNodeID: "agent_listen_1", targetNodeID: "webhook_answer_1" },
            {
                sourceNodeID: "webhook_answer_1",
                targetNodeID: "lua_judge_1",
                sourcePortID: "received",
            },
            { sourceNodeID: "lua_judge_1", targetNodeID: "agent_adapt" },
            { sourceNodeID: "agent_adapt", targetNodeID: "webhook_choose_2" },
            {
                sourceNodeID: "webhook_choose_2",
                targetNodeID: "lua_deal_2",
                sourcePortID: "received",
            },
            { sourceNodeID: "lua_deal_2", targetNodeID: "agent_listen_2" },
            { sourceNodeID: "agent_listen_2", targetNodeID: "webhook_answer_2" },
            {
                sourceNodeID: "webhook_answer_2",
                targetNodeID: "lua_judge_2",
                sourcePortID: "received",
            },
            { sourceNodeID: "lua_judge_2", targetNodeID: "lua_bye" },
            { sourceNodeID: "lua_bye", targetNodeID: "end_0" },
            {
                sourceNodeID: "webhook_choose_1",
                targetNodeID: "lua_idle",
                sourcePortID: "error",
            },
            { sourceNodeID: "lua_idle", targetNodeID: "end_0" },
            {
                sourceNodeID: "webhook_answer_1",
                targetNodeID: "lua_no_answer",
                sourcePortID: "error",
            },
            {
                sourceNodeID: "webhook_answer_2",
                targetNodeID: "lua_no_answer",
                sourcePortID: "error",
            },
            { sourceNodeID: "lua_no_answer", targetNodeID: "end_0" },
            {
                sourceNodeID: "webhook_choose_2",
                targetNodeID: "lua_bye",
                sourcePortID: "error",
            },
        ],
        globalVariable: { type: "object", required: [], properties: {} },
    };
}

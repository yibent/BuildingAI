/** Headless Claw4 Lua modules for the server-side wasmoon worker. */
export const CLAW4_SIM_PRELUDE = `
io = nil
os = nil
package = nil
dofile = nil
loadfile = nil
load = nil
debug = nil
collectgarbage = nil

local __device_operations = {}
local __virtual_now = 0
local __modules = {}
local SCREEN_W = 480 -- 宽
local SCREEN_H = 800 -- 高

local function clamp(value, min_value, max_value)
    if value < min_value then return min_value end
    if value > max_value then return max_value end
    return value
end

local function append_device_operation(action, args)
    table.insert(__device_operations, { action = action, args = args })
end

function require(name)
    local loaded = __modules[name]
    if type(loaded) == "table" then return loaded end
    if type(loaded) == "function" then
        loaded = loaded()
        __modules[name] = loaded
        return loaded
    end
    error("module '" .. tostring(name) .. "' not found")
end

local function register(name, factory)
    __modules[name] = factory
end

register("runtime", function()
    return {
        now_ms = function()
            return __virtual_now
        end,
        sleep = function(ms)
            __virtual_now = __virtual_now + math.max(0, math.floor(tonumber(ms) or 0))
        end,
        sleep_until = function(deadline)
            local target = math.floor(tonumber(deadline) or 0)
            if target > __virtual_now then __virtual_now = target end
        end,
        cancelled = function()
            return false
        end,
    }
end)

register("device", function()
    return {
        set_brightness = function(value)
            append_device_operation("set_brightness", { value = clamp(math.floor(tonumber(value) or 0), 0, 100) })
        end,
        set_volume = function(value)
            append_device_operation("set_volume", { value = clamp(math.floor(tonumber(value) or 0), 0, 100) })
        end,
        vibrate = function(ms)
            local duration = tonumber(ms) or 300
            if duration < 0 then duration = 0 end
            if duration > 5000 then duration = 5000 end
            append_device_operation("vibrate", { durationMs = math.floor(duration) })
        end,
        notify = function(text)
            append_device_operation("notify", { text = tostring(text or "") })
        end,
    }
end)

register("alert", function()
    return {
        show = function(text)
            append_device_operation("alert_show", { text = tostring(text or "") })
        end,
    }
end)

register("speech", function()
    error('require("speech") 已移除。屏幕提示用 require("alert") 的 alert.show；合成语音走工作流「语音播报」节点，不要在 Lua 里朗读')
end)

register("camera", function()
    return {
        explain = function(question)
            local q = tostring(question or "描述这张图片")
            local answer = "仿真摄像头：没有真实画面。问题是：" .. q
            append_device_operation("camera_explain", { question = q, answer = answer })
            return answer
        end,
        capture = function(question)
            return require("camera").explain(question)
        end,
    }
end)

register("audio", function()
    local next_handle = 1
    local playing = {}
    return {
        play = function(source, opts)
            opts = opts or {}
            local handle = next_handle
            next_handle = next_handle + 1
            playing[handle] = true
            append_device_operation("audio_play", {
                source = tostring(source or ""),
                volume = opts.volume or 80,
                loop = opts.loop == true,
                handle = handle,
            })
            return handle
        end,
        play_bytes = function(_, opts)
            opts = opts or {}
            local handle = next_handle
            next_handle = next_handle + 1
            playing[handle] = true
            append_device_operation("audio_play_bytes", {
                volume = opts.volume or 80,
                loop = opts.loop == true,
                handle = handle,
            })
            return handle
        end,
        stop = function(handle)
            playing[handle] = nil
            append_device_operation("audio_stop", { handle = handle })
        end,
        stop_all = function()
            playing = {}
            append_device_operation("audio_stop_all", {})
        end,
        is_playing = function(handle)
            return playing[handle] == true
        end,
    }
end)

register("http", function()
    local function mock_response(method, url)
        append_device_operation("http_request", { method = method, url = tostring(url or "") })
        return {
            status = 200,
            body = '{"ok":true,"simulated":true}',
            headers = { ["content-type"] = "application/json" },
        }
    end
    return {
        request = function(opts)
            opts = opts or {}
            return mock_response(string.upper(tostring(opts.method or "GET")), opts.url)
        end,
        get = function(url)
            return mock_response("GET", url)
        end,
        post = function(url)
            return mock_response("POST", url)
        end,
    }
end)

register("uart", function()
    return {
        open = function()
            error("uart is not registered on this CubeCat board")
        end,
    }
end)

register("ui", function()
    local objects = {}
    local next_id = 1
    local screen_id = nil
    local object_count = 0

    local function find(id)
        return objects[id]
    end

    local function add_object(type_name, props)
        if object_count >= 64 then error("ui object limit reached") end
        local id = next_id
        next_id = next_id + 1
        object_count = object_count + 1
        objects[id] = { id = id, type = type_name, props = props or {} }
        return id
    end

    local function opts_table(a, b)
        if type(a) == "table" and b == nil then return a end
        if type(a) == "number" and type(b) == "table" then
            if b.parent == nil then b.parent = a end
            return b
        end
        error("ui widget expects a table, or (parent, table)")
    end

    return {
        screen = function(opts)
            opts = opts or {}
            if screen_id then error("a Lua VM can own only one screen") end
            screen_id = add_object("screen", opts)
            return screen_id
        end,
        screen_size = function()
            return SCREEN_W, SCREEN_H
        end,
        load = function(id)
            if not find(id or screen_id) then error("invalid screen") end
        end,
        label = function(a, b)
            return add_object("label", opts_table(a, b))
        end,
        button = function(a, b)
            return add_object("button", opts_table(a, b))
        end,
        rect = function(a, b)
            return add_object("rect", opts_table(a, b))
        end,
        circle = function(a, b)
            return add_object("circle", opts_table(a, b))
        end,
        line = function(a, b)
            return add_object("line", opts_table(a, b))
        end,
        arc = function(a, b)
            return add_object("arc", opts_table(a, b))
        end,
        image = function(a, b)
            return add_object("image", opts_table(a, b))
        end,
        set_text = function(id, text)
            local entry = find(id)
            if not entry or entry.type ~= "label" then error("object is not a label") end
            entry.props.text = tostring(text or "")
        end,
        update = function(id, opts)
            if id == nil then return end
            local entry = find(id)
            if not entry then error("invalid UI object") end
            if type(opts) ~= "table" then error("ui.update expects (object, options)") end
            for key, value in pairs(opts) do
                entry.props[key] = value
            end
        end,
        delete = function(id)
            local entry = find(id)
            if not entry then error("invalid UI object") end
            if entry.type == "screen" then error("the owned screen cannot be deleted") end
            objects[id] = nil
            object_count = object_count - 1
        end,
        poll_event = function(timeout_ms)
            require("runtime").sleep(tonumber(timeout_ms) or 0)
            return nil
        end,
    }
end)
`;

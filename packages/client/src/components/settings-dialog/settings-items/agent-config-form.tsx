import type {
  XiaozhiAgentConfig,
  XiaozhiAgentEditorData,
} from "@buildingai/services/web";
import { Button } from "@buildingai/ui/components/ui/button";
import { Input } from "@buildingai/ui/components/ui/input";
import { Label } from "@buildingai/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@buildingai/ui/components/ui/select";
import { Switch } from "@buildingai/ui/components/ui/switch";
import { Textarea } from "@buildingai/ui/components/ui/textarea";
import { Lock, LockOpen } from "lucide-react";
import { useMemo } from "react";

export type Speed = "slow" | "normal" | "fast";

export type EditorForm = {
  language: string;
  ttsVoice: string;
  customCharacter: boolean;
  character: string;
  asrSpeed: Speed;
  ttsSpeechSpeed: Speed;
  ttsPitch: number;
  llmModel: string;
  memoryType: "OFF" | "SHORT_TERM" | "LONG_TERM";
  teenMode: boolean;
  mcpEndpoints: string[];
  knowledgeBaseId: string;
};

export const SPEED_LABELS: Record<Speed, string> = {
  slow: "慢速",
  normal: "正常",
  fast: "快速",
};

export const MEMORY_LABELS: Record<EditorForm["memoryType"], string> = {
  OFF: "关闭记忆",
  SHORT_TERM: "短期记忆",
  LONG_TERM: "长期记忆",
};

/** Upstream stores list-valued config either as a JSON string or a real array. */
export function storedList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function toSpeed(value: unknown): Speed {
  return value === "slow" || value === "fast" ? value : "normal";
}

export function configToForm(
  config: XiaozhiAgentConfig,
  resources: XiaozhiAgentEditorData,
): EditorForm {
  const languages = resources.ttsList.languages;
  const language =
    config.language && languages.includes(config.language)
      ? config.language
      : languages.includes("zh")
        ? "zh"
        : languages[0] || "";
  const voices = resources.ttsList.ttsVoices[language] || [];
  const character = typeof config.character === "string" ? config.character.trim() : "";

  return {
    language,
    ttsVoice: voices.some((voice) => voice.voice_id === config.tts_voice)
      ? config.tts_voice || ""
      : voices[0]?.voice_id || "",
    customCharacter: Boolean(character),
    character,
    asrSpeed: toSpeed(config.asr_speed),
    ttsSpeechSpeed: toSpeed(config.tts_speech_speed),
    ttsPitch: Math.min(3, Math.max(-3, Number(config.tts_pitch) || 0)),
    llmModel: config.llm_model || resources.models[0]?.name || "",
    memoryType:
      config.memory_type === "SHORT_TERM" || config.memory_type === "LONG_TERM"
        ? config.memory_type
        : "OFF",
    teenMode: config.teen_mode === true || config.teen_mode === 1 || config.teen_mode === "1",
    mcpEndpoints: storedList(config.mcp_endpoints),
    knowledgeBaseId: storedList(config.knowledge_base_ids)[0] || "",
  };
}

/** Validate the form; returns an error message or null when it is complete. */
export function validateForm(form: EditorForm): string | null {
  if (!form.language || !form.ttsVoice) return "请选择对话语言和角色音色";
  if (form.customCharacter && !form.character.trim()) {
    return "启用自定义角色后，角色设定不能为空";
  }
  if (!form.llmModel) return "请选择语言模型";
  return null;
}

/** Build the upstream config payload the API expects from the form state. */
export function formToConfig(
  form: EditorForm,
  resources: XiaozhiAgentEditorData,
): Record<string, unknown> {
  return {
    language: form.language,
    tts_voice: form.ttsVoice,
    character: form.customCharacter ? form.character.trim() : null,
    asr_speed: form.asrSpeed,
    tts_speech_speed: form.ttsSpeechSpeed,
    tts_pitch: form.ttsPitch,
    llm_model: form.llmModel,
    memory_type: form.memoryType,
    teen_mode: form.teenMode,
    mcp_endpoints: resources.mcpTools
      .filter((tool) => form.mcpEndpoints.includes(String(tool.endpoint_id)))
      .map((tool) => tool.endpoint_id),
    knowledge_base_ids: form.knowledgeBaseId ? [Number(form.knowledgeBaseId)] : [],
  };
}

/**
 * The full role-config editor shared by the per-agent dialog and the scene
 * editor. Renders language/voice/model selectors, behavior switches, custom
 * character, knowledge base and MCP tool pickers.
 *
 * Lock support: pass `lockedKeys` plus `onToggleLock` to show per-field lock
 * toggles (teacher view), or `lockEnforced` to disable locked fields
 * (student view). Omit all three for the scene editor.
 */
export function AgentConfigFields({
  form,
  setForm,
  resources,
  disabled,
  lockedKeys,
  lockEnforced = false,
  onToggleLock,
}: {
  form: EditorForm;
  setForm: (form: EditorForm) => void;
  resources: XiaozhiAgentEditorData;
  disabled: boolean;
  lockedKeys?: Set<string>;
  lockEnforced?: boolean;
  onToggleLock?: (key: string) => void;
}) {
  const voices = resources.ttsList.ttsVoices[form.language] || [];
  const isLocked = (key: string) => Boolean(lockedKeys?.has(key));
  const fieldDisabled = (key: string) => disabled || (lockEnforced && isLocked(key));
  const lockBadge = (key: string) =>
    onToggleLock ? (
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground"
        title={isLocked(key) ? "已锁定，学生不可修改；点击解锁" : "点击锁定，锁定后学生不可修改"}
        onClick={() => onToggleLock(key)}
      >
        {isLocked(key) ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
      </button>
    ) : lockEnforced && isLocked(key) ? (
      <Lock className="text-muted-foreground size-3.5" aria-label="老师已锁定" />
    ) : null;
  const availableTools = useMemo(
    () =>
      resources.mcpTools.filter((tool) => {
        if (!tool.language) return true;
        const languages = Array.isArray(tool.language) ? tool.language : [tool.language];
        return languages.includes(form.language);
      }),
    [form.language, resources],
  );

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <Label>对话语言</Label>
            {lockBadge("language")}
          </div>
          <Select
            value={form.language}
            disabled={fieldDisabled("language")}
            onValueChange={(language) => {
              const nextVoices = resources.ttsList.ttsVoices[language] || [];
              const allowedTools = new Set(
                resources.mcpTools
                  .filter((tool) => {
                    if (!tool.language) return true;
                    const languages = Array.isArray(tool.language)
                      ? tool.language
                      : [tool.language];
                    return languages.includes(language);
                  })
                  .map((tool) => String(tool.endpoint_id)),
              );
              setForm({
                ...form,
                language,
                ttsVoice: nextVoices[0]?.voice_id || "",
                mcpEndpoints: form.mcpEndpoints.filter((id) => allowedTools.has(id)),
              });
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择语言" />
            </SelectTrigger>
            <SelectContent>
              {resources.ttsList.languages.map((language) => (
                <SelectItem value={language} key={language}>
                  {language}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <Label>角色音色</Label>
            {lockBadge("tts_voice")}
          </div>
          <Select
            value={form.ttsVoice}
            disabled={fieldDisabled("tts_voice") || !voices.length}
            onValueChange={(ttsVoice) => setForm({ ...form, ttsVoice })}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择音色" />
            </SelectTrigger>
            <SelectContent>
              {voices.map((voice) => (
                <SelectItem value={voice.voice_id} key={voice.voice_id}>
                  {voice.voice_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <Label>语言模型</Label>
            {lockBadge("llm_model")}
          </div>
          <Select
            value={form.llmModel}
            disabled={fieldDisabled("llm_model")}
            onValueChange={(llmModel) => setForm({ ...form, llmModel })}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择模型" />
            </SelectTrigger>
            <SelectContent>
              {resources.models.map((model) => (
                <SelectItem value={model.name} key={model.name}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <Label>识别速度</Label>
            {lockBadge("asr_speed")}
          </div>
          <Select
            value={form.asrSpeed}
            disabled={fieldDisabled("asr_speed")}
            onValueChange={(value) => setForm({ ...form, asrSpeed: value as Speed })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SPEED_LABELS).map(([value, label]) => (
                <SelectItem value={value} key={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <Label>语音速度</Label>
            {lockBadge("tts_speech_speed")}
          </div>
          <Select
            value={form.ttsSpeechSpeed}
            disabled={fieldDisabled("tts_speech_speed")}
            onValueChange={(value) => setForm({ ...form, ttsSpeechSpeed: value as Speed })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SPEED_LABELS).map(([value, label]) => (
                <SelectItem value={value} key={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <Label>记忆模式</Label>
            {lockBadge("memory_type")}
          </div>
          <Select
            value={form.memoryType}
            disabled={fieldDisabled("memory_type")}
            onValueChange={(value) =>
              setForm({ ...form, memoryType: value as EditorForm["memoryType"] })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(MEMORY_LABELS).map(([value, label]) => (
                <SelectItem value={value} key={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <Label>音调 ({form.ttsPitch})</Label>
            {lockBadge("tts_pitch")}
          </div>
          <Input
            type="number"
            min={-3}
            max={3}
            step={1}
            value={form.ttsPitch}
            disabled={fieldDisabled("tts_pitch")}
            onChange={(event) =>
              setForm({
                ...form,
                ttsPitch: Math.min(3, Math.max(-3, Number(event.target.value) || 0)),
              })
            }
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t pt-3">
        <div>
          <p className="flex items-center gap-1.5 font-medium">青少年模式 {lockBadge("teen_mode")}</p>
          <p className="text-muted-foreground text-xs">开启后上游会对回答内容做适龄限制。</p>
        </div>
        <Switch
          checked={form.teenMode}
          disabled={fieldDisabled("teen_mode")}
          onCheckedChange={(teenMode) => setForm({ ...form, teenMode })}
        />
      </div>

      <div className="border-t pt-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 font-medium">自定义角色设定 {lockBadge("character")}</p>
            <p className="text-muted-foreground text-xs">关闭时沿用 CubeCat 模板自带的人物设定。</p>
          </div>
          <Switch
            checked={form.customCharacter}
            disabled={fieldDisabled("character")}
            onCheckedChange={(customCharacter) => setForm({ ...form, customCharacter })}
          />
        </div>
        {form.customCharacter ? (
          <Textarea
            rows={4}
            maxLength={12000}
            placeholder="描述这个角色的身份、说话风格和教学任务"
            value={form.character}
            disabled={fieldDisabled("character")}
            onChange={(event) => setForm({ ...form, character: event.target.value })}
          />
        ) : null}
      </div>

      {resources.knowledgeBases.length ? (
        <div className="border-t pt-3">
          <div className="mb-1.5 flex items-center gap-1.5">
            <Label>知识库</Label>
            {lockBadge("knowledge_base_ids")}
          </div>
          <Select
            value={form.knowledgeBaseId || "none"}
            disabled={fieldDisabled("knowledge_base_ids")}
            onValueChange={(value) =>
              setForm({ ...form, knowledgeBaseId: value === "none" ? "" : value })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="不绑定知识库" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">不绑定知识库</SelectItem>
              {resources.knowledgeBases.map((base) => (
                <SelectItem value={String(base.id)} key={base.id}>
                  {base.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {availableTools.length ? (
        <div className="border-t pt-3">
          <p className="mb-2 flex items-center gap-1.5 font-medium">扩展工具 {lockBadge("mcp_endpoints")}</p>
          <div className="flex flex-wrap gap-2">
            {availableTools.map((tool) => {
              const endpointId = String(tool.endpoint_id);
              const enabled = form.mcpEndpoints.includes(endpointId);
              return (
                <Button
                  key={endpointId}
                  size="sm"
                  variant={enabled ? "default" : "outline"}
                  disabled={fieldDisabled("mcp_endpoints")}
                  title={tool.description}
                  onClick={() =>
                    setForm({
                      ...form,
                      mcpEndpoints: enabled
                        ? form.mcpEndpoints.filter((id) => id !== endpointId)
                        : [...form.mcpEndpoints, endpointId],
                    })
                  }
                >
                  {tool.name}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}

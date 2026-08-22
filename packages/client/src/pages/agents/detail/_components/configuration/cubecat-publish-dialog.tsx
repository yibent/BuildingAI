import {
  usePublishBuildingAgentToCubeCatMutation,
  useXiaozhiAgentEditorQuery,
  useXiaozhiAgentsQuery,
  useXiaozhiDevicesQuery,
} from "@buildingai/services/web";
import { Badge } from "@buildingai/ui/components/ui/badge";
import { Button } from "@buildingai/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@buildingai/ui/components/ui/dialog";
import { Label } from "@buildingai/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@buildingai/ui/components/ui/select";
import { Cpu, LoaderCircle, Radio } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AgentConfigFields,
  configToForm,
  type EditorForm,
  formToConfig,
  validateForm,
} from "@/components/settings-dialog/settings-items/agent-config-form";

type CubeCatPublishDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildingAgentId: string;
  buildingAgentName?: string;
  promptPreview: string;
  openingStatement?: string;
};

function composePrompt(rolePrompt: string, openingStatement?: string) {
  const parts = [rolePrompt.trim()];
  const opening = openingStatement?.trim();
  if (opening) parts.push(`对话开始时，请先说：${opening}`);
  return parts.filter(Boolean).join("\n\n").slice(0, 12000);
}

export function CubeCatPublishDialog({
  open,
  onOpenChange,
  buildingAgentId,
  buildingAgentName,
  promptPreview,
  openingStatement,
}: CubeCatPublishDialogProps) {
  const { data: targetAgents = [], isLoading: agentsLoading } = useXiaozhiAgentsQuery({
    enabled: open,
  });
  const [targetAgentId, setTargetAgentId] = useState("");
  const [form, setForm] = useState<EditorForm | null>(null);

  const selectedTarget = targetAgents.find((agent) => agent.id === targetAgentId) || null;
  const editorQuery = useXiaozhiAgentEditorQuery(targetAgentId || null, {
    enabled: open && Boolean(targetAgentId),
  });
  const resources = editorQuery.data;
  const devicesQuery = useXiaozhiDevicesQuery(targetAgentId || null, {
    enabled: open && Boolean(targetAgentId),
  });
  const devices = devicesQuery.data ?? [];
  const publishMutation = usePublishBuildingAgentToCubeCatMutation(buildingAgentId);
  const composedPrompt = composePrompt(promptPreview, openingStatement);

  useEffect(() => {
    if (!open) return;
    const first = targetAgents[0];
    setTargetAgentId((current) =>
      targetAgents.some((agent) => agent.id === current) ? current : first?.id || "",
    );
  }, [open, targetAgents]);

  useEffect(() => {
    setForm(null);
  }, [targetAgentId, composedPrompt, open]);

  useEffect(() => {
    if (!resources || form) return;
    const base = configToForm(resources.config, resources);
    setForm({
      ...base,
      customCharacter: Boolean(composedPrompt) || base.customCharacter,
      character: composedPrompt || base.character,
    });
  }, [composedPrompt, form, resources]);

  function submit() {
    if (!form || !resources || !targetAgentId) return;
    if (!composedPrompt && !form.character.trim()) {
      toast.error("请先填写角色设定，再发布到设备");
      return;
    }
    const formError = validateForm({ ...form, customCharacter: true, character: form.character });
    if (formError) {
      toast.error(formError);
      return;
    }
    const config = formToConfig({ ...form, customCharacter: true }, resources);
    publishMutation.mutate(
      {
        targetAgentId,
        model: form.llmModel,
        voice: form.ttsVoice,
        language: form.language || undefined,
        character: String(config.character || composedPrompt),
        asrSpeed: form.asrSpeed,
        ttsSpeechSpeed: form.ttsSpeechSpeed,
        ttsPitch: form.ttsPitch,
        memoryType: form.memoryType,
        teenMode: form.teenMode,
      },
      {
        onSuccess: (result: { affectedDevices?: number } | undefined) => {
          const affectedDevices = Number(result?.affectedDevices || selectedTarget?.deviceCount || 0);
          toast.success(
            affectedDevices > 0
              ? `已发布到设备，配置将应用到 ${affectedDevices} 台方糖猫`
              : "已发布到设备",
          );
          onOpenChange(false);
        },
      },
    );
  }

  const canSubmit = Boolean(
    form &&
      resources &&
      targetAgentId &&
      !editorQuery.isFetching &&
      !publishMutation.isPending,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="size-5" />
            发布到设备
          </DialogTitle>
          <DialogDescription>
            将「{buildingAgentName || "当前智能体"}」的角色设定同步到方糖猫。提示词已自动填入，还可以继续调整音色、模型和记忆等设备侧配置。
          </DialogDescription>
        </DialogHeader>

        {!targetAgents.length && !agentsLoading ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            还没有可发布的方糖猫设备。请先在设置里绑定 CubeCat 账号，或让老师在「讲台 &gt; 设备管理」中分配设备。
          </p>
        ) : (
          <div className="max-h-[min(520px,60dvh)] space-y-4 overflow-auto pr-1">
            <div>
              <Label className="mb-1.5">目标设备</Label>
              <Select
                value={targetAgentId}
                onValueChange={setTargetAgentId}
                disabled={agentsLoading || publishMutation.isPending}
              >
                <SelectTrigger>
                  <SelectValue placeholder={agentsLoading ? "正在读取设备…" : "选择方糖猫设备组"} />
                </SelectTrigger>
                <SelectContent>
                  {targetAgents.map((agent) => (
                    <SelectItem value={agent.id} key={agent.id}>
                      <span className="flex items-center gap-2">
                        <Cpu className="size-3.5" />
                        {agent.name}
                        <span className="text-muted-foreground text-xs">
                          {agent.deviceCount} 台设备
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {devices.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {devices.map((device) => (
                    <Badge variant="outline" className="font-normal" key={device.id}>
                      {device.alias || device.macAddress}
                      {device.online ? " · 在线" : " · 离线"}
                    </Badge>
                  ))}
                </div>
              ) : selectedTarget?.deviceCount ? (
                <p className="text-muted-foreground mt-2 text-xs">
                  该设备组内的 {selectedTarget.deviceCount} 台方糖猫会共同使用此配置。
                </p>
              ) : null}
            </div>

            {editorQuery.isLoading || !form || !resources ? (
              <div className="flex min-h-40 items-center justify-center">
                <LoaderCircle className="size-5 animate-spin" />
              </div>
            ) : (
              <AgentConfigFields
                form={form}
                setForm={setForm}
                resources={resources}
                disabled={publishMutation.isPending}
              />
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={publishMutation.isPending}
          >
            取消
          </Button>
          <Button
            loading={publishMutation.isPending}
            disabled={!canSubmit}
            onClick={submit}
          >
            <Radio />
            确定发布
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

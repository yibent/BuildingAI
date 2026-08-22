import {
  useHomeAssistantDeviceQuery,
  useHomeAssistantDevicesQuery,
} from "@buildingai/services/web";
import { Slider } from "@buildingai/ui/components/ui/slider";
import { Switch } from "@buildingai/ui/components/ui/switch";
import { cn } from "@buildingai/ui/lib/utils";
import { Field } from "@flowgram.ai/free-layout-editor";
import { useEffect, useMemo, useRef, useState } from "react";

import { FormItem, ReadonlyValue } from "../../form-components";
import { useIsSidebar } from "../../hooks/use-is-sidebar";
import { useNodeRenderContext } from "../../hooks/use-node-render-context";
import {
  commandSummary,
  getCategoryLabel,
  lightFeatures,
  unifyHomeAssistantDevice,
  type SmartHomeControlCommand,
  type UnifiedSmartHomeDevice,
} from "./controls";

function InteractiveSlider({
  value,
  min,
  max,
  step,
  disabled,
  onCommit,
  label,
  display,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
  label: string;
  display: (value: number) => string;
}) {
  const [draft, setDraft] = useState(value);
  const dragging = useRef(false);

  useEffect(() => {
    if (!dragging.current) setDraft(value);
  }, [value]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">{label}</span>
        <span className="text-muted-foreground text-xs tabular-nums">{display(draft)}</span>
      </div>
      <Slider
        value={[draft]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onPointerDown={(event) => event.stopPropagation()}
        onValueChange={(values) => {
          dragging.current = true;
          setDraft(values[0] ?? min);
        }}
        onValueCommit={(values) => {
          dragging.current = false;
          const next = values[0] ?? min;
          setDraft(next);
          onCommit(next);
        }}
        aria-label={label}
      />
    </div>
  );
}

function useBoundDevice(provider?: string, deviceId?: string) {
  const enabled = Boolean(deviceId) && provider === "homeassistant";
  const list = useHomeAssistantDevicesQuery(undefined, { enabled: provider === "homeassistant" });
  const detail = useHomeAssistantDeviceQuery(deviceId, { enabled });

  return useMemo(() => {
    if (provider !== "homeassistant" || !deviceId) return undefined;
    const device = detail.data || list.data?.find((item) => item.id === deviceId);
    return device ? unifyHomeAssistantDevice(device) : undefined;
  }, [detail.data, deviceId, list.data, provider]);
}

function patchCommand(
  command: SmartHomeControlCommand | undefined,
  patch: Partial<SmartHomeControlCommand>,
): SmartHomeControlCommand {
  const next: SmartHomeControlCommand = { ...(command ?? {}), ...patch };
  if (patch.mode === "white") next.color = undefined;
  if (patch.mode === "color") next.colorTemp = undefined;
  return next;
}

function LightPanel({
  device,
  command,
  disabled,
  onChange,
}: {
  device: UnifiedSmartHomeDevice;
  command: SmartHomeControlCommand | undefined;
  disabled: boolean;
  onChange: (command: SmartHomeControlCommand) => void;
}) {
  const features = lightFeatures(device);
  const isOn = command?.on ?? device.state.on;
  const brightness = command?.brightness ?? device.state.brightness ?? 100;
  const colorTemp =
    command?.colorTemp ?? device.state.colorTemp ?? device.state.minKelvin ?? 2700;
  const inColorMode =
    command?.mode === "color" ||
    (command?.mode !== "white" && (Boolean(command?.color) || features.liveColorMode));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md border px-3 py-3">
        <div>
          <div className="text-sm font-medium">电源</div>
          <div className="text-muted-foreground text-xs">{isOn ? "开启这盏灯" : "关闭这盏灯"}</div>
        </div>
        <Switch
          checked={Boolean(isOn)}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(patchCommand(command, { on: checked }))}
          aria-label="开关"
        />
      </div>

      {features.hasBrightness ? (
        <InteractiveSlider
          label="亮度"
          value={brightness || 1}
          min={1}
          max={100}
          step={1}
          disabled={disabled}
          display={(next) => `${Math.round(next)}%`}
          onCommit={(next) => onChange(patchCommand(command, { brightness: next, on: true }))}
        />
      ) : null}

      {features.hasColor && features.hasColorTemp ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={cn(
              "h-8 rounded-md border text-xs",
              inColorMode ? "bg-foreground text-background" : "bg-background",
            )}
            disabled={disabled}
            onClick={() =>
              onChange(
                patchCommand(command, {
                  mode: "color",
                  on: true,
                  color: command?.color || device.state.color || "#ffffff",
                }),
              )
            }
          >
            彩光
          </button>
          <button
            type="button"
            className={cn(
              "h-8 rounded-md border text-xs",
              !inColorMode ? "bg-foreground text-background" : "bg-background",
            )}
            disabled={disabled}
            onClick={() =>
              onChange(patchCommand(command, { mode: "white", on: true, colorTemp }))
            }
          >
            白光
          </button>
        </div>
      ) : null}

      {features.hasColor && (inColorMode || !features.hasColorTemp) ? (
        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-3">
          <div>
            <div className="text-sm font-medium">颜色</div>
            <div className="text-muted-foreground text-xs">直接点选，不用填色值</div>
          </div>
          <input
            type="color"
            value={command?.color || device.state.color || "#ffffff"}
            disabled={disabled}
            onChange={(event) =>
              onChange(patchCommand(command, { color: event.target.value, mode: "color", on: true }))
            }
            aria-label="颜色"
            className="h-10 w-16 cursor-pointer rounded border bg-transparent p-0.5"
          />
        </div>
      ) : null}

      {features.hasColorTemp && (!inColorMode || !features.hasColor) ? (
        <InteractiveSlider
          label="色温"
          value={colorTemp}
          min={device.state.minKelvin || 1700}
          max={device.state.maxKelvin || 6500}
          step={50}
          disabled={disabled}
          display={(next) => `${Math.round(next)} K`}
          onCommit={(next) =>
            onChange(patchCommand(command, { colorTemp: next, mode: "white", on: true }))
          }
        />
      ) : null}
    </div>
  );
}

function SwitchPanel({
  device,
  command,
  disabled,
  onChange,
}: {
  device: UnifiedSmartHomeDevice;
  command: SmartHomeControlCommand | undefined;
  disabled: boolean;
  onChange: (command: SmartHomeControlCommand) => void;
}) {
  const isOn = command?.on ?? device.state.on;
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-3">
      <div>
        <div className="text-sm font-medium">开关</div>
        <div className="text-muted-foreground text-xs">{isOn ? "打开设备" : "关闭设备"}</div>
      </div>
      <Switch
        checked={Boolean(isOn)}
        disabled={disabled}
        onCheckedChange={(checked) => onChange(patchCommand(command, { on: checked }))}
        aria-label="开关"
      />
    </div>
  );
}

function BoundDeviceForm({
  provider,
  deviceId,
  deviceName,
  command,
  onCommandChange,
}: {
  provider?: string;
  deviceId?: string;
  deviceName?: string;
  command?: SmartHomeControlCommand;
  onCommandChange: (command: SmartHomeControlCommand) => void;
}) {
  const { readonly } = useNodeRenderContext();
  const isSidebar = useIsSidebar();
  const device = useBoundDevice(provider, deviceId);
  const title = device?.name || deviceName || "未选择设备";
  const place = device?.areaName || "";
  const legacyProvider = Boolean(provider && provider !== "homeassistant");

  if (!isSidebar) {
    return (
      <>
        <FormItem name="设备" type="string">
          <ReadonlyValue value={title} />
        </FormItem>
        <FormItem name="本次控制" type="string">
          <ReadonlyValue value={commandSummary(command)} />
        </FormItem>
      </>
    );
  }

  if (legacyProvider) {
    return (
      <FormItem name="设备" required type="string">
        <ReadonlyValue value="该节点仍绑定已移除的米家/易来设备，请删除后从工具页重新拖入 Home Assistant 设备" />
      </FormItem>
    );
  }

  if (!device) {
    return (
      <FormItem name="设备" required type="string">
        <ReadonlyValue value={deviceId ? "正在读取设备…" : "请从工具页勾选设备后再拖入"} />
      </FormItem>
    );
  }

  const category = device.category;
  return (
    <div className="space-y-4">
      <FormItem name="设备" required type="string">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-muted-foreground mt-0.5 text-xs">
            {getCategoryLabel(category, device.categoryLabel)}
            {place ? ` · ${place}` : ""}
            {device.online ? " · 在线" : " · 离线"}
          </div>
        </div>
      </FormItem>

      {category === "light" ? (
        <LightPanel device={device} command={command} disabled={readonly} onChange={onCommandChange} />
      ) : category === "switch" ? (
        <SwitchPanel device={device} command={command} disabled={readonly} onChange={onCommandChange} />
      ) : (
        <p className="text-muted-foreground text-xs">
          该类型会先列出来，控制能力会按灯光的方式逐步补齐。运行时目前支持灯光和开关。
        </p>
      )}
    </div>
  );
}

export function SmartHomeDevicePanel() {
  return (
    <Field<string | undefined> name="provider">
      {({ field: providerField }) => (
        <Field<string | undefined> name="deviceId">
          {({ field: deviceField }) => (
            <Field<string | undefined> name="deviceName">
              {({ field: nameField }) => (
                <Field<SmartHomeControlCommand | undefined> name="command">
                  {({ field: commandField }) => (
                    <BoundDeviceForm
                      provider={providerField.value}
                      deviceId={deviceField.value}
                      deviceName={nameField.value}
                      command={commandField.value}
                      onCommandChange={commandField.onChange}
                    />
                  )}
                </Field>
              )}
            </Field>
          )}
        </Field>
      )}
    </Field>
  );
}

import {
  useControlHomeAssistantDeviceMutation,
  useHomeAssistantDeviceQuery,
  useHomeAssistantDevicesQuery,
  useHomeAssistantInstanceQuery,
  useRefreshHomeAssistantDeviceMutation,
  useSyncHomeAssistantInstanceMutation,
  type HomeAssistantDevice,
  type HomeAssistantLightCommand,
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@buildingai/ui/components/ui/empty";
import { Input } from "@buildingai/ui/components/ui/input";
import { ScrollArea } from "@buildingai/ui/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@buildingai/ui/components/ui/select";
import { Skeleton } from "@buildingai/ui/components/ui/skeleton";
import { Slider } from "@buildingai/ui/components/ui/slider";
import { Switch } from "@buildingai/ui/components/ui/switch";
import { cn } from "@buildingai/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  AirVent,
  Blinds,
  Boxes,
  Fan,
  Home,
  Lightbulb,
  LockKeyhole,
  Plug,
  RefreshCw,
  Search,
  Speaker,
  BrushCleaning,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useSettingsDialog } from "@/components/settings-dialog";

import { PageShell } from "../_components/page-shell";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  light: Lightbulb,
  switch: Plug,
  climate: AirVent,
  cover: Blinds,
  fan: Fan,
  lock: LockKeyhole,
  vacuum: BrushCleaning,
  media_player: Speaker,
};

const COLOR_MODES = {
  rgb: new Set(["rgb", "rgbw", "rgbww", "hs", "xy"]),
  colorTemp: new Set(["color_temp"]),
  brightness: new Set(["brightness", "white", "rgb", "rgbw", "rgbww", "hs", "xy", "color_temp"]),
};

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
    <div className="space-y-2 rounded-md border px-3 py-3">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
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
          if (next !== value) onCommit(next);
        }}
        aria-label={label}
      />
    </div>
  );
}

function LightPanel({
  device,
  disabled,
  onChange,
}: {
  device: HomeAssistantDevice;
  disabled: boolean;
  onChange: (command: HomeAssistantLightCommand) => void;
}) {
  const state = device.state;
  const modes = state.supportedColorModes || [];
  const hasBrightness = modes.some((mode) => COLOR_MODES.brightness.has(mode)) || state.brightness !== null;
  const hasColor = modes.some((mode) => COLOR_MODES.rgb.has(mode));
  const hasColorTemp = modes.some((mode) => COLOR_MODES.colorTemp.has(mode));
  const inColorMode = state.colorMode ? COLOR_MODES.rgb.has(state.colorMode) : hasColor && !hasColorTemp;
  const brightness = state.brightness ?? 100;
  const colorTemp = state.colorTemp ?? state.minKelvin ?? 2700;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between rounded-md border px-3 py-3">
        <div>
          <div className="text-sm font-medium">电源</div>
          <div className="text-muted-foreground text-xs">{state.on ? "已开启" : "已关闭"}</div>
        </div>
        <Switch
          checked={state.on}
          disabled={disabled}
          onCheckedChange={(on) => onChange({ on })}
          aria-label="开关"
        />
      </div>
      {hasBrightness ? (
        <InteractiveSlider
          label="亮度"
          value={brightness || 1}
          min={1}
          max={100}
          step={1}
          disabled={disabled}
          display={(next) => `${Math.round(next)}%`}
          onCommit={(next) => onChange({ brightness: next, on: true })}
        />
      ) : null}
      {hasColor && hasColorTemp ? (
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            size="sm"
            variant={inColorMode ? "default" : "outline"}
            disabled={disabled}
            onClick={() => onChange({ color: state.color || "#ffffff", on: true })}
          >
            彩光
          </Button>
          <Button
            type="button"
            size="sm"
            variant={!inColorMode ? "default" : "outline"}
            disabled={disabled}
            onClick={() => onChange({ colorTemp, on: true })}
          >
            白光
          </Button>
        </div>
      ) : null}
      {hasColor && (inColorMode || !hasColorTemp) ? (
        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-3">
          <div>
            <div className="text-sm font-medium">颜色</div>
            <div className="text-muted-foreground text-xs">由 Home Assistant 下发</div>
          </div>
          <input
            type="color"
            value={state.color || "#ffffff"}
            disabled={disabled}
            onChange={(event) => onChange({ color: event.target.value, on: true })}
            aria-label="颜色"
            className="h-10 w-16 cursor-pointer rounded border bg-transparent p-0.5"
          />
        </div>
      ) : null}
      {hasColorTemp && (!inColorMode || !hasColor) ? (
        <InteractiveSlider
          label="色温"
          value={colorTemp}
          min={state.minKelvin || 1700}
          max={state.maxKelvin || 6500}
          step={50}
          disabled={disabled}
          display={(next) => `${Math.round(next)} K`}
          onCommit={(next) => onChange({ colorTemp: next, on: true })}
        />
      ) : null}
    </section>
  );
}

export default function SmartHomePage() {
  const settingsDialog = useSettingsDialog();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>();
  const [selectedAreaId, setSelectedAreaId] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword.trim().toLocaleLowerCase());
  const instanceQuery = useHomeAssistantInstanceQuery();
  const devicesQuery = useHomeAssistantDevicesQuery();
  const devices = devicesQuery.data || [];
  const instance = instanceQuery.data;

  const filtered = useMemo(() => {
    return devices.filter((device) => {
      if (selectedAreaId !== "all" && (device.areaId || "unassigned") !== selectedAreaId) {
        return false;
      }
      if (selectedCategory !== "all" && device.category !== selectedCategory) return false;
      if (!deferredKeyword) return true;
      return [device.name, device.entityId, device.areaName, device.categoryLabel]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(deferredKeyword));
    });
  }, [deferredKeyword, devices, selectedAreaId, selectedCategory]);

  const areas = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const device of devices) {
      const id = device.areaId || "unassigned";
      const current = map.get(id) || { id, name: device.areaName || "未分区", count: 0 };
      current.count += 1;
      map.set(id, current);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [devices]);

  const categories = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const device of devices) {
      const current = map.get(device.category) || {
        id: device.category,
        name: device.categoryLabel,
        count: 0,
      };
      current.count += 1;
      map.set(device.category, current);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [devices]);

  const selectedDevice = devices.find((device) => device.id === selectedDeviceId);
  const detailQuery = useHomeAssistantDeviceQuery(selectedDeviceId, {
    enabled: Boolean(selectedDeviceId),
  });
  const detailDevice = detailQuery.data || selectedDevice;
  const control = useControlHomeAssistantDeviceMutation({
    onError: (error) => toast.error(error.message || "设备控制失败"),
  });
  const refresh = useRefreshHomeAssistantDeviceMutation({
    onError: (error) => toast.error(error.message || "刷新失败"),
  });
  const sync = useSyncHomeAssistantInstanceMutation({
    onSuccess: (saved) => toast.success(`已同步 ${saved.deviceCount} 个设备`),
    onError: (error) => toast.error(error.message || "同步失败"),
  });

  return (
    <PageShell
      icon={Home}
      title="智能家居"
      description={
        instance
          ? `${instance.locationName || instance.label} · ${devices.length} 个设备`
          : "通过 Home Assistant 控制灯光和其他家具"
      }
      actions={
        instance ? (
          <Button
            variant="outline"
            onClick={() => sync.mutate()}
            disabled={sync.isPending || devicesQuery.isFetching}
          >
            <RefreshCw className={cn((sync.isPending || devicesQuery.isFetching) && "animate-spin")} />
            同步
          </Button>
        ) : null
      }
    >
      {!instance && !instanceQuery.isLoading ? (
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Home />
            </EmptyMedia>
            <EmptyTitle>尚未连接 Home Assistant</EmptyTitle>
            <EmptyDescription>在设置里填写 HA 地址和令牌后，这里会列出灯光和其他设备。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => settingsDialog.open("smartHome")}>打开设置</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索设备"
                className="pl-9"
              />
            </div>
            <Select value={selectedAreaId} onValueChange={setSelectedAreaId}>
              <SelectTrigger className="sm:w-44">
                <SelectValue placeholder="区域" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部区域</SelectItem>
                {areas.map((area) => (
                  <SelectItem value={area.id} key={area.id}>
                    {area.name} ({area.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="sm:w-44">
                <SelectValue placeholder="类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                {categories.map((category) => (
                  <SelectItem value={category.id} key={category.id}>
                    {category.name} ({category.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {devicesQuery.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-28 rounded-md" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <Empty className="min-h-64 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Boxes />
                </EmptyMedia>
                <EmptyTitle>没有匹配的设备</EmptyTitle>
                <EmptyDescription>先在 Home Assistant 里接入灯，再点同步。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((device) => {
                const Icon = CATEGORY_ICONS[device.category] || Boxes;
                return (
                  <button
                    type="button"
                    key={device.id}
                    className="bg-background hover:bg-muted/40 flex items-start gap-3 rounded-md border p-4 text-left"
                    onClick={() => setSelectedDeviceId(device.id)}
                  >
                    <span className="bg-muted flex size-10 items-center justify-center rounded-md">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{device.name}</span>
                      <span className="text-muted-foreground mt-1 block truncate text-xs">
                        {device.categoryLabel}
                        {device.areaName ? ` · ${device.areaName}` : ""}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "mt-1 size-1.5 shrink-0 rounded-full",
                        device.online ? "bg-emerald-500" : "bg-zinc-400",
                      )}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      <Dialog open={Boolean(selectedDeviceId)} onOpenChange={(open) => !open && setSelectedDeviceId(undefined)}>
        <DialogContent className="flex max-h-[min(760px,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          {detailDevice ? (
            <>
              <DialogHeader className="border-b px-5 py-5 text-left sm:px-6">
                <DialogTitle className="truncate">{detailDevice.name}</DialogTitle>
                <DialogDescription>
                  {detailDevice.categoryLabel}
                  {detailDevice.areaName ? ` · ${detailDevice.areaName}` : ""}
                  {` · ${detailDevice.entityId}`}
                </DialogDescription>
              </DialogHeader>
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-4 p-5 sm:p-6">
                  {detailDevice.domain === "light" ? (
                    <LightPanel
                      device={detailDevice}
                      disabled={control.isPending}
                      onChange={(command) =>
                        control.mutate({ deviceId: detailDevice.id, command })
                      }
                    />
                  ) : detailDevice.domain === "switch" ? (
                    <div className="flex items-center justify-between rounded-md border px-3 py-3">
                      <div>
                        <div className="text-sm font-medium">开关</div>
                        <div className="text-muted-foreground text-xs">
                          {detailDevice.state.on ? "已开启" : "已关闭"}
                        </div>
                      </div>
                      <Switch
                        checked={detailDevice.state.on}
                        disabled={control.isPending}
                        onCheckedChange={(on) =>
                          control.mutate({ deviceId: detailDevice.id, command: { on } })
                        }
                      />
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      该类型会先列出来，控制能力会按灯光的方式逐步补齐。
                    </p>
                  )}
                </div>
              </ScrollArea>
              <DialogFooter className="border-t px-5 py-3 sm:px-6">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refresh.mutate(detailDevice.id)}
                  disabled={refresh.isPending}
                >
                  <RefreshCw className={cn(refresh.isPending && "animate-spin")} />
                  刷新状态
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

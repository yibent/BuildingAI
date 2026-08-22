import {
  programmingProjectToolKey,
  useHomeAssistantDevicesQuery,
  useMcpServersAllQuery,
  useReplaceProgrammingProjectToolsMutation,
  type HomeAssistantDevice,
  type ProgrammingProjectToolRef,
} from "@buildingai/services/web";
import { Badge } from "@buildingai/ui/components/ui/badge";
import { Button } from "@buildingai/ui/components/ui/button";
import { Checkbox } from "@buildingai/ui/components/ui/checkbox";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@buildingai/ui/components/ui/empty";
import { Input } from "@buildingai/ui/components/ui/input";
import { Skeleton } from "@buildingai/ui/components/ui/skeleton";
import { cn } from "@buildingai/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  AirVent,
  Blinds,
  Boxes,
  Check,
  ExternalLink,
  Fan,
  Home,
  Lightbulb,
  Plug,
  RefreshCw,
  Search,
  Server,
  Wrench,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { localizeMcpTool } from "@/lib/mcp-tool-i18n";

import { useProgrammingProject } from "./context";

const DEVICE_ICONS: Record<string, LucideIcon> = {
  light: Lightbulb,
  switch: Plug,
  climate: AirVent,
  cover: Blinds,
  fan: Fan,
};

function asToolRef(tool: ProgrammingProjectToolRef): ProgrammingProjectToolRef {
  if (tool.kind === "homeassistant") return tool;
  return { kind: "mcp", mcpServerId: tool.mcpServerId, toolName: tool.toolName };
}

function deviceToolRef(device: HomeAssistantDevice): ProgrammingProjectToolRef {
  return { kind: "homeassistant", deviceId: device.id };
}

export default function ProgrammingToolsPage() {
  const project = useProgrammingProject();
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword.trim().toLocaleLowerCase());
  const [selectedKeys, setSelectedKeys] = useState(
    () => new Set(project.tools.map((tool) => programmingProjectToolKey(asToolRef(tool)))),
  );
  const serversQuery = useMcpServersAllQuery({ isDisabled: false });
  const devicesQuery = useHomeAssistantDevicesQuery();

  useEffect(() => {
    setSelectedKeys(new Set(project.tools.map((tool) => programmingProjectToolKey(asToolRef(tool)))));
  }, [project.tools]);

  const devices = useMemo(() => {
    const list = devicesQuery.data ?? [];
    if (!deferredKeyword) return list;
    return list.filter((device) =>
      [device.name, device.categoryLabel, device.areaName, device.entityId]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(deferredKeyword)),
    );
  }, [deferredKeyword, devicesQuery.data]);

  const servers = useMemo(
    () =>
      (serversQuery.data ?? []).flatMap((server) => {
        const tools = (server.tools ?? []).filter((tool) => {
          if (!deferredKeyword) return true;
          const localized = localizeMcpTool(tool);
          return [server.alias, server.name, localized.title, tool.name, localized.description]
            .filter(Boolean)
            .some((value) => value!.toLocaleLowerCase().includes(deferredKeyword));
        });
        return tools.length ? [{ ...server, tools }] : [];
      }),
    [deferredKeyword, serversQuery.data],
  );

  const saveMutation = useReplaceProgrammingProjectToolsMutation({
    onSuccess: () => toast.success("工具权限已保存"),
    onError: (error) => toast.error(error.message || "工具权限保存失败"),
  });

  const enabledTools = useMemo(() => {
    const mcpTools = (serversQuery.data ?? []).flatMap((server) =>
      (server.tools ?? []).flatMap((tool) => {
        const reference: ProgrammingProjectToolRef = {
          kind: "mcp",
          mcpServerId: server.id,
          toolName: tool.name,
        };
        return selectedKeys.has(programmingProjectToolKey(reference)) ? [reference] : [];
      }),
    );
    const deviceTools = (devicesQuery.data ?? []).flatMap((device) => {
      const reference = deviceToolRef(device);
      return selectedKeys.has(programmingProjectToolKey(reference)) ? [reference] : [];
    });
    return [...deviceTools, ...mcpTools];
  }, [selectedKeys, serversQuery.data, devicesQuery.data]);

  const savedKeys = useMemo(
    () => new Set(project.tools.map((tool) => programmingProjectToolKey(asToolRef(tool)))),
    [project.tools],
  );
  const hasChanges =
    selectedKeys.size !== savedKeys.size || [...selectedKeys].some((key) => !savedKeys.has(key));

  const toggleTool = (reference: ProgrammingProjectToolRef, checked: boolean) => {
    const key = programmingProjectToolKey(asToolRef(reference));
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const isLoading =
    (serversQuery.isLoading && serversQuery.data === undefined) ||
    (devicesQuery.isLoading && devicesQuery.data === undefined);
  const isError = serversQuery.isError && devicesQuery.isError;
  const isEmpty = devices.length === 0 && servers.length === 0;
  const isFetching = serversQuery.isFetching || devicesQuery.isFetching;

  const refetchAll = () => {
    void serversQuery.refetch();
    void devicesQuery.refetch();
  };

  return (
    <div className="bg-muted/10 h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col px-4 py-6 md:px-8">
        <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold">工程工具</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              已启用 {selectedKeys.size} 个工具，可在工作流的「工具」标签中拖入画布
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索设备、服务或工具"
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={refetchAll}
              disabled={isFetching}
              aria-label="刷新工具"
              title="刷新工具"
            >
              <RefreshCw className={isFetching ? "animate-spin" : undefined} />
            </Button>
            <Button
              onClick={() => saveMutation.mutate({ id: project.id, tools: enabledTools })}
              disabled={!hasChanges || saveMutation.isPending}
            >
              <Check /> 保存
            </Button>
          </div>
        </header>

        {isLoading ? (
          <div className="grid gap-3 pt-5">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-32 w-full rounded-md" />
            ))}
          </div>
        ) : isError ? (
          <Empty className="mt-5 min-h-80 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Wrench />
              </EmptyMedia>
              <EmptyTitle>工具加载失败</EmptyTitle>
              <EmptyDescription>服务暂时不可用。</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={refetchAll}>
                <RefreshCw /> 重试
              </Button>
            </EmptyContent>
          </Empty>
        ) : isEmpty ? (
          <Empty className="mt-5 min-h-80 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Server />
              </EmptyMedia>
              <EmptyTitle>{deferredKeyword ? "没有匹配的工具" : "暂无可用工具"}</EmptyTitle>
              <EmptyDescription>
                {deferredKeyword
                  ? "尝试调整搜索内容。"
                  : "先连接 Home Assistant 并同步设备，或在 MCP 服务中启用工具。"}
              </EmptyDescription>
            </EmptyHeader>
            {!deferredKeyword && (
              <EmptyContent>
                <Button variant="outline" onClick={() => navigate("/smart-home")}>
                  <Home /> 智能家居
                </Button>
                <Button variant="outline" onClick={() => navigate("/console/ai/mcp")}>
                  <ExternalLink /> MCP 服务
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <div className="grid gap-3 pt-5">
            {devices.length > 0 ? (
              <section className="bg-background overflow-hidden rounded-md border">
                <div className="flex items-center gap-3 border-b px-4 py-3">
                  <span className="bg-muted flex size-8 items-center justify-center rounded-md">
                    <Home className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold">物联网家具</h2>
                    <p className="text-muted-foreground truncate text-xs">
                      Home Assistant 设备可作为工作流工具直接拖入画布
                    </p>
                  </div>
                  <Badge variant="outline" className="font-normal">
                    {
                      devices.filter((device) =>
                        selectedKeys.has(programmingProjectToolKey(deviceToolRef(device))),
                      ).length
                    }
                    /{devices.length}
                  </Badge>
                </div>
                <div className="divide-y">
                  {devices.map((device) => {
                    const reference = deviceToolRef(device);
                    const checked = selectedKeys.has(programmingProjectToolKey(reference));
                    const checkboxId = `device-ha-${device.id}`;
                    const Icon = DEVICE_ICONS[device.category] || Boxes;
                    return (
                      <label
                        key={checkboxId}
                        htmlFor={checkboxId}
                        className="hover:bg-muted/40 flex cursor-pointer items-start gap-3 px-4 py-3"
                      >
                        <Checkbox
                          id={checkboxId}
                          checked={checked}
                          onCheckedChange={(value) => toggleTool(reference, value === true)}
                          className="mt-0.5"
                        />
                        <span className="bg-muted mt-0.5 flex size-8 items-center justify-center rounded-md">
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{device.name}</span>
                          <span className="text-muted-foreground mt-0.5 block text-xs leading-4">
                            {[
                              device.categoryLabel || device.category,
                              device.areaName,
                              device.entityId,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "mt-1 size-1.5 shrink-0 rounded-full",
                            device.online ? "bg-emerald-500" : "bg-zinc-400",
                          )}
                          title={device.online ? "在线" : "离线"}
                        />
                      </label>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {servers.map((server) => {
              const selectedCount = server.tools.filter((tool) =>
                selectedKeys.has(
                  programmingProjectToolKey({
                    kind: "mcp",
                    mcpServerId: server.id,
                    toolName: tool.name,
                  }),
                ),
              ).length;
              return (
                <section
                  key={server.id}
                  className="bg-background overflow-hidden rounded-md border"
                >
                  <div className="flex items-center gap-3 border-b px-4 py-3">
                    <span className="bg-muted flex size-8 items-center justify-center rounded-md">
                      <Server className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-sm font-semibold">
                        {server.alias || server.name}
                      </h2>
                      <p className="text-muted-foreground truncate text-xs">
                        {server.description || server.url}
                      </p>
                    </div>
                    <Badge variant="outline" className="font-normal">
                      {selectedCount}/{server.tools.length}
                    </Badge>
                  </div>
                  <div className="divide-y">
                    {server.tools.map((tool) => {
                      const reference: ProgrammingProjectToolRef = {
                        kind: "mcp",
                        mcpServerId: server.id,
                        toolName: tool.name,
                      };
                      const checked = selectedKeys.has(programmingProjectToolKey(reference));
                      const checkboxId = `tool-${server.id}-${tool.id}`;
                      const localized = localizeMcpTool(tool);
                      return (
                        <label
                          key={tool.id}
                          htmlFor={checkboxId}
                          className="hover:bg-muted/40 flex cursor-pointer items-start gap-3 px-4 py-3"
                        >
                          <Checkbox
                            id={checkboxId}
                            checked={checked}
                            onCheckedChange={(value) => toggleTool(reference, value === true)}
                            className="mt-0.5"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">{localized.title}</span>
                            <span className="text-muted-foreground mt-0.5 block text-xs leading-4">
                              {localized.description || localized.title}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

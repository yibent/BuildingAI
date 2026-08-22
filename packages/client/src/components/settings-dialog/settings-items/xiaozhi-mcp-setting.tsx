import { apiHttpClient } from "@buildingai/services";
import { getActiveOrganizationId, useXiaozhiAgentsQuery } from "@buildingai/services/web";
import { Badge } from "@buildingai/ui/components/ui/badge";
import { Button } from "@buildingai/ui/components/ui/button";
import { Checkbox } from "@buildingai/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@buildingai/ui/components/ui/dialog";
import { Input } from "@buildingai/ui/components/ui/input";
import { Switch } from "@buildingai/ui/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@buildingai/ui/components/ui/table";
import { Textarea } from "@buildingai/ui/components/ui/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, LoaderCircle, Pencil, PlugZap, RotateCw, Trash2, Unplug } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// 数据层：MCP 网关的类型与 react-query hooks。
// 组件文件内自带 hooks，避免改动共享的 organization.ts；后续可整体迁入。
// ---------------------------------------------------------------------------

export type XiaozhiMcpConnection = {
  id: string;
  organizationId: string | null;
  ownerUserId: string;
  agentBindingId: string;
  agentName: string;
  accountLabel: string;
  endpointMasked: string;
  enabled: boolean;
  status: "disabled" | "connecting" | "connected" | "reconnecting" | "error";
  lastConnectedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type XiaozhiMcpSettings = {
  toolName: string;
  toolTitle: string;
  toolDescription: string;
  taskKeyDescription: string;
  summaryDescription: string;
  scoreDescription: string;
  promptTemplate: string;
  promptSnippet: string;
  updatedAt: string | null;
};

export type XiaozhiMcpConfigureResult = {
  results: Array<{
    agentId: string;
    agentName: string;
    connectionId?: string;
    success: boolean;
    message?: string;
  }>;
  succeeded: number;
  failed: number;
  status: "success" | "partial" | "failed";
};

function organizationHeaders() {
  const organizationId = getActiveOrganizationId();
  return organizationId ? { "x-organization-id": organizationId } : undefined;
}

export function useXiaozhiMcpConnectionsQuery(options?: { enabled?: boolean }) {
  const organizationId = getActiveOrganizationId();
  return useQuery<XiaozhiMcpConnection[]>({
    queryKey: ["xiaozhi", organizationId, "mcp-connections"],
    queryFn: () =>
      apiHttpClient.get("/organizations/xiaozhi/mcp/connections", {
        headers: organizationHeaders(),
      }),
    refetchInterval: 5_000,
    ...options,
  });
}

export function useXiaozhiMcpSettingsQuery(options?: { enabled?: boolean }) {
  const organizationId = getActiveOrganizationId();
  return useQuery<XiaozhiMcpSettings>({
    queryKey: ["xiaozhi", organizationId, "mcp-settings"],
    queryFn: () =>
      apiHttpClient.get("/organizations/xiaozhi/mcp/settings", {
        headers: organizationHeaders(),
      }),
    ...options,
  });
}

export function useUpdateXiaozhiMcpSettingsMutation(options?: any) {
  const queryClient = useQueryClient();
  return useMutation<
    XiaozhiMcpSettings,
    Error,
    Omit<XiaozhiMcpSettings, "promptSnippet" | "updatedAt">
  >({
    mutationFn: (data) =>
      apiHttpClient.patch("/organizations/xiaozhi/mcp/settings", data, {
        headers: organizationHeaders(),
      }),
    ...options,
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
      options?.onSuccess?.(...args);
    },
  });
}

export function useBatchConfigureXiaozhiMcpMutation(options?: any) {
  const queryClient = useQueryClient();
  return useMutation<XiaozhiMcpConfigureResult, Error, { agentIds?: string[] }>({
    mutationFn: (data) =>
      apiHttpClient.post("/organizations/xiaozhi/mcp/batch-configure", data, {
        headers: organizationHeaders(),
      }),
    ...options,
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
      options?.onSuccess?.(...args);
    },
  });
}

export function useReconnectXiaozhiMcpMutation(options?: any) {
  const queryClient = useQueryClient();
  return useMutation<XiaozhiMcpConnection, Error, string>({
    mutationFn: (connectionId) =>
      apiHttpClient.post(
        `/organizations/xiaozhi/mcp/connections/${connectionId}/reconnect`,
        undefined,
        { headers: organizationHeaders() },
      ),
    ...options,
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
      options?.onSuccess?.(...args);
    },
  });
}

export function useToggleXiaozhiMcpMutation(options?: any) {
  const queryClient = useQueryClient();
  return useMutation<XiaozhiMcpConnection, Error, { connectionId: string; enabled: boolean }>({
    mutationFn: (data) =>
      apiHttpClient.patch(
        `/organizations/xiaozhi/mcp/connections/${data.connectionId}`,
        { enabled: data.enabled },
        { headers: organizationHeaders() },
      ),
    ...options,
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
      options?.onSuccess?.(...args);
    },
  });
}

export function useRemoveXiaozhiMcpMutation(options?: any) {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean; removed: string }, Error, string>({
    mutationFn: (connectionId) =>
      apiHttpClient.delete(`/organizations/xiaozhi/mcp/connections/${connectionId}`, {
        headers: organizationHeaders(),
      }),
    ...options,
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: ["xiaozhi"] });
      options?.onSuccess?.(...args);
    },
  });
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const STATUS_META: Record<
  XiaozhiMcpConnection["status"],
  { label: string; variant: "secondary" | "outline" | "default" | "destructive" }
> = {
  disabled: { label: "已停用", variant: "secondary" },
  connecting: { label: "连接中", variant: "outline" },
  connected: { label: "已连接", variant: "default" },
  reconnecting: { label: "重连中", variant: "outline" },
  error: { label: "连接异常", variant: "destructive" },
};

function formatTime(value: string | null, fallback = "尚未连接") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

type SettingsDraft = Omit<XiaozhiMcpSettings, "promptSnippet" | "updatedAt">;

function McpSettingsDialog({
  settings,
  open,
  onClose,
}: {
  settings: XiaozhiMcpSettings;
  open: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<SettingsDraft>(() => ({
    toolName: settings.toolName,
    toolTitle: settings.toolTitle,
    toolDescription: settings.toolDescription,
    taskKeyDescription: settings.taskKeyDescription,
    summaryDescription: settings.summaryDescription,
    scoreDescription: settings.scoreDescription,
    promptTemplate: settings.promptTemplate,
  }));
  const updateMutation = useUpdateXiaozhiMcpSettingsMutation({
    onSuccess: () => {
      toast.success("MCP 工具说明已保存，连接正在重载");
      onClose();
    },
    onError: (error: Error) => toast.error(error.message || "MCP 工具说明保存失败"),
  });
  const update = (key: keyof SettingsDraft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑 MCP 回传工具</DialogTitle>
          <DialogDescription>
            这是 CubeCat 常驻的回传工具，课堂完成和工作流回传共用。保存后会重载已启用的连接；已开始的对话需要重置后才会用上新说明。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">工具名称</span>
              <Input
                value={draft.toolName}
                onChange={(event) => update("toolName", event.target.value)}
              />
              <span className="text-muted-foreground text-xs">
                CubeCat 对话开始时就能看到的常驻工具名。中途改名需要重置对话。
              </span>
            </div>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">显示名称</span>
              <Input
                value={draft.toolTitle}
                onChange={(event) => update("toolTitle", event.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">工具说明</span>
            <Textarea
              rows={3}
              value={draft.toolDescription}
              onChange={(event) => update("toolDescription", event.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">task_key 参数</span>
              <Textarea
                rows={3}
                value={draft.taskKeyDescription}
                onChange={(event) => update("taskKeyDescription", event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">summary 参数</span>
              <Textarea
                rows={3}
                value={draft.summaryDescription}
                onChange={(event) => update("summaryDescription", event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">score 参数</span>
              <Textarea
                rows={3}
                value={draft.scoreDescription}
                onChange={(event) => update("scoreDescription", event.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">提示词模板</span>
            <Textarea
              rows={5}
              value={draft.promptTemplate}
              onChange={(event) => update("promptTemplate", event.target.value)}
            />
            <span className="text-muted-foreground text-xs">
              使用 {"{tool_name}"} 插入当前工具名称
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={updateMutation.isPending || !draft.toolName.trim()}
            onClick={() => updateMutation.mutate(draft)}
          >
            {updateMutation.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            保存并重载
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * MCP 接入面板：为智能体批量申请上游 MCP 接入点，并管理长连接的
 * 启停、重连与课堂完成工具的说明文案。
 */
export function XiaozhiMcpSetting({ canManage }: { canManage: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<XiaozhiMcpConnection | null>(null);
  const [busyId, setBusyId] = useState("");

  const { data: agents = [] } = useXiaozhiAgentsQuery();
  const { data: connections = [], isLoading: connectionsLoading } = useXiaozhiMcpConnectionsQuery();
  const { data: settings } = useXiaozhiMcpSettingsQuery();

  const configureMutation = useBatchConfigureXiaozhiMcpMutation({
    onSuccess: (result: XiaozhiMcpConfigureResult) => {
      setSelected(new Set());
      if (result.failed) {
        toast.error(`已配置 ${result.succeeded} 个智能体，${result.failed} 个失败`);
      } else {
        toast.success(`已配置 ${result.succeeded} 个智能体`);
      }
    },
    onError: (error: Error) => toast.error(error.message || "批量配置失败"),
  });
  const reconnectMutation = useReconnectXiaozhiMcpMutation({
    onError: (error: Error) => toast.error(error.message || "重新连接失败"),
  });
  const toggleMutation = useToggleXiaozhiMcpMutation({
    onError: (error: Error) => toast.error(error.message || "MCP 连接操作失败"),
  });
  const removeMutation = useRemoveXiaozhiMcpMutation({
    onSuccess: () => {
      setDeleteTarget(null);
      toast.success("MCP 接入点已删除");
    },
    onError: (error: Error) => toast.error(error.message || "删除失败"),
  });

  const connectionByAgent = useMemo(
    () => new Map(connections.map((connection) => [connection.agentBindingId, connection])),
    [connections],
  );
  // 智能体列表 + 已配置但智能体已被移除的连接（仍需要能停用/删除）。
  const rows = useMemo(() => {
    const known = new Set(agents.map((agent) => agent.id));
    const detached = connections
      .filter((connection) => !known.has(connection.agentBindingId))
      .map((connection) => ({
        id: connection.agentBindingId,
        name: connection.agentName,
        detached: true,
      }));
    return [
      ...agents.map((agent) => ({ id: agent.id, name: agent.name, detached: false })),
      ...detached,
    ];
  }, [agents, connections]);
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const connectedCount = connections.filter((item) => item.status === "connected").length;

  const toggleSelected = (agentId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });

  const configure = () => {
    // 未勾选时表示为全部智能体自动配置。
    const agentIds = selected.size
      ? rows.filter((row) => selected.has(row.id) && !row.detached).map((row) => row.id)
      : undefined;
    configureMutation.mutate({ agentIds });
  };

  const runAction = async (id: string, task: () => Promise<unknown>) => {
    setBusyId(id);
    try {
      await task();
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {settings ? (
        <div className="rounded-lg border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <PlugZap className="text-muted-foreground size-5" />
              <div>
                <p className="text-sm font-medium">MCP 完成工具</p>
                <p className="font-mono text-sm">{settings.toolName}</p>
                <p className="text-muted-foreground text-xs">{settings.toolTitle}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                title="复制提示词调用片段"
                onClick={() => {
                  void navigator.clipboard.writeText(settings.promptSnippet);
                  toast.success("提示词调用片段已复制");
                }}
              >
                <Copy className="size-4" />
              </Button>
              {canManage ? (
                <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                  <Pencil className="size-3.5" />
                  编辑工具
                </Button>
              ) : null}
            </div>
          </div>
          <p className="text-muted-foreground bg-muted/50 mt-3 rounded-md p-3 text-xs leading-relaxed">
            {settings.promptSnippet}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-muted-foreground text-sm">
          <span className="text-foreground font-medium">{connectedCount}</span> / {rows.length}{" "}
          已连接
          {selected.size ? <span className="ml-2">已选择 {selected.size} 个智能体</span> : null}
        </div>
        {canManage ? (
          <Button
            size="sm"
            disabled={configureMutation.isPending || rows.length === 0}
            onClick={configure}
          >
            {configureMutation.isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <PlugZap className="size-4" />
            )}
            {selected.size ? "配置所选接入点" : "批量自动配置"}
          </Button>
        ) : null}
      </div>

      {rows.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {canManage ? (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={() =>
                        setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)))
                      }
                      aria-label="选择全部智能体"
                    />
                  </TableHead>
                ) : null}
                <TableHead>智能体</TableHead>
                <TableHead>接入点</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最近连接</TableHead>
                {canManage ? <TableHead className="text-right">操作</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const connection = connectionByAgent.get(row.id);
                const status = connection ? STATUS_META[connection.status] : null;
                return (
                  <TableRow key={row.id}>
                    {canManage ? (
                      <TableCell>
                        <Checkbox
                          checked={selected.has(row.id)}
                          disabled={row.detached}
                          onCheckedChange={() => toggleSelected(row.id)}
                          aria-label={`选择 ${row.name}`}
                        />
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <p className="font-medium">{row.name}</p>
                      {connection?.accountLabel ? (
                        <p className="text-muted-foreground text-xs">{connection.accountLabel}</p>
                      ) : null}
                      {row.detached ? (
                        <p className="text-muted-foreground text-xs">智能体已移除</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {connection ? (
                        <span className="text-muted-foreground font-mono text-xs">
                          {connection.endpointMasked}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">未配置</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {status ? (
                        <Badge variant={status.variant} title={connection?.lastError || undefined}>
                          {status.label}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">未配置</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatTime(connection?.lastConnectedAt || null)}
                    </TableCell>
                    {canManage ? (
                      <TableCell>
                        {connection ? (
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="重新连接"
                              disabled={Boolean(busyId)}
                              onClick={() =>
                                void runAction(connection.id, async () => {
                                  await reconnectMutation.mutateAsync(connection.id);
                                  toast.success(`${connection.agentName} 已开始重新连接`);
                                })
                              }
                            >
                              <RotateCw
                                className={
                                  busyId === connection.id ? "size-4 animate-spin" : "size-4"
                                }
                              />
                            </Button>
                            <Switch
                              checked={connection.enabled}
                              disabled={Boolean(busyId)}
                              title={connection.enabled ? "停用连接" : "启用连接"}
                              onCheckedChange={(enabled) =>
                                void runAction(connection.id, async () => {
                                  await toggleMutation.mutateAsync({
                                    connectionId: connection.id,
                                    enabled,
                                  });
                                  toast.success(
                                    enabled
                                      ? `${connection.agentName} 已启用`
                                      : `${connection.agentName} 已停用`,
                                  );
                                })
                              }
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              title="删除接入点"
                              disabled={Boolean(busyId)}
                              onClick={() => setDeleteTarget(connection)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border text-center">
          <Unplug className="text-muted-foreground size-7" />
          <p className="font-medium">
            {connectionsLoading ? "正在加载 MCP 连接" : "暂无可配置智能体"}
          </p>
          <p className="text-muted-foreground max-w-sm text-xs">
            在“设备管理”中绑定组织的 CubeCat 账号并同步智能体后，可以在这里批量配置 MCP 接入点。
          </p>
        </div>
      )}

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(next) => !next && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除 MCP 接入点</DialogTitle>
            <DialogDescription>
              删除后将停止「{deleteTarget?.agentName}」的课堂通知连接；可以随时重新自动配置。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={removeMutation.isPending}
              onClick={() => deleteTarget && removeMutation.mutate(deleteTarget.id)}
            >
              {removeMutation.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
              删除接入点
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {settings && settingsOpen ? (
        <McpSettingsDialog
          settings={settings}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}

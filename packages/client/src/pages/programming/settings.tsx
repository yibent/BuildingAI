import {
  type ProgrammingRuntimeTarget,
  useProjectSimulatorSessionsQuery,
  useUpdateProgrammingProjectMutation,
  useXiaozhiAgentsQuery,
} from "@buildingai/services/web";
import { Badge } from "@buildingai/ui/components/ui/badge";
import { Button } from "@buildingai/ui/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@buildingai/ui/components/ui/select";
import { Separator } from "@buildingai/ui/components/ui/separator";
import { Skeleton } from "@buildingai/ui/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@buildingai/ui/components/ui/toggle-group";
import { Cpu, MonitorPlay } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { useProgrammingProject } from "./context";

const APPLICATION_RUNTIME_ITEMS: Array<{
  value: ProgrammingRuntimeTarget;
  label: string;
  icon: typeof MonitorPlay;
}> = [
  { value: "simulator", label: "硬件仿真", icon: MonitorPlay },
  { value: "device", label: "CubeCat 设备", icon: Cpu },
];

export default function ProjectSettingsPage() {
  const project = useProgrammingProject();
  const navigate = useNavigate();
  const isApplication = project.projectType === "application";
  const sessionsQuery = useProjectSimulatorSessionsQuery(project.id, {
    enabled: isApplication,
  });
  const agentsQuery = useXiaozhiAgentsQuery({
    enabled: isApplication,
  });

  const updateMutation = useUpdateProgrammingProjectMutation({
    onSuccess: () => toast.success("设置已保存"),
    onError: (error) => toast.error(error.message || "设置保存失败"),
  });

  const pickCubeCatId = () =>
    project.xiaozhiAgentId ??
    agentsQuery.data?.find((agent) => agent.onlineDeviceCount > 0)?.id ??
    agentsQuery.data?.[0]?.id ??
    null;

  const handleRuntimeChange = (target: ProgrammingRuntimeTarget) => {
    if (target === project.runtimeTarget) return;

    if (target === "simulator") {
      updateMutation.mutate({
        id: project.id,
        dto: { runtimeTarget: "simulator" },
      });
      return;
    }

    if (target === "device") {
      const xiaozhiAgentId = pickCubeCatId();
      if (!xiaozhiAgentId) {
        toast.error("当前工作空间没有可用的 CubeCat 设备");
        return;
      }
      updateMutation.mutate({
        id: project.id,
        dto: { runtimeTarget: "device", xiaozhiAgentId, deviceId: null },
      });
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8 overflow-y-auto p-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">工程设置</h1>
        <p className="text-muted-foreground text-sm">配置工程运行的目标设备和运行环境</p>
      </div>

      <Separator />

      {isApplication ? (
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-sm font-medium">运行目标</h2>
            <p className="text-muted-foreground text-xs">
              Lua 模块、语音、视觉和设备控制会发到所选运行目标。CubeCat
              设备是真实硬件；硬件仿真只用于没有真机时试跑。
            </p>
          </div>

          <ToggleGroup
            type="single"
            value={project.runtimeTarget === "device" ? "device" : "simulator"}
            onValueChange={(value) =>
              value && handleRuntimeChange(value as ProgrammingRuntimeTarget)
            }
            variant="outline"
            size="sm"
            className="w-full justify-start"
            disabled={updateMutation.isPending}
          >
            {APPLICATION_RUNTIME_ITEMS.map(({ value, label, icon: Icon }) => (
              <ToggleGroupItem key={value} value={value} aria-label={label} className="flex-1">
                <Icon className="mr-1.5 size-4" />
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </section>
      ) : (
        <section className="space-y-1">
          <h2 className="text-sm font-medium">运行目标</h2>
          <p className="text-muted-foreground text-sm">对话流在服务端运行，不需要绑定 CubeCat。</p>
        </section>
      )}

      {/* 仿真会话选择 */}
      {isApplication && project.runtimeTarget === "simulator" && (
        <section className="space-y-4">
          <Separator />
          <div className="space-y-1">
            <h2 className="text-sm font-medium">仿真会话</h2>
            <p className="text-muted-foreground text-xs">
              选择用于仿真的硬件会话。需要在仿真页面创建会话后才能选择。
            </p>
          </div>

          {sessionsQuery.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : sessionsQuery.data && sessionsQuery.data.length > 0 ? (
            <Select
              value={project.simulatorSessionId ?? ""}
              onValueChange={(sessionId) =>
                updateMutation.mutate({
                  id: project.id,
                  dto: { runtimeTarget: "simulator", simulatorSessionId: sessionId },
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="选择仿真会话" />
              </SelectTrigger>
              <SelectContent>
                {sessionsQuery.data.map((session) => (
                  <SelectItem key={session.id} value={session.id}>
                    {session.name}
                    {session.id === project.simulatorSessionId ? "（当前）" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="space-y-2">
              <p className="text-muted-foreground text-sm">还没有仿真会话</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/programming/${project.id}/simulator`)}
              >
                去创建仿真会话
              </Button>
            </div>
          )}
        </section>
      )}

      {isApplication && (
        <section className="space-y-4">
          <Separator />
          <div className="space-y-1">
            <h2 className="text-sm font-medium">CubeCat 设备</h2>
            <p className="text-muted-foreground text-xs">
              选择这台应用要控制的 CubeCat。运行目标为 CubeCat 设备时，Lua
              模块会发到这台真实设备上执行。应用启动时会自动接通回传 MCP，不用在工程里单独配置。
            </p>
          </div>
          {agentsQuery.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : agentsQuery.data && agentsQuery.data.length > 0 ? (
            <Select
              value={project.xiaozhiAgentId ?? ""}
              onValueChange={(xiaozhiAgentId) =>
                updateMutation.mutate({
                  id: project.id,
                  dto: {
                    xiaozhiAgentId: xiaozhiAgentId || null,
                    ...(xiaozhiAgentId && project.runtimeTarget !== "simulator"
                      ? { runtimeTarget: "device" as const, deviceId: null }
                      : {}),
                  },
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="选择 CubeCat 设备" />
              </SelectTrigger>
              <SelectContent>
                {agentsQuery.data.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                    {agent.onlineDeviceCount > 0 ? (
                      <span className="text-muted-foreground text-xs"> · 在线</span>
                    ) : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-muted-foreground text-sm">当前工作空间没有可用的 CubeCat 设备</p>
          )}
        </section>
      )}

      {/* 工程信息 */}
      <Separator />
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">工程信息</h2>
          <p className="text-muted-foreground text-xs">工程的元数据和发布状态</p>
        </div>

        <div className="grid grid-cols-2 gap-4 rounded-lg border p-4">
          <div>
            <p className="text-muted-foreground text-xs">工程名称</p>
            <p className="text-sm font-medium">{project.name}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">工程类型</p>
            <p className="text-sm">{project.projectType === "application" ? "应用" : "对话流"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">发布状态</p>
            <Badge
              variant="outline"
              className={
                project.isPublished
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "text-muted-foreground"
              }
            >
              {project.isPublished ? "已发布" : "草稿"}
            </Badge>
          </div>
          {project.projectType === "application" && (
            <div>
              <p className="text-muted-foreground text-xs">Lua 模块</p>
              <p className="text-sm">{project.luaModuleCount} 个</p>
            </div>
          )}
          {project.projectType !== "application" && (
            <div>
              <p className="text-muted-foreground text-xs">工具</p>
              <p className="text-sm">{project.tools.length} 个</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

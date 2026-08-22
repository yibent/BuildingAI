import {
  useHomeAssistantInstanceQuery,
  useRemoveHomeAssistantInstanceMutation,
  useSyncHomeAssistantInstanceMutation,
  useUpsertHomeAssistantInstanceMutation,
  type HomeAssistantAuthMode,
} from "@buildingai/services/web";
import { Badge } from "@buildingai/ui/components/ui/badge";
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
import { useAlertDialog } from "@buildingai/ui/hooks/use-alert-dialog";
import { Home, Link2, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export function HomeAssistantSetting() {
  const { confirm } = useAlertDialog();
  const instanceQuery = useHomeAssistantInstanceQuery();
  const instance = instanceQuery.data;
  const [baseUrl, setBaseUrl] = useState("");
  const [label, setLabel] = useState("Home Assistant");
  const [authMode, setAuthMode] = useState<HomeAssistantAuthMode>("token");
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!instance) return;
    setBaseUrl(instance.baseUrl);
    setLabel(instance.label);
    setAuthMode(instance.authMode);
    setUsername(instance.username || "");
  }, [instance]);

  const upsert = useUpsertHomeAssistantInstanceMutation({
    onSuccess: (saved) => {
      setToken("");
      setPassword("");
      toast.success(`已连接 ${saved.locationName || "Home Assistant"}，同步 ${saved.deviceCount} 个设备`);
    },
    onError: (error) => toast.error(error.message || "连接 Home Assistant 失败"),
  });
  const sync = useSyncHomeAssistantInstanceMutation({
    onSuccess: (saved) => toast.success(`已同步 ${saved.deviceCount} 个设备`),
    onError: (error) => toast.error(error.message || "同步失败"),
  });
  const remove = useRemoveHomeAssistantInstanceMutation({
    onSuccess: () => {
      setBaseUrl("");
      setToken("");
      setUsername("");
      setPassword("");
      toast.success("已断开 Home Assistant");
    },
    onError: (error) => toast.error(error.message || "断开失败"),
  });

  const submit = () => {
    if (!baseUrl.trim()) {
      toast.error("请填写 Home Assistant 地址");
      return;
    }
    upsert.mutate({
      baseUrl: baseUrl.trim(),
      label: label.trim() || "Home Assistant",
      authMode,
      token: authMode === "token" ? token.trim() : undefined,
      username: authMode === "password" ? username.trim() : undefined,
      password: authMode === "password" ? password : undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">Home Assistant</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          推荐填写长期访问令牌。账号密码会走 HA 自己的登录流程，不支持 OAuth password grant。
        </p>
      </div>

      {instance ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-3 text-sm">
          <Home className="size-4" />
          <span className="font-medium">{instance.locationName || instance.label}</span>
          {instance.haVersion ? (
            <span className="text-muted-foreground">v{instance.haVersion}</span>
          ) : null}
          <Badge variant="outline" className="font-normal">
            {instance.deviceCount} 个设备
          </Badge>
          <Badge
            variant="outline"
            className={
              instance.status === "active"
                ? "border-emerald-300 text-emerald-700"
                : "text-destructive"
            }
          >
            {instance.status === "active"
              ? "已连接"
              : instance.status === "auth_error"
                ? "登录失效"
                : "同步异常"}
          </Badge>
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>地址</Label>
          <Input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="http://192.168.1.10:8123"
          />
        </div>
        <div className="space-y-2">
          <Label>备注</Label>
          <Input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} />
        </div>
        <div className="space-y-2">
          <Label>认证方式</Label>
          <Select
            value={authMode}
            onValueChange={(value) => setAuthMode(value as HomeAssistantAuthMode)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="token">长期访问令牌</SelectItem>
              <SelectItem value="password">账号密码</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {authMode === "token" ? (
          <div className="space-y-2">
            <Label>长期访问令牌</Label>
            <Input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={
                instance ? "留空则保持当前令牌；填写则替换" : "HA 个人资料 → 长期访问令牌"
              }
            />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label>用户名</Label>
              <Input value={username} onChange={(event) => setUsername(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>密码</Label>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={instance ? "重新连接时需要再次输入" : ""}
              />
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={submit} disabled={upsert.isPending}>
          {upsert.isPending ? <LoaderCircle className="animate-spin" /> : <Link2 />}
          {instance ? "重新连接并同步" : "连接并同步"}
        </Button>
        {instance ? (
          <>
            <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
              {sync.isPending ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
              同步设备
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                const ok = await confirm({
                  title: "断开 Home Assistant？",
                  description: "本地保存的设备快照会一并删除，工作流里已勾选的家居工具也会失效。",
                  confirmVariant: "destructive",
                });
                if (ok) remove.mutate();
              }}
              disabled={remove.isPending}
            >
              <Trash2 />
              断开
            </Button>
          </>
        ) : null}
      </div>

      {instance?.lastError ? (
        <p className="text-destructive text-sm">{instance.lastError}</p>
      ) : null}
    </div>
  );
}

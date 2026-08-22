import {
  useImportXiaomiHomeCredentialsMutation,
  useRemoveXiaomiHomeAccountMutation,
  useStartXiaomiHomeOAuthMutation,
  useSyncXiaomiHomeAccountMutation,
  useUpdateXiaomiHomeAccountMutation,
  useXiaomiHomeAccountsQuery,
  XIAOMI_HOME_SERVERS,
  type XiaomiHomeAccount,
  type XiaomiHomeOAuthStart,
  type XiaomiHomeServer,
} from "@buildingai/services/web";
import { Alert, AlertDescription, AlertTitle } from "@buildingai/ui/components/ui/alert";
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
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@buildingai/ui/components/ui/empty";
import { Input } from "@buildingai/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@buildingai/ui/components/ui/select";
import { Skeleton } from "@buildingai/ui/components/ui/skeleton";
import { Textarea } from "@buildingai/ui/components/ui/textarea";
import { useAlertDialog } from "@buildingai/ui/hooks/use-alert-dialog";
import { cn } from "@buildingai/ui/lib/utils";
import {
  Check,
  CircleAlert,
  CircleCheck,
  Cloud,
  Copy,
  HousePlug,
  Pencil,
  Plus,
  RefreshCw,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { SettingItem, SettingItemGroup } from "../setting-item";
import { YeelightProSetting } from "./yeelight-pro-setting";

function formatDate(value: string | null | undefined): string {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AccountStatus({ account }: { account: XiaomiHomeAccount }) {
  const healthy = account.status === "active";
  return (
    <Badge variant="outline" className={cn(healthy && "text-emerald-600")}>
      {healthy ? <CircleCheck /> : <CircleAlert />}
      {healthy ? "连接正常" : account.status === "auth_error" ? "授权已失效" : "同步异常"}
    </Badge>
  );
}

export function XiaomiHomeSetting() {
  const { confirm } = useAlertDialog();
  const [cloudServer, setCloudServer] = useState<XiaomiHomeServer>("cn");
  const [editingAccount, setEditingAccount] = useState<XiaomiHomeAccount | null>(null);
  const [accountLabel, setAccountLabel] = useState("");
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [localTokenStart, setLocalTokenStart] = useState<XiaomiHomeOAuthStart | null>(null);
  const [localTokenCloudServer, setLocalTokenCloudServer] = useState<XiaomiHomeServer>("cn");
  const [localCredentials, setLocalCredentials] = useState("");
  const [localCommandCopied, setLocalCommandCopied] = useState(false);
  const oauthWindowRef = useRef<Window | null>(null);

  const accountsQuery = useXiaomiHomeAccountsQuery();
  const accounts = accountsQuery.data || [];
  const startOAuthMutation = useStartXiaomiHomeOAuthMutation();
  const importCredentialsMutation = useImportXiaomiHomeCredentialsMutation({
    onSuccess: () => {
      setLocalTokenStart(null);
      setLocalCredentials("");
      toast.success("小米账号已导入并完成同步");
    },
    onError: (error) => toast.error(error.message || "小米凭据导入失败"),
  });
  const syncMutation = useSyncXiaomiHomeAccountMutation({
    onSuccess: () => toast.success("家庭与设备已同步"),
    onError: (error) => toast.error(error.message || "同步失败"),
  });
  const updateMutation = useUpdateXiaomiHomeAccountMutation({
    onSuccess: () => {
      setEditingAccount(null);
      toast.success("账号名称已更新");
    },
    onError: (error) => toast.error(error.message || "账号名称更新失败"),
  });
  const removeMutation = useRemoveXiaomiHomeAccountMutation({
    onSuccess: () => toast.success("小米账号已解绑"),
    onError: (error) => toast.error(error.message || "账号解绑失败"),
  });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data as
        | { type?: string; success?: boolean; message?: string }
        | undefined;
      if (!message || message.type !== "buildingai:xiaomi-home-oauth") return;
      if (oauthWindowRef.current && event.source !== oauthWindowRef.current) return;
      oauthWindowRef.current = null;
      if (message.success) {
        void accountsQuery.refetch();
        toast.success(message.message || "小米账号已连接");
      } else {
        toast.error(message.message || "小米账号授权失败");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [accountsQuery]);

  const connectAccount = async () => {
    const popup = window.open(
      "about:blank",
      "buildingai-xiaomi-home-oauth",
      "popup,width=520,height=720,resizable=yes,scrollbars=yes",
    );
    if (!popup) {
      toast.error("浏览器阻止了授权窗口，请允许弹出窗口后重试");
      return;
    }
    oauthWindowRef.current = popup;
    try {
      const result = await startOAuthMutation.mutateAsync({ cloudServer, mode: "direct" });
      if (result.mode === "local_token") {
        popup.close();
        oauthWindowRef.current = null;
        setLocalTokenCloudServer(result.cloudServer);
        setLocalTokenStart(result);
        setLocalCredentials("");
        setLocalCommandCopied(false);
        toast.success("当前小米 client 需要本地脚本登录，请按下方命令完成授权");
        return;
      }
      popup.location.href = result.authorizationUrl;
    } catch (error) {
      popup.close();
      oauthWindowRef.current = null;
      toast.error(error instanceof Error ? error.message : "无法发起小米账号授权");
    }
  };

  const startLocalTokenLogin = async () => {
    try {
      const result = await startOAuthMutation.mutateAsync({
        cloudServer,
        mode: "local_token",
      });
      setLocalTokenCloudServer(result.cloudServer);
      setLocalTokenStart(result);
      setLocalCredentials("");
      setLocalCommandCopied(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法生成本地登录命令");
    }
  };

  const localTokenCommand = localTokenStart
    ? `pnpm xiaomi-home:oauth-token -- ${JSON.stringify(localTokenStart.authorizationUrl)} ${localTokenCloudServer}`
    : "";

  const copyLocalTokenCommand = async () => {
    if (!localTokenCommand) return;
    try {
      await navigator.clipboard.writeText(localTokenCommand);
      setLocalCommandCopied(true);
      toast.success("本地登录命令已复制");
    } catch {
      toast.error("复制失败，请手动复制命令");
    }
  };

  const syncAccount = async (accountId: string) => {
    setSyncingId(accountId);
    try {
      await syncMutation.mutateAsync(accountId);
    } finally {
      setSyncingId(null);
    }
  };

  const removeAccount = async (account: XiaomiHomeAccount) => {
    try {
      await confirm({
        title: "解绑小米账号？",
        description: `解绑“${account.label}”后，该账号下已同步的家庭和设备会从系统中移除。`,
        confirmText: "确认解绑",
        confirmVariant: "destructive",
      });
    } catch {
      return;
    }
    setRemovingId(account.id);
    try {
      await removeMutation.mutateAsync(account.id);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <YeelightProSetting />
      <SettingItemGroup label="连接新账号">
        <SettingItem
          icon={<Cloud className="size-5" />}
          title="小米账号"
          description="测试登录会在前端生成一条命令。请在本机 BuildingAI 源码仓库根目录执行，浏览器会在那台电脑上打开；完成后把凭据贴回这里。"
          className="flex-col items-stretch gap-3 sm:flex-row sm:items-center"
          contentClassName="min-w-0"
        >
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Select
              value={cloudServer}
              onValueChange={(value) => setCloudServer(value as XiaomiHomeServer)}
            >
              <SelectTrigger className="bg-background w-full sm:w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {XIAOMI_HOME_SERVERS.map((server) => (
                  <SelectItem key={server.value} value={server.value}>
                    {server.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              onClick={() => void startLocalTokenLogin()}
              loading={startOAuthMutation.isPending}
            >
              <TerminalSquare />
              生成本地登录命令
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void connectAccount()}
              loading={startOAuthMutation.isPending}
            >
              <Plus />
              官方授权
            </Button>
          </div>
        </SettingItem>
      </SettingItemGroup>

      <SettingItemGroup label="已连接账号">
        {accountsQuery.isLoading ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : accountsQuery.isError ? (
          <div className="p-4">
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>账号信息加载失败</AlertTitle>
              <AlertDescription className="flex items-center justify-between gap-3">
                <span>请检查网络连接后重试。</span>
                <Button variant="outline" size="sm" onClick={() => accountsQuery.refetch()}>
                  <RefreshCw />
                  重试
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : accounts.length ? (
          accounts.map((account) => (
            <SettingItem
              key={account.id}
              icon={
                <span className="bg-background flex size-9 items-center justify-center rounded-md border">
                  <HousePlug className="size-4" />
                </span>
              }
              title={
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{account.label}</span>
                  <AccountStatus account={account} />
                </div>
              }
              description={`${account.cloudServerLabel} · ${account.deviceCount} 台设备，${account.onlineDeviceCount} 台在线`}
              extra={
                account.lastError
                  ? `最近错误：${account.lastError}`
                  : `最近同步：${formatDate(account.lastSyncAt)}`
              }
              className="flex-col items-stretch gap-3 py-4 sm:flex-row sm:items-center"
              contentClassName="min-w-0 flex-1"
            >
              <div className="flex w-full items-center justify-end gap-1 sm:w-auto">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void syncAccount(account.id)}
                  disabled={syncMutation.isPending}
                  aria-label={`同步${account.label}`}
                  title="同步家庭与设备"
                >
                  <RefreshCw className={cn(syncingId === account.id && "animate-spin")} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    setEditingAccount(account);
                    setAccountLabel(account.label);
                  }}
                  aria-label={`修改${account.label}的名称`}
                  title="修改名称"
                >
                  <Pencil />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => void removeAccount(account)}
                  disabled={removeMutation.isPending}
                  aria-label={`解绑${account.label}`}
                  title="解绑账号"
                >
                  <Trash2 className={cn(removingId === account.id && "animate-pulse")} />
                </Button>
              </div>
            </SettingItem>
          ))
        ) : (
          <Empty className="min-h-52 border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HousePlug />
              </EmptyMedia>
              <EmptyTitle>尚未连接小米账号</EmptyTitle>
              <EmptyDescription>
                选择云区后点「生成本地登录命令」，在本机源码仓库执行，再把凭据贴回来。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </SettingItemGroup>

      <Dialog
        open={Boolean(editingAccount)}
        onOpenChange={(open) => !open && setEditingAccount(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>修改账号名称</DialogTitle>
            <DialogDescription>名称只用于在 BuildingAI 中区分不同的小米账号。</DialogDescription>
          </DialogHeader>
          <Input
            value={accountLabel}
            onChange={(event) => setAccountLabel(event.target.value)}
            maxLength={80}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter" && editingAccount && accountLabel.trim()) {
                updateMutation.mutate({ accountId: editingAccount.id, label: accountLabel.trim() });
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingAccount(null)}>
              取消
            </Button>
            <Button
              loading={updateMutation.isPending}
              disabled={!accountLabel.trim()}
              onClick={() =>
                editingAccount &&
                updateMutation.mutate({ accountId: editingAccount.id, label: accountLabel.trim() })
              }
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(localTokenStart)}
        onOpenChange={(open) => {
          if (!open) {
            setLocalTokenStart(null);
            setLocalCredentials("");
            setLocalCommandCopied(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>使用本地脚本登录小米账号</DialogTitle>
            <DialogDescription>
              即使当前页面是远程 IP 打开的，下面这条命令也必须在有 BuildingAI
              源码的电脑上执行。脚本会在那台电脑上占用 8123 端口并打开浏览器。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Alert>
              <TerminalSquare />
              <AlertTitle>第一步：在本机源码仓库执行</AlertTitle>
              <AlertDescription>
                打开本机 BuildingAI
                项目根目录，粘贴并运行下面的命令。随后在弹出的浏览器里登录小米账号并授权。
              </AlertDescription>
            </Alert>
            <div className="relative">
              <Textarea
                readOnly
                value={localTokenCommand}
                rows={3}
                className="pr-12 font-mono text-xs leading-5"
                aria-label="本地小米登录命令"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="absolute top-2 right-2"
                onClick={() => void copyLocalTokenCommand()}
                aria-label="复制本地登录命令"
                title={localCommandCopied ? "已复制" : "复制命令"}
              >
                {localCommandCopied ? <Check /> : <Copy />}
              </Button>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">第二步：把本地页面生成的 JSON 贴回这里</div>
              <Textarea
                value={localCredentials}
                onChange={(event) => setLocalCredentials(event.target.value)}
                rows={8}
                spellCheck={false}
                placeholder="粘贴本地页面生成的完整 JSON"
                className="font-mono text-xs leading-5"
                aria-label="小米本地登录凭据"
              />
              <p className="text-muted-foreground text-xs leading-5">
                登录完成后浏览器会显示一次性凭据。复制完整 JSON 贴到此处即可，不需要把 token
                发到别处。
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLocalTokenStart(null)}>
              取消
            </Button>
            <Button
              onClick={() => importCredentialsMutation.mutate(localCredentials.trim())}
              loading={importCredentialsMutation.isPending}
              disabled={!localCredentials.trim()}
            >
              <Check />
              导入并同步
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

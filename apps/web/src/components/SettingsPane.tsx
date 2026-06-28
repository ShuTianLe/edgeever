import { useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck, Trash2, ChevronLeft, Plus, User, Image, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/utils";
import { AppConfirmDialog } from "./dialogs/ConfirmDialogs";
import type { ApiToken, AuthUser } from "@edgeever/shared";

const DEFAULT_TOKEN_SCOPES = ["read:notebooks", "read:memos", "read:tags"];

interface SettingsPaneProps {
  user: AuthUser | null;
  onClose: () => void;
  imageCompressionEnabled: boolean;
  onImageCompressionChange: (enabled: boolean) => void;
  onLogout: () => void;
  isLoggingOut: boolean;
  authRequired: boolean;
}

export const SettingsPane = ({
  user,
  onClose,
  imageCompressionEnabled,
  onImageCompressionChange,
  onLogout,
  isLoggingOut,
  authRequired,
}: SettingsPaneProps) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState("MCP Agent");
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(() => new Set(DEFAULT_TOKEN_SCOPES));
  const [createdToken, setCreatedToken] = useState<{ token: string; apiToken: ApiToken } | null>(null);
  const [tokenRevokeConfirmation, setTokenRevokeConfirmation] = useState<ApiToken | null>(null);

  const tokensQuery = useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => api.listApiTokens(),
  });

  const availableScopes = tokensQuery.data?.availableScopes ?? [
    "read:notebooks",
    "write:notebooks",
    "read:memos",
    "write:memos",
    "read:resources",
    "write:resources",
    "read:tags",
    "write:tags",
  ];

  const createMutation = useMutation({
    mutationFn: api.createApiToken,
    onSuccess: async (data) => {
      setCreatedToken(data);
      setName("");
      setSelectedScopes(new Set(DEFAULT_TOKEN_SCOPES));
      await queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: api.revokeApiToken,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });

  const tokens = tokensQuery.data?.apiTokens ?? [];

  const toggleScope = (scope: string) => {
    setSelectedScopes((current) => {
      const next = new Set(current);
      if (next.has(scope)) {
        next.delete(scope);
      } else {
        next.add(scope);
      }
      return next;
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const scopes = Array.from(selectedScopes);

    if (!name.trim() || scopes.length === 0) {
      return;
    }

    createMutation.mutate({ name: name.trim(), scopes });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex h-[calc(4rem+env(safe-area-inset-top))] shrink-0 items-end justify-between border-b border-slate-200 px-6 pb-3 pt-[env(safe-area-inset-top)] lg:h-16 lg:items-center lg:pb-0 lg:pt-0">
        <div className="flex items-center gap-3">
          <Button
            size="icon"
            variant="ghost"
            title="返回编辑器"
            aria-label="返回编辑器"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-slate-100"
          >
            <ChevronLeft className="h-5 w-5 text-slate-500" />
          </Button>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-base font-bold text-slate-900 leading-tight">
              <User className="h-4.5 w-4.5 text-emerald-700" />
              个人中心 & 设置
            </h1>
            <p className="mt-0.5 text-[10px] font-medium text-slate-400 uppercase tracking-wider">
              管理个人偏好设置、第三方 API 凭证及登录会话
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Section 1: User Profile */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#809f75] to-[#526d49] text-xl font-bold text-white uppercase shadow-md">
              {user?.username?.charAt(0) ?? "U"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base font-bold text-slate-800">{user?.username ?? "本地用户"}</div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400 font-medium">
                <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block"></span>
                在线工作区已连接
              </div>
            </div>
          </div>

          {/* Section 2: Preferences */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Image className="h-4.5 w-4.5 text-emerald-700" />
              偏好设置
            </h2>
            <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-slate-50/60 border border-slate-100">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800">压缩笔记内图片</div>
                <div className="text-xs text-slate-400 mt-0.5">上传大图时在本地进行无损或有损压缩以节省资源占用</div>
              </div>
              <Switch
                checked={imageCompressionEnabled}
                onCheckedChange={onImageCompressionChange}
                aria-label="是否压缩笔记内图片"
              />
            </div>
          </div>

          {/* Section 3: API & MCP */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-5">
            <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <KeyRound className="h-4.5 w-4.5 text-emerald-700" />
              API & MCP 授权设置
            </h2>

            {createdToken && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 shadow-sm animate-fade-in">
                <div className="mb-2 flex items-center gap-2 text-sm font-bold text-emerald-900">
                  <ShieldCheck className="h-5 w-5 text-emerald-700" />
                  API Token 已成功生成
                </div>
                <div className="flex gap-2">
                  <Input
                    className="min-w-0 flex-1 rounded-lg border-emerald-200 font-mono text-xs focus-visible:ring-emerald-500/20"
                    readOnly
                    value={createdToken.token}
                  />
                  <Button
                    size="md"
                    variant="solid"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(createdToken.token)}
                  >
                    复制 Token
                  </Button>
                </div>
                <p className="mt-2 text-xs font-medium text-emerald-800">
                  ⚠️ 安全警告：明文 Token 仅在此处展示一次，关闭后将无法再次找回！
                </p>
              </div>
            )}

            <form className="space-y-4 rounded-lg bg-slate-50/60 border border-slate-100 p-4" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  className="min-w-0 flex-1 rounded-lg focus-visible:ring-4 focus-visible:ring-[#627f58]/10"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Token 用途描述，例如: Cline Agent"
                />
                <Button 
                  size="md" 
                  variant="solid" 
                  className="h-10 bg-[#627f58] hover:bg-[#526d49] text-white shrink-0"
                  type="submit" 
                  disabled={createMutation.isPending}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  生成 Token
                </Button>
              </div>

              <div className="space-y-2">
                <span className="block text-xs font-semibold text-slate-500">选择 Scope 权限范围：</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {availableScopes.map((scope) => (
                    <label
                      key={scope}
                      className={cn(
                        "flex min-h-9 items-center gap-3 rounded-lg border px-3 py-1 cursor-pointer transition-all duration-150",
                        selectedScopes.has(scope)
                          ? "border-[#627f58]/30 bg-[#f3f7f1]/50 text-[#526d49]"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50/50"
                      )}
                    >
                      <Checkbox
                        checked={selectedScopes.has(scope)}
                        onCheckedChange={() => toggleScope(scope)}
                        className="border-emerald-300"
                      />
                      <span className="min-w-0 truncate font-mono text-[11px] font-semibold">{scope}</span>
                    </label>
                  ))}
                </div>
              </div>
            </form>

            <div className="space-y-3">
              <span className="block text-xs font-semibold text-slate-500">活跃的 Token 列表：</span>
              {tokensQuery.isLoading ? (
                <div className="py-8 text-center text-sm text-slate-400">正在加载 Token 列表...</div>
              ) : tokens.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
                  暂无活跃的 API Token
                </div>
              ) : (
                tokens.map((token) => (
                  <div
                    key={token.id}
                    className={cn(
                      "flex min-h-16 items-center gap-4 rounded-xl border p-4 transition-all duration-200",
                      token.isRevoked ? "border-slate-100 bg-slate-50/50 opacity-60" : "border-slate-200 bg-white hover:border-slate-300"
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-slate-800 leading-tight">{token.name}</span>
                      <span className="mt-2 block truncate font-mono text-[10px] font-semibold text-slate-500 bg-slate-50 px-2 py-1 rounded w-fit border border-slate-100">
                        {token.scopes.join(", ") || "no scopes"}
                      </span>
                      <span className="mt-2 block text-[10px] font-medium text-slate-400">
                        {token.lastUsedAt ? `上次调用时间：${formatDateTime(token.lastUsedAt)}` : "从未被调用"}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="danger"
                      className="shrink-0"
                      disabled={token.isRevoked || revokeMutation.isPending}
                      onClick={() => setTokenRevokeConfirmation(token)}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      撤销
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Section 4: System / Danger zone */}
          {authRequired && (
            <div className="rounded-xl border border-rose-100 bg-rose-50/30 p-5 shadow-sm">
              <h2 className="text-sm font-bold text-rose-900 mb-3 flex items-center gap-2">
                <LogOut className="h-4.5 w-4.5 text-rose-700" />
                会话管理
              </h2>
              <p className="text-xs text-slate-400 mb-4">退出登录将清理您在这台设备上的本地 session 状态。</p>
              <Button
                size="md"
                variant="danger"
                className="bg-rose-600 hover:bg-rose-700 text-white font-semibold shadow-sm"
                disabled={isLoggingOut}
                onClick={onLogout}
              >
                <LogOut className="h-4 w-4 mr-1.5" />
                {isLoggingOut ? "安全退出中..." : "退出登录"}
              </Button>
            </div>
          )}
        </div>
      </div>

      {tokenRevokeConfirmation && (
        <AppConfirmDialog
          title={`确定要撤销 Token「${tokenRevokeConfirmation.name}」吗？`}
          description="撤销操作不可逆。一旦撤销，使用此 Token 进行 API 或 MCP 调用的一切客户端将立即失效并被拒绝访问。"
          confirmLabel="确认撤销"
          isWorking={revokeMutation.isPending}
          tone="danger"
          onCancel={() => setTokenRevokeConfirmation(null)}
          onConfirm={() => {
            revokeMutation.mutate(tokenRevokeConfirmation.id, {
              onSuccess: () => setTokenRevokeConfirmation(null),
            });
          }}
        />
      )}
    </div>
  );
};

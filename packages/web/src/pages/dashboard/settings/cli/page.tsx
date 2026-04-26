import { Cloud, Key, Loader2, Terminal, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ApiToken {
  id: number;
  name: string | null;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

interface ApiTokenRow {
  id: number;
  name: string | null;
  token_prefix: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

function normalize(row: ApiTokenRow): ApiToken {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix ?? "",
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
  };
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CliTokensPage() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pendingRevoke, setPendingRevoke] = useState<ApiToken | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/auth/tokens", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { tokens: ApiTokenRow[] };
      setTokens((data.tokens ?? []).map(normalize));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tokens");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const handleRevoke = async () => {
    if (!pendingRevoke) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      const res = await fetch(`/api/auth/tokens/${pendingRevoke.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setTokens((prev) => prev.filter((t) => t.id !== pendingRevoke.id));
      setPendingRevoke(null);
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : "撤销失败");
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl" data-testid="cli-page">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight font-display">
          CLI
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          <code className="rounded bg-secondary px-1 py-0.5 text-xs">
            @nocoo/pika
          </code>{" "}
          是 AI 助手与脚本访问 Pika 的命令行入口
        </p>
      </div>

      {/* Card 1: Install & Usage */}
      <section
        className="rounded-[var(--radius-card)] bg-secondary p-6"
        data-testid="cli-install-card"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Terminal className="h-5 w-5 text-primary" strokeWidth={1.5} />
          </div>
          <div>
            <h2 className="font-semibold">安装与使用</h2>
            <p className="text-sm text-muted-foreground">
              只需 Bun 运行时，无需额外配置
            </p>
          </div>
        </div>
        <Separator className="mb-4" />
        <div className="space-y-4 text-sm">
          <div>
            <p className="mb-2 font-medium">1. 安装</p>
            <pre className="overflow-x-auto rounded-md bg-background p-3 text-xs">
              <code>bun add -g @nocoo/pika</code>
            </pre>
            <p className="mt-1 text-xs text-muted-foreground">
              或临时使用：
              <code className="rounded bg-background px-1">
                bunx @nocoo/pika
              </code>
            </p>
          </div>
          <div>
            <p className="mb-2 font-medium">2. 登录（浏览器铸 token）</p>
            <pre className="overflow-x-auto rounded-md bg-background p-3 text-xs">
              <code>pika login</code>
            </pre>
          </div>
          <div>
            <p className="mb-2 font-medium">3. 验证身份</p>
            <pre className="overflow-x-auto rounded-md bg-background p-3 text-xs">
              <code>pika whoami</code>
            </pre>
          </div>
          <div>
            <p className="mb-2 font-medium">4. 业务命令</p>
            <pre className="overflow-x-auto rounded-md bg-background p-3 text-xs">
              <code>{`pika upload
pika --help`}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* Card 2: Auth */}
      <section
        className="rounded-[var(--radius-card)] bg-secondary p-6"
        data-testid="cli-auth-card"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
            <Cloud className="h-5 w-5 text-blue-500" strokeWidth={1.5} />
          </div>
          <div>
            <h2 className="font-semibold">认证机制</h2>
            <p className="text-sm text-muted-foreground">
              单域名：登录入口与数据面共用 pika.hexly.ai
            </p>
          </div>
        </div>
        <Separator className="mb-4" />
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-medium">域名职责</p>
            <ul className="mt-2 space-y-2 text-muted-foreground">
              <li>
                <code className="rounded bg-background px-1 text-foreground">
                  pika.hexly.ai
                </code>
                ：Cloudflare Access (Google OAuth) 保护的铸 token 入口；
                <code className="rounded bg-background px-1 text-foreground">
                  pika login
                </code>{" "}
                走这里
              </li>
              <li>
                CLI 上传与查询命令均走同域名，Bearer token 由 web-worker
                统一校验
              </li>
            </ul>
          </div>
          <div>
            <p className="font-medium">配置文件位置</p>
            <p className="mt-1 text-muted-foreground">
              <code className="rounded bg-background px-1 text-foreground">
                ~/.config/pika/config.json
              </code>{" "}
              保存默认 API URL 与已铸的 token
            </p>
          </div>
        </div>
      </section>

      {/* Card 3: Token Management */}
      <section
        className="rounded-[var(--radius-card)] bg-secondary p-6"
        data-testid="cli-tokens-card"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10">
            <Key className="h-5 w-5 text-orange-500" strokeWidth={1.5} />
          </div>
          <div>
            <h2 className="font-semibold">Token 管理</h2>
            <p className="text-sm text-muted-foreground">
              查看和撤销当前账号下的所有 API token
            </p>
          </div>
        </div>
        <Separator className="mb-4" />

        {loading && (
          <div className="flex flex-col gap-2" data-testid="cli-tokens-loading">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={`cli-skeleton-${i}`} className="h-10 rounded-md" />
            ))}
          </div>
        )}

        {!loading && error && (
          <p
            className="text-sm text-destructive"
            role="alert"
            data-testid="cli-tokens-error"
          >
            加载失败：{error}
          </p>
        )}

        {!loading && !error && tokens.length === 0 && (
          <div
            className="rounded-[var(--radius-card)] border border-dashed bg-background p-6 text-center text-sm text-muted-foreground"
            data-testid="cli-tokens-empty"
          >
            暂无 token，请在终端运行{" "}
            <code className="rounded bg-secondary px-1 text-foreground">
              pika login
            </code>{" "}
            铸造首个 token
          </div>
        )}

        {!loading && !error && tokens.length > 0 && (
          <div className="overflow-x-auto" data-testid="cli-tokens-list">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>前缀</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>最后使用</TableHead>
                  <TableHead>过期时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((t) => (
                  <TableRow key={t.id} data-testid={`cli-token-row-${t.id}`}>
                    <TableCell>{t.name ?? "—"}</TableCell>
                    <TableCell>
                      <code className="rounded bg-background px-1 text-xs">
                        {t.tokenPrefix}…
                      </code>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(t.createdAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(t.lastUsedAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(t.expiresAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingRevoke(t)}
                        data-testid={`cli-token-revoke-${t.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">撤销 token</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          新 token 通过{" "}
          <code className="rounded bg-background px-1 text-foreground">
            pika login
          </code>{" "}
          浏览器流自动铸造，本页面不提供创建按钮
        </p>
      </section>

      <Dialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingRevoke(null);
            setRevokeError(null);
          }
        }}
      >
        <DialogContent data-testid="cli-revoke-dialog">
          <DialogHeader>
            <DialogTitle>确认撤销 token？</DialogTitle>
            <DialogDescription>
              撤销后使用此 token 的 CLI 或脚本将立即无法访问 API，且不可恢复。
              {pendingRevoke && (
                <span className="mt-2 block">
                  目标：
                  <code className="ml-1 rounded bg-secondary px-1 text-foreground">
                    {pendingRevoke.name ?? `${pendingRevoke.tokenPrefix}…`}
                  </code>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {revokeError && (
            <p
              className="text-sm text-destructive"
              role="alert"
              data-testid="cli-revoke-error"
            >
              {revokeError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={revoking}
              onClick={() => {
                setPendingRevoke(null);
                setRevokeError(null);
              }}
              data-testid="cli-revoke-cancel"
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={revoking}
              onClick={(e) => {
                e.preventDefault();
                void handleRevoke();
              }}
              data-testid="cli-revoke-confirm"
            >
              {revoking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              撤销
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

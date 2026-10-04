/**
 * dsh-mcp-servers — 设置页「MCP 服务器」主组件（列表 + 编辑两视图）。
 *
 * 数据面：GET /servers 纯读快照 + SSE summary 帧驱动刷新（watchdog + 降级
 * 轮询，移动端半开自愈，语义对齐原浮窗客户端）；操作面：增删改/启停/探活
 * 走 REST，中间层模式走 POST /config 热切换。
 * 组件由宿主 React 渲染（settings.section 槽位），React 经 factory require 注入。
 */
import * as React from "react";
import { api } from "../core/api.ts";
import { API } from "../core/constants.ts";
import { t } from "../../../../../shared/client/i18n.js";
import { rebindSession, type SharedSessionState } from "../core/session.ts";
import { ListView } from "./ListView.tsx";
import { EditView } from "./EditView.tsx";

/** 单台服务器快照（宿主 summarize 投影）。 */
export interface ServerRow {
  name: string;
  transport: "stdio" | "streamable-http";
  scope: string;
  status: string;
  enabled?: boolean;
  error?: string;
  tools?: string[];
  disabledTools?: string[];
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  toolCallTimeoutMs?: number;
  description?: string;
}

/** GET /servers 快照。 */
export interface Summary {
  projectRoot?: string;
  servers: ServerRow[];
  counts: Record<string, number>;
  middlewareMode: string;
}

export type PageView = { mode: "edit"; server: ServerRow } | { mode: "create" } | null;

/** SSE watchdog：60s 无任何帧判定半开，关旧建新。 */
const WATCHDOG_MS = 60_000;

export function McpServersPage(props: { ctx: any; shared: SharedSessionState }): any {
  const { shared } = props;
  const [summary, setSummary] = React.useState(null as Summary | null);
  const [middleware, setMiddleware] = React.useState("project" as string);
  const [error, setError] = React.useState("" as string);
  const [view, setView] = React.useState(null as PageView);
  const [mounted, setMounted] = React.useState(false);

  // refresh 经 ref 供 SSE/visibility 回调取最新闭包（避免重挂 EventSource）。
  const refreshRef = React.useRef(() => {});
  const refresh = React.useCallback((): Promise<void> => {
    return api(API.servers)
      .then((s: any) => {
        if (s !== null && typeof s === "object") {
          setSummary(s);
          if (typeof s.middlewareMode === "string") setMiddleware(s.middlewareMode);
          setError("");
        }
      })
      .catch((e: any) => setError(t("loadFail", { msg: String(e?.message ?? e) })));
  }, []);
  refreshRef.current = () => void refresh();

  React.useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  React.useEffect(() => {
    if (mounted === false) return;
    void refresh();
    // SSE 订阅（页面打开期间）：summary 帧 → 刷新；连续 CLOSED 3 次降级 10s
    // 轮询并周期探测恢复；60s 无帧 watchdog 关旧建新；回前台强制重建 + 补拉。
    let es: EventSource | undefined;
    let disposed = false;
    let failures = 0;
    let polling = false;
    let pollTimer: any;
    let watchdog: any;
    let lastActivity = Date.now();
    const closeEvents = () => {
      if (es === undefined) return;
      try {
        es.close();
      } catch {
        // 已关闭
      }
      es = undefined;
    };
    const scheduleRefresh = () => {
      void refresh();
    };
    const armWatchdog = () => {
      if (watchdog !== undefined) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (Date.now() - lastActivity > WATCHDOG_MS) connect();
        else armWatchdog();
      }, WATCHDOG_MS + 5000);
    };
    const startPolling = () => {
      polling = true;
      if (pollTimer !== undefined) return;
      let ticks = 0;
      const tick = () => {
        pollTimer = setTimeout(() => {
          void refresh();
          ticks += 1;
          if (ticks % 5 === 0) {
            // 恢复探测：成功重建即退出轮询（页面失联自愈）。
            polling = false;
            clearTimeout(pollTimer);
            pollTimer = undefined;
            failures = 0;
            connect();
            return;
          }
          tick();
        }, 10_000);
      };
      tick();
    };
    const connect = () => {
      if (disposed || polling) return;
      closeEvents();
      try {
        es = new EventSource(API.events);
        lastActivity = Date.now();
        es.onopen = () => {
          // 连接建立（初始/自动重连）即核对宿主会话状态：宿主 dsh web 重启而
          // 页面始终可见时，重连成功就是宿主状态丢失信号（projectRoot 清空）。
          maybeRecoverSession();
        };
        es.onmessage = (ev: MessageEvent) => {
          lastActivity = Date.now();
          let msg: any;
          try {
            msg = JSON.parse(String(ev.data));
          } catch {
            msg = undefined;
          }
          if (msg?.type === "ping") return;
          scheduleRefresh();
        };
        es.onerror = () => {
          if (es !== undefined && es.readyState === EventSource.CLOSED) {
            failures += 1;
            if (failures >= 3) {
              closeEvents();
              startPolling();
            }
          }
        };
        armWatchdog();
      } catch {
        startPolling();
      }
    };
    // #412 复报：宿主重启后 projectRoot/中间层单元清空，而旧页面 cwd 未变
    // bindSession 不重跑——重绑会话（POST /session 幂等）+ resume 受控重建
    // 当前工作空间连接，再补拉真实状态。
    const maybeRecoverSession = () => {
      void api(API.servers)
        .then((payload: any) => {
          if (payload?.projectRoot !== undefined) return; // 宿主状态正常
          if (typeof shared.currentCwd !== "string" || shared.currentCwd === "") return;
          void rebindSession(shared)
            .then(() => api(API.resume, { method: "POST" }))
            .catch(() => {});
        })
        .catch(() => {});
    };
    const onVisible = () => {
      if (document.hidden) return;
      if (!polling) connect();
      lastActivity = Date.now();
      // 切回前台：先重绑会话再 resume（#412 自愈），再补拉最新状态。
      void rebindSession(shared)
        .then(() => api(API.resume, { method: "POST" }))
        .catch(() => {});
      void refresh();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      // iOS Safari bfcache 恢复（visibilitychange 可能不触发）等价切回前台。
      if (event?.persisted === true) onVisible();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    connect();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      if (watchdog !== undefined) clearTimeout(watchdog);
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      closeEvents();
    };
  }, [refresh, mounted]);

  /** 中间层模式热切换（保存即生效并持久化，无需重启）。 */
  const onMiddlewareChange = (mode: string): void => {
    const prev = middleware;
    setMiddleware(mode);
    api(API.config, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ middleware: mode }),
    })
      .then(() => void refresh())
      .catch((e: any) => {
        setMiddleware(prev);
        setError(t("actionFail", { msg: String(e?.message ?? e) }));
      });
  };

  if (view !== null) {
    // 编辑页取 summary 里的实时行：SSE 推送或手动刷新后，status/tools/disabledTools
    // 跟着新快照走，不停留在点开那一刻（找不到时回落点击时的快照）。
    const rows: ServerRow[] = summary?.servers ?? [];
    const liveServer = view.mode === "edit"
      ? rows.find((s) => s.scope === view.server.scope && s.name === view.server.name) ?? view.server
      : null;
    return (
      <EditView
        server={liveServer}
        shared={shared}
        projectRoot={summary?.projectRoot}
        onClose={() => setView(null)}
        onRefresh={() => void refresh()}
        onSaved={() => {
          setView(null);
          void refresh();
        }}
      />
    );
  }
  return (
    <ListView
      summary={summary}
      middleware={middleware}
      error={error}
      shared={shared}
      onMiddlewareChange={onMiddlewareChange}
      onRefresh={() => void refresh()}
      onCreate={() => setView({ mode: "create" })}
      onEdit={(server) => setView({ mode: "edit", server })}
    />
  );
}

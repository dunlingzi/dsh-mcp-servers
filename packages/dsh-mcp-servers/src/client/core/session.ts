/**
 * dsh-mcp-servers — 客户端会话跟随（apply 级常驻，独立于设置页是否打开）。
 *
 * 监听当前会话变化（cwd），通知宿主切换项目级 MCP。项目级服务器的连接
 * 路由以会话 cwd 为唯一输入，因此本绑定必须在 apply 时挂载——即使用户
 * 从不打开设置页，会话级项目 MCP 也要工作。
 *
 * #412 复报根因语义保留：宿主 dsh web 重启后 `projectRoot`/中间层单元清空，
 * bindSession 的 cwd 未变短路会跳过重发；rebindSession 供页面回前台等
 * 场景显式重发 POST /session（同 cwd，宿主幂等短路零副作用）。
 */

import { api } from "./api.ts";

/** apply 与设置页共享的会话状态（cwd 由本模块维护，页面读取用于查询参数）。 */
export interface SharedSessionState {
  currentCwd: string | undefined;
}

/** 创建共享会话状态（apply 一次；页面经 slot inject 拿到同一实例）。 */
export function createSharedSessionState(): SharedSessionState {
  return { currentCwd: undefined };
}

/** 强制重绑当前会话（绕过 cwd 未变短路；宿主 setSession 幂等）。 */
export function rebindSession(shared: SharedSessionState): Promise<unknown> {
  return api("/api/dsh-mcp-servers/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd: typeof shared.currentCwd === "string" ? shared.currentCwd : "" }),
  }).catch(() => {});
}

/** 从 sessions 服务快照读当前会话 cwd（异常安全）。 */
function readCurrentCwd(ctx: any): unknown {
  try {
    const snapshot = ctx.sessions?.list?.getSnapshot?.();
    const sessionId = snapshot?.current;
    return sessionId === undefined ? undefined : snapshot?.byId?.[sessionId]?.cwd;
  } catch {
    return undefined;
  }
}

/**
 * 跟随当前会话：cwd 变化 → 通知宿主切换项目级 MCP。
 * 无论 cwd 是否为空都通知宿主切换：空 cwd（blank 会话/新会话还没选
 * 工作区）也要显式清空宿主的项目级 MCP，否则宿主全局单例会残留
 * 上一个会话的项目级服务器，别的会话就串台显示了。
 */
export function bindSession(ctx: any, shared: SharedSessionState): () => void {
  const list = ctx.sessions?.list;
  if (list === undefined || typeof list.getSnapshot !== "function") return () => {};
  const sync = () => {
    const cwd = readCurrentCwd(ctx);
    const prevCwd = shared.currentCwd;
    shared.currentCwd = typeof cwd === "string" ? cwd : undefined;
    if (cwd === prevCwd) return;
    void api("/api/dsh-mcp-servers/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: typeof cwd === "string" ? cwd : "" }),
    }).catch(() => {});
  };
  sync();
  if (typeof list.subscribe === "function") return list.subscribe(sync);
  return () => {};
}

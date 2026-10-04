/**
 * dsh-mcp-servers — 客户端常量与状态映射。
 *
 * 状态排序、状态点颜色、API 路径等纯常量，不依赖任何状态。
 * i18n（issue #348）：状态文案存字典 key（title/STATUS_TEXT），渲染期经 t 求值
 * （模块加载时 t 尚未装配，不能固化文案字符串）。
 */

import type { McpLocaleKey } from "../locales.ts";

/**
 * 宿主路由表（构建期注入，**单一事实源**）。
 *
 * `bundle-host` 从宿主产物读 `ROUTES`（`src/api/routes.ts`）并经 esbuild `define` 注入
 * `__DSH_ROUTES__`——构建期直接替换为对象字面量（`build-client.ts` 的 extraDefine）。
 * 故客户端**不再手写一份路径表**：两端一致性由构建链保证，e2e 的
 * 「client 产物路径 == 宿主 ROUTES」断言兜底（注入缺失时该断言判红，不会静默漂移）。
 *
 * 注入缺失时的兜底只 warn 不抛：客户端失败策略是绝不阻塞 GUI（见 client/index.ts 头注释）；
 * 破坏性缺失由 e2e 断言在 CI 判红。类型面（ApiRoutes）是**只读名单**，不是第二份路径表。
 */
type ApiRoutes = {
  servers: string;
  connect: string;
  disconnect: string;
  reconnect: string;
  probe: string;
  importJson: string;
  session: string;
  resume: string;
  config: string;
  events: string;
  health: string;
  toolDisable: string;
};

declare const __DSH_ROUTES__: ApiRoutes;

/** 读取构建期注入的路由表（未注入时返回空表并 warn，绝不抛）。 */
function injectedRoutes(): ApiRoutes {
  try {
    // 构建期被 esbuild define 替换为对象字面量；未注入时此处抛 ReferenceError → 由 catch 兜底
    return __DSH_ROUTES__;
  } catch {
    console.warn("dsh-mcp-servers: 构建期未注入 __DSH_ROUTES__，客户端 API 路径不可用（请重跑 pnpm build）");
    return {} as ApiRoutes;
  }
}

/** 与宿主端 ROUTES 同源（构建期注入）的 API 路径。 */
export const API = injectedRoutes();

/** 状态分组排序（按优先级降序；titleKey 为字典 key，渲染期 t(titleKey)）。 */
export const STATUS_ORDER = [
  { key: "connected", titleKey: "stConnected" as McpLocaleKey, dot: "var(--dsw-alias-state-success-primary,#0f9d6e)" },
  { key: "connecting", titleKey: "stConnecting" as McpLocaleKey, dot: "var(--dsw-alias-state-business-primary,#2f7bf6)" },
  { key: "reconnecting", titleKey: "stReconnecting" as McpLocaleKey, dot: "var(--dsw-alias-state-warn-primary,#e08b1e)" },
  { key: "stopped", titleKey: "stStopped" as McpLocaleKey, dot: "var(--dsw-alias-label-tertiary,#9aa1ad)" },
  { key: "disabled", titleKey: "stDisabled" as McpLocaleKey, dot: "var(--dsw-alias-label-tertiary,#9aa1ad)" },
  { key: "failed", titleKey: "stFailed" as McpLocaleKey, dot: "var(--dsw-alias-state-error-primary,#e0483e)" },
];

/** 状态 → 字典 key 映射（渲染期 t(STATUS_TEXT[status])；未知状态回落原始 key 显示）。 */
export const STATUS_TEXT: Record<string, McpLocaleKey> = {
  connected: "stConnected",
  connecting: "stConnecting",
  reconnecting: "stReconnecting",
  stopped: "stStopped",
  disabled: "stDisabled",
  failed: "stFailed",
};

/** 状态点颜色（与 STATUS_ORDER 一致）。 */
export function statusDot(status: string): string {
  const group = STATUS_ORDER.find((entry) => entry.key === status);
  return group !== undefined ? group.dot : "var(--dsw-alias-label-tertiary,#9aa1ad)";
}
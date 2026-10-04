/**
 * dsh-mcp-servers — 客户端常量与状态映射。
 *
 * 状态排序、状态点颜色、API 路径等纯常量，不依赖任何状态。
 * i18n（issue #348）：状态文案存字典 key（title/STATUS_TEXT），渲染期经 t 求值
 * （模块加载时 t 尚未装配，不能固化文案字符串）。
 *
 * tone 与 dot 同源：tone 驱动状态徽章的 CSS 类，dot 驱动色点内联样式——两处都从
 * STATUS_ORDER 取，改一处即徽章与色点同步（不出现「点红字绿」）。
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

/** 状态徽章语义档（映射 style.css 的 .ms-badge-<tone>）。 */
export type StatusTone = "success" | "info" | "warn" | "neutral" | "danger";

/** 状态分组排序（按优先级降序；titleKey 为字典 key，渲染期 t(titleKey)）。 */
export const STATUS_ORDER: Array<{ key: string; titleKey: McpLocaleKey; dot: string; tone: StatusTone }> = [
  { key: "connected", titleKey: "stConnected", dot: "var(--dsw-alias-state-success-primary,#0f9d6e)", tone: "success" },
  { key: "connecting", titleKey: "stConnecting", dot: "var(--dsw-alias-state-business-primary,#2f7bf6)", tone: "info" },
  { key: "reconnecting", titleKey: "stReconnecting", dot: "var(--dsw-alias-state-warn-primary,#e08b1e)", tone: "warn" },
  { key: "stopped", titleKey: "stStopped", dot: "var(--dsw-alias-label-tertiary,#9aa1ad)", tone: "neutral" },
  { key: "disabled", titleKey: "stDisabled", dot: "var(--dsw-alias-label-tertiary,#9aa1ad)", tone: "neutral" },
  { key: "failed", titleKey: "stFailed", dot: "var(--dsw-alias-state-error-primary,#e0483e)", tone: "danger" },
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

/** 状态语义档（徽章样式用；未知状态回落 neutral）。 */
export function statusTone(status: string): StatusTone {
  const group = STATUS_ORDER.find((entry) => entry.key === status);
  return group !== undefined ? group.tone : "neutral";
}

/** 状态字典 key（未知状态返回 undefined，由调用方决定回落文案）。 */
export function statusTextKey(status: string): McpLocaleKey | undefined {
  return STATUS_TEXT[status];
}

/**
 * 状态簇（筛选条用）：把六态收成四簇，簇内语义一致、文案复用状态字典。
 * connected=运行中；pending=连接中/重连中；idle=未连接/已停用；failed=失败。
 * 「全部」不入表——它是「不筛」而非一个簇。
 */
export const STATUS_BUCKETS: Array<{ id: string; labelKey: McpLocaleKey; match(status: string): boolean }> = [
  { id: "connected", labelKey: "stConnected", match: (s) => s === "connected" },
  { id: "pending", labelKey: "bucketPending", match: (s) => s === "connecting" || s === "reconnecting" },
  { id: "idle", labelKey: "bucketIdle", match: (s) => s === "stopped" || s === "disabled" },
  { id: "failed", labelKey: "stFailed", match: (s) => s === "failed" },
];

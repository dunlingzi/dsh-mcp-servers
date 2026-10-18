/**
 * dsh-mcp-servers — workspace/middleware-mode.ts：中间层模式归一化与模式分支判定。
 *
 * 阶段 4 自 src/middleware-const.ts 迁出——middleware-const.ts 仅保留执行域
 * 语义常量（limits/超时等，阶段 6 归 connection/runtime/limits.ts），函数
 * 归工作空间路由域；引用面经 workspace/interface.ts。
 *
 * coversGlobal 是「中间层是否覆盖全局服务器」的**单一事实源**：lazy 在语义上
 * 是 all 的超集，任何 `mode === "all"` 的手写判定漏改都会让 lazy 静默降级
 * （最常见症状：全局服务器不经中间层、无项目 cwd 时 resolveRoot 失败）。
 */

import type { MiddlewareMode } from "../types/interface.ts";

/** 归一化中间层模式（非法值回落 off）。 */
export function normalizeMiddlewareMode(value: unknown): MiddlewareMode {
  return value === "project" || value === "all" || value === "lazy" ? value : "off";
}

/**
 * 中间层是否覆盖全局服务器（all / lazy 同口径）。
 * all：全局与项目级都由连接池持有、经 ws_mcp_* 访问。
 * lazy：连接、目录、策略与 all 完全一致，只多一个「真实定义按需注册」。
 */
export function coversGlobal(mode: MiddlewareMode): boolean {
  return mode === "all" || mode === "lazy";
}

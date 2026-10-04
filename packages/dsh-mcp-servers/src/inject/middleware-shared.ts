/**
 * dsh-mcp-servers — inject/middleware-shared.ts：中间层工具的共享上下文与 helper
 *
 * 从 middleware-register.ts 迁入（P3 增量 3a，行为逐字保持）：工具执行/组装上下文 + 三处跨工具复用的 helper（等待发现、all 模式可见单元、路由一致性校验）
 */

import type { McpMiddleware } from "../connection/runtime/interface.ts";
import { withTimeout } from "../pipeline/interface.ts";
import { parseFullServerName, MIDDLEWARE_GLOBAL_ROOT } from "../workspace/interface.ts";
import type { MiddlewareMode } from "../types/interface.ts";
import type { McpStatsCollector } from "../stats/interface.ts";

/** 工具执行与组装上下文。 */
export interface MiddlewareToolContext {
  mw: McpMiddleware;
  resolveRoot: (agent: unknown) => Promise<string | undefined>;
  mode: MiddlewareMode;
  stats?: McpStatsCollector;
}

/** 等待 in-flight 连接/发现（8s 预算，与 search 对齐；超时不阻塞返回已有目录）。 */
export async function waitForDiscovery(unit: NonNullable<Awaited<ReturnType<McpMiddleware["projectUnitFor"]>>>): Promise<void> {
  const inflight = [...unit.inFlight.values()];
  if (inflight.length === 0) return;
  try {
    await withTimeout(Promise.allSettled(inflight), 8000, "等待连接/发现超时");
  } catch {
    // 超时不阻塞（返回已有目录）
  }
}

/**
 * all 模式可见单元集合：项目 root + @global（评审 A 全局可见性修复）。
 * root 本身为 @global 时去重（防 all 模式无项目 cwd 下服务器翻倍）。
 */
export function visibleMiddlewareRoots(root: string | undefined, mode: MiddlewareMode): string[] {
  if (root === undefined) return [];
  if (mode !== "all") return [root];
  return root === "@global" ? ["@global"] : [root, "@global"];
}

/**
 * 路由一致性校验（detail/call 共用；A2）：目标 root 必须等于当前 root，
 * 或 all 模式下的 @global（全局配置跨工作空间共享，语义成立）。
 * project 模式传全局级服务器 → 引导改用 mcp__ 直呼（全局 mcp__ 工具在该
 * 模式下仍注册可用）；非 global 的其他 root / 未知 @global 服务器一律硬拒绝
 * （防跨空间串台与 project 模式经 @global 路由绕过）。
 * @returns 校验通过的 root；抛错则拒绝。
 */
export async function checkMiddlewareRoot(
  caller: string,
  server: string,
  root: string,
  mode: MiddlewareMode,
  mw: McpMiddleware,
): Promise<string | undefined> {
  const parsed = parseFullServerName(server);
  if (parsed === undefined) {
    throw new Error(`${caller}: server 参数格式非法，应为 @<root>/<server>`);
  }
  if (parsed.root !== root && parsed.root !== MIDDLEWARE_GLOBAL_ROOT) {
    throw new Error(
      `${caller}: server ${JSON.stringify(server)} 不属于当前工作空间 ${JSON.stringify(root)}；路由一致性校验失败（防跨空间串台）`,
    );
  }
  if (parsed.root === MIDDLEWARE_GLOBAL_ROOT && mode !== "all") {
    const bare = parsed.server;
    const known = mw.host.isGlobalServer(bare) || mw.units.get(MIDDLEWARE_GLOBAL_ROOT)?.catalog.has(bare) === true;
    if (known) {
      throw new Error(
        `${caller}: server ${JSON.stringify(server)} 是全局级（global scope）服务器，中间层只覆盖项目级服务器；请直接用 mcp__${bare}__<tool> 前缀工具调用（project 模式全局工具仍直呼注册）`,
      );
    }
    throw new Error(
      `${caller}: server ${JSON.stringify(server)} 不属于当前工作空间 ${JSON.stringify(root)}；路由一致性校验失败（防跨空间串台）`,
    );
  }
  return parsed.root;
}

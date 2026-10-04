/**
 * dsh-mcp-servers — inject/middleware-register.ts：中间层工具的注册面与策略 guard。
 *
 * P3 增量 3a 后本文件**只保留注册面与 guard**：registerMiddlewareTools（组装四个工具）/
 * registerDirectMcpGuard（off 模式直呼 guard）+ handleCallGuard / handleDirectMcpGuard。
 * 四个工具体已拆到 ./tools/{search,call,list,detail}.ts，共享上下文与 helper 在
 * ./middleware-shared.ts（行为逐字保持，公开面经 inject/interface.ts 不变）。
 */

import type { Context } from "@deepseek-ai/cordis";
import type { PreToolDecision } from "@deepseek-ai/dsh-tools";
import type { McpMiddleware } from "../connection/runtime/interface.ts";
import type { MiddlewareMode, DisabledToolsMap } from "../types/interface.ts";
import type { McpStatsCollector } from "../stats/interface.ts";
import { policyAllows, policyDenialReason, isToolDenied, toolDisabledReason } from "../pipeline/interface.ts";
import { parseFullServerName, fullServerName, MIDDLEWARE_GLOBAL_ROOT } from "../workspace/interface.ts";
import { type MiddlewareToolContext } from "./middleware-shared.ts";
import { buildSearchTool } from "./tools/search.ts";
import { buildCallTool, parseCallParams } from "./tools/call.ts";
import { buildListTool } from "./tools/list.ts";
import { buildDetailTool } from "./tools/detail.ts";

// ---------------------------------------------------------------------------
// Pre-execute Guard 与模型面注册
// ---------------------------------------------------------------------------

function handleCallGuard(args: unknown, mw: McpMiddleware): PreToolDecision | undefined {
  const { server, tool } = parseCallParams(args);
  const parsed = parseFullServerName(server);
  if (parsed === undefined || parsed.server === "") return undefined;
  const policyKey = fullServerName(parsed.root, parsed.server);
  if (isToolDenied(mw.disabledTools, mw.policy, policyKey, tool)) {
    if (!policyAllows(mw.policy, policyKey, tool)) {
      return { kind: "deny", reason: policyDenialReason(mw.policy, policyKey, tool) ?? "ws_mcp_call: 工具被策略拒绝" };
    }
    return { kind: "deny", reason: toolDisabledReason(policyKey, tool) };
  }
  return undefined;
}

async function handleDirectMcpGuard(
  name: string,
  agent: unknown,
  disabledTools: DisabledToolsMap | undefined,
  resolveRoot: (agent: unknown) => Promise<string | undefined>,
): Promise<PreToolDecision | undefined> {
  const rest = name.slice("mcp__".length);
  const separator = rest.indexOf("__");
  if (separator <= 0) return undefined;
  const server = rest.slice(0, separator);
  const tool = rest.slice(separator + 2);
  if (tool === "") return undefined;
  // B11（D5 定稿，规格化不可逆）：server/tool 名含连续双下划线时，第一个 `__`
  // 分割无法唯一还原 (server, tool)（mcp__my__sv__t 既可能是 server="my"+
  // tool="sv__t"，也可能是 server="my__sv"+tool="t"）——tool 段仍含 `__` 即
  // 存在歧义，按未知 server 处理（不禁用不误禁，放行 next()）。映射表列入
  // 后续增强；不改 publicToolName/INVALID_NAME_CHARS（防冲击官方 mcp__ 契约）。
  if (tool.includes("__")) return undefined;
  const root = await resolveRoot(agent);
  if (root === undefined) {
    // 无法解析会话 root：按最宽可见范围放行（仅 @global 共享记录生效）。
    if (disabledTools?.get(MIDDLEWARE_GLOBAL_ROOT)?.get(server)?.has(tool) === true) {
      return { kind: "deny", reason: toolDisabledReason(`@${MIDDLEWARE_GLOBAL_ROOT}/${server}`, tool) };
    }
    return undefined;
  }
  const serverKey = fullServerName(root, server);
  if (isToolDenied(disabledTools, undefined, serverKey, tool)) {
    return { kind: "deny", reason: toolDisabledReason(serverKey, tool) };
  }
  return undefined;
}

function registerPreExecuteGuard(
  ctx: Context,
  mw: McpMiddleware,
  resolveRoot: (agent: unknown) => Promise<string | undefined>,
): (() => void) | undefined {
  if (typeof ctx.on !== "function") return undefined;
  return ctx.on(
    "tools/pre-execute",
    async (
      exec: { name?: string; arguments?: unknown; agent?: unknown },
      next: () => Promise<PreToolDecision>,
    ): Promise<PreToolDecision> => {
      const name = exec?.name;
      if (typeof name !== "string" || name === "") return next();
      if (name === "ws_mcp_call") {
        const decision = handleCallGuard(exec.arguments, mw);
        if (decision !== undefined) return decision;
        return next();
      }
      if (name.startsWith("mcp__")) {
        const decision = await handleDirectMcpGuard(name, exec.agent, mw.disabledTools, resolveRoot);
        if (decision !== undefined) return decision;
        return next();
      }
      return next();
    },
  );
}

/**
 * D8：独立 mcp__ 直呼守卫（guard 挂载与中间层实例解耦）。
 *
 * off 模式不 initMiddleware（无连接池副作用），pre-execute guard 现状只在
 * registerMiddlewareTools 内注册 → mcp__ 直呼无禁用拦截（「工具级禁用三入口」
 * 实际一入口）。本守卫数据源直查禁用表（只读），独立注册路径，三模式一致；
 * ws_mcp_call 守卫依赖策略/中间层实例，仅 project/all 经 registerMiddlewareTools
 * 注册。B11 反解规格化逻辑与 registerMiddlewareTools 内 guard 同源
 * （handleDirectMcpGuard）。
 */
export function registerDirectMcpGuard(
  ctx: Context,
  disabledTools: DisabledToolsMap | undefined,
  resolveRoot: (agent: unknown) => Promise<string | undefined>,
): (() => void) | undefined {
  if (typeof ctx.on !== "function") return undefined;
  return ctx.on(
    "tools/pre-execute",
    async (
      exec: { name?: string; agent?: unknown },
      next: () => Promise<PreToolDecision>,
    ): Promise<PreToolDecision> => {
      const name = exec?.name;
      if (typeof name !== "string" || name === "" || !name.startsWith("mcp__")) return next();
      const decision = await handleDirectMcpGuard(name, exec.agent, disabledTools, resolveRoot);
      if (decision !== undefined) return decision;
      return next();
    },
  );
}

// ---------------------------------------------------------------------------
// 6. registerMiddlewareTools 入口函数
// ---------------------------------------------------------------------------

/**
 * 注册 ws_mcp_search / ws_mcp_call / ws_mcp_list / ws_mcp_detail 四个中间层工具。
 * @param ctx Cordis 宿主上下文。
 * @param mw 中间层实例。
 * @param resolveRoot 路由：exec.agent → 归一化项目根（agent-less → undefined）。
 * @param mode 中间层模式（all 模式合并查询 @global 单元）。
 * @param options 可选配置（支持传入自定义工具级禁用表）。
 */
export function registerMiddlewareTools(
  ctx: Context,
  mw: McpMiddleware,
  resolveRoot: (agent: unknown) => Promise<string | undefined>,
  mode: MiddlewareMode = "project",
  options: {
    /** 工具级禁用映射（root → server → Set<tool>）；缺省取 mw.disabledTools。 */
    disabledTools?: DisabledToolsMap;
    /** 可选调用统计收集器。 */
    stats?: McpStatsCollector;
  } = {},
): () => void {
  const disposers: Array<() => void> = [];
  // 单一事实源：options 显式传入时同步到 mw（guard 与 callTool 同源，防漂移）。
  const disabledTools = options.disabledTools ?? mw.disabledTools;
  if (options.disabledTools !== undefined) mw.disabledTools = disabledTools;

  const toolCtx: MiddlewareToolContext = { mw, resolveRoot, mode, stats: options.stats };
  const tools = [
    buildSearchTool(toolCtx),
    buildCallTool(toolCtx),
    buildListTool(toolCtx),
    buildDetailTool(toolCtx),
  ];
  for (const tool of tools) {
    disposers.push(ctx.tools.register(tool));
  }

  const guardDispose = registerPreExecuteGuard(ctx, mw, resolveRoot);
  if (guardDispose !== undefined) {
    disposers.push(guardDispose);
  }

  return () => {
    for (const dispose of disposers) dispose();
  };
}

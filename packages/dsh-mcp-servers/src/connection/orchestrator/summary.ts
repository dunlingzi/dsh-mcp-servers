/**
 * dsh-mcp-servers — connection/orchestrator/summary.ts：面板 / 状态投影。
 *
 * 从 manager.ts 迁入（P3 拆分，行为逐字保持）：把「配置 + 实时状态 + 工具列表」
 * 投影成面板与 SSE summary 帧使用的形状，含中间层双轨投影（池单元 vs supervisor）
 * 与工具级禁用的展示口径（裸名剥离 + @global × 项目集合并判定）。
 *
 * 宿主面以**结构类型** `SummaryHost` 表达（McpServers 实例直接满足，字段名与类一致），
 * 双轨判定 `middlewareTakes` 由宿主以同一口径注入——本文件不复制该规则，
 * 也不 import 本域门面（避免 interface → impl 回边）。
 */
import { msgOf } from "../../pipeline/interface.ts";
import { MIDDLEWARE_GLOBAL_ROOT, SCOPE_GLOBAL, SCOPE_PROJECT } from "../../workspace/interface.ts";
import { stripMcpPrefix } from "./tool-names.ts";
import type { McpStore } from "../../config/store/interface.ts";
import type { McpMiddleware, ConnectionSupervisor } from "../runtime/interface.ts";
import type { DisabledToolsMap, MiddlewareMode, ProjectUnit, ServerConfig } from "../../types/interface.ts";

/** 投影所需的最小宿主面（McpServers 实例直接满足）。 */
export interface SummaryHost {
  store: McpStore;
  projectStore: McpStore | undefined;
  runtimeRegistry: Map<string, ServerConfig>;
  projectRoot: string | undefined;
  middlewareMode: MiddlewareMode;
  middleware: McpMiddleware | undefined;
  disabledTools: DisabledToolsMap;
  supervisors: Map<string, ConnectionSupervisor>;
}

/** 中间层接管判定（与 start / reconcileServers 同口径，由宿主注入）。 */
export type MiddlewareTakes = (name: string, scope: string) => boolean;

/**
 * 中间层投影单元：该 server 在当前模式下由中间层接管时返回其所在单元，
 * 否则 undefined（supervisor 路径照旧）。project 模式仅项目级走池；
 * all 模式全局也经虚拟 root @global 走池（与 reconcileServers 的
 * middlewareTakes 判定同口径）。
 */
export function middlewareUnitFor(
  host: SummaryHost,
  takes: MiddlewareTakes,
  serverName: string,
  scope: string,
): ProjectUnit | undefined {
  const mw = host.middleware;
  if (mw === undefined || host.middlewareMode === "off") return undefined;
  // 与 start/reconcileServers 同口径（#382 F4 + #413）：all 模式全局（含
  // runtime 注入条目）映射 @global 单元。
  if (!takes(serverName, scope)) return undefined;
  const root = scope === SCOPE_PROJECT ? host.projectRoot : MIDDLEWARE_GLOBAL_ROOT;
  return root === undefined ? undefined : mw.units.get(root);
}

/** 单台服务器的面板投影（返回形状与拆分前逐字一致）。 */
export function summarizeServer(
  host: SummaryHost,
  takes: MiddlewareTakes,
  server: ServerConfig,
  scope: string,
): Record<string, unknown> {
  // 中间层模式（#228 回归修复）：被中间层接管的服务器从连接池 + 目录缓存
  // 投影状态与工具列表——此前只读 supervisors，项目级无 supervisor 条目恒
  // 兜底 "stopped"，浮窗/summary 与真实连接态脱节。返回形状不变。
  const unit = middlewareUnitFor(host, takes, server.name, scope);
  if (unit !== undefined) {
    const entry = unit.connections.get(server.name);
    if (entry !== undefined) {
      const catalog = unit.catalog.get(server.name);
      const disabledTools = host.disabledTools.get(unit.root)?.get(server.name);
      const globalTools = unit.root === MIDDLEWARE_GLOBAL_ROOT ? undefined : host.disabledTools.get(MIDDLEWARE_GLOBAL_ROOT)?.get(server.name);
      const tools = catalog !== undefined && catalog.unavailable === undefined ? [...catalog.tools.keys()] : [];
      const disabledList = tools.filter((tool) => (disabledTools?.has(tool) ?? false) || (globalTools?.has(tool) ?? false));
      return {
        ...server,
        scope,
        status: entry.status,
        // 目录发现失败（unavailable）时透出原因：解释 connected 却 0 工具。
        error: entry.error !== undefined ? msgOf(entry.error) : catalog?.unavailable,
        tools,
        disabledTools: disabledList.length > 0 ? disabledList : undefined,
      };
    }
    // #382 F4：userDisabled 短路——池中已断开（用户浮窗断开）的服务器不再落
    // supervisor 分支（all 模式全局经池接管后 supervisor 不复存在；同名 runtime
    // 残留时也不误显示其连接态）。#234 注释前提（全局 connect 走 supervisor 复活）
    // 随 F4 消失。
    if (unit.userDisabled.has(server.name)) {
      return { ...server, scope, status: "stopped", error: undefined, tools: [] };
    }
  }
  const supervisor = host.supervisors.get(server.name);
  // #382 F4：展示口径统一裸名——剥 mcp__<server>__ 前缀（与中间层投影分支、
  // 工具级禁用表键、guard 层反解口径一致；此前浮窗禁用提交带前缀名而 guard
  // 查裸名，禁用静默无效）。超长哈希名剥出截断键，与 guard 路径二反解结果
  // 相同，禁用链路一致生效；前缀不匹配（不可剥）原样返回。
  const supervisorTools = (supervisor?.tools ?? []).map((tool) => stripMcpPrefix(tool, server.name));
  // B19：禁用查询与中间层分支同口径——@global 与 projectRoot 禁用集**合并判定**
  // （现状 ?? 二者只取其一，跨空间禁用漏算）。@global 跨工作空间共享、项目根
  // 目录级追加，任一命中即禁用。
  const globalDisabled = host.disabledTools.get(MIDDLEWARE_GLOBAL_ROOT)?.get(server.name);
  const projectDisabled = host.projectRoot !== undefined ? host.disabledTools.get(host.projectRoot)?.get(server.name) : undefined;
  const supervisorDisabled = supervisorTools.filter(
    (tool) => (globalDisabled?.has(tool) ?? false) || (projectDisabled?.has(tool) ?? false),
  );
  return {
    ...server,
    scope,
    status: supervisor?.status ?? (server.enabled === false ? "disabled" : "stopped"),
    error: supervisor?.error !== undefined ? (supervisor.error as Error).message : undefined,
    tools: supervisorTools,
    disabledTools: supervisorDisabled.length > 0 ? supervisorDisabled : undefined,
  };
}

/** 面板数据：配置 + 实时状态 + 工具列表 + 项目信息。 */
export function buildSummary(host: SummaryHost, takes: MiddlewareTakes): Record<string, unknown> {
  const servers: Record<string, unknown>[] = [];
  for (const server of host.store.data.servers) {
    servers.push(summarizeServer(host, takes, server, SCOPE_GLOBAL));
  }
  if (host.projectStore !== undefined) {
    for (const server of host.projectStore.data.servers) {
      servers.push(summarizeServer(host, takes, server, SCOPE_PROJECT));
    }
  }
  // 查询面完整性（#329 评审修正）：runtime 条目并入 summary，
  // 否则 getStatus/list 看不到运行时注册的服务器（消费方无法感知状态）。
  for (const server of host.runtimeRegistry.values()) {
    servers.push(summarizeServer(host, takes, server, SCOPE_GLOBAL));
  }
  const byStatus: Record<string, number> = { connected: 0, connecting: 0, reconnecting: 0, disabled: 0, stopped: 0, failed: 0 };
  for (const server of servers) byStatus[server.status as string] = (byStatus[server.status as string] ?? 0) + 1;
  return {
    cwd: host.projectRoot ?? undefined,
    projectRoot: host.projectRoot ?? undefined,
    servers,
    counts: byStatus,
    middlewareMode: host.middlewareMode,
  };
}

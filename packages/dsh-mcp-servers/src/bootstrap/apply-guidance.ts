/**
 * dsh-mcp-servers — apply 装配拆分：Agent 宣告文案（#592 阶段二 Batch A）。
 *
 * 向 Agent 宣告插件（announceToAgent 开启时注入）。能力清单由动态目录
 * （<available_mcp_servers>）承担，此处只保留插件存在、安全边界与术语约定，
 * 不再复述 UI 配置路径与调用流程（那部分由能力目录与中间层工具描述承担）。
 *
 * 按中间层模式渲染（设计稿 §5.7）：lazy 下没有常驻 mcp__ 工具，「Do NOT call
 * mcp__ prefixed tools directly」是反的——必须引导 search/list → ws_mcp_load →
 * 下一步直呼。热切换时由 apply 重新注册该 section（否则文案与实际工具面自相矛盾）。
 */

import type { MiddlewareMode } from "../types/interface.ts";

const HEAD =
  "dsh-mcp-servers is active: centrally manages MCP server connections without preset servers. MCP tools execute on real servers with inherited host permissions; results may contain sensitive data — explain and obtain user consent before write or sensitive operations. Terms like 'MCP / context server' refer to this plugin. Invocation rules:\n";

const RULES_DIRECT =
  "- Project-level servers: search with `ws_mcp_search`, verify schema with `ws_mcp_detail` if uncertain, then invoke with `ws_mcp_call`. Do NOT call mcp__ prefixed tools directly.\n" +
  "- Global servers: call `mcp__<server>__<tool>` directly (or via `ws_mcp_call` in all mode).\n";

const RULES_LAZY =
  "- Lazy mode (lazy): the tool list only carries `ws_mcp_*` gateway tools; no `mcp__` tools are registered up front. Find a tool with `ws_mcp_search` (or `ws_mcp_list` for a full inventory), load it with `ws_mcp_load`, then call the typed `mcp__<server>__<tool>` directly on the next step. Do not loop through `ws_mcp_call` for repeated use.\n";

const TAIL = "- Do not retry a failing server tool more than twice.";

/** 默认宣告文案（project / all / off 模式；lazy 之前由 index.ts 原样 re-export）。
 *  显式标注 `string`：保持导出面与拆分前一致（否则会被推断成字面量类型的窄化）。 */
export const MCP_GUIDANCE: string = `${HEAD}${RULES_DIRECT}${TAIL}`;

/** 按中间层模式渲染宣告文案（lazy 换调用规则段，其余段逐字不变）。 */
export function mcpGuidance(mode: MiddlewareMode | string): string {
  return mode === "lazy" ? `${HEAD}${RULES_LAZY}${TAIL}` : MCP_GUIDANCE;
}

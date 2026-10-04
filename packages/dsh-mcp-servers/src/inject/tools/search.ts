/**
 * dsh-mcp-servers — inject/tools/search.ts
 *
 * 从 middleware-register.ts 迁入（P3 增量 3a，行为逐字保持）：ws_mcp_search 工具（渲染 / 参数解析 / 执行 / 组装）
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { searchCatalogMulti } from "../../catalog/interface.ts";
import { type MiddlewareToolContext, waitForDiscovery, visibleMiddlewareRoots } from "../middleware-shared.ts";

/** 空 query 搜索无命中时的可归因提示（纯 render 文案，C 项）。 */
const SEARCH_EMPTY_HINT =
  "(No matching MCP tools found in current workspace; use ws_mcp_list for full inventory or verify server/tool names before searching)";

// ---------------------------------------------------------------------------
// 1. ws_mcp_search
// ---------------------------------------------------------------------------

function formatSearchHit(hit: Record<string, unknown>): string {
  const server = String(hit.server ?? "");
  const tool = String(hit.tool ?? "");
  const description = String(hit.description ?? "");
  return `${server}/${tool}: ${description}`;
}

function formatUnavailableServer(entry: Record<string, unknown>): string {
  return `${String(entry.server ?? "")}: ${String(entry.reason ?? "")}`;
}

function renderSearchOutput(_args: unknown, value: unknown) {
  const v = (value ?? {}) as { results?: Array<Record<string, unknown>>; unavailable?: Array<Record<string, unknown>>; truncated?: unknown };
  const lines = (v.results ?? []).map(formatSearchHit);
  let body = lines.length > 0 ? lines.join("\n") : SEARCH_EMPTY_HINT;
  if (v.truncated === true) {
    body += "\n(Results reached limit and may be incomplete — increase limit or use ws_mcp_list for full audit)";
  }
  const unavailable = (v.unavailable ?? []).map(formatUnavailableServer);
  const text = unavailable.length > 0 ? `${body}\n\nUnavailable servers:\n${unavailable.join("\n")}` : body;
  return [{ type: "text" as const, text }];
}

function parseSearchParams(args: unknown): { query: string; serverFilter?: string; limit: number } {
  const params = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
  const query = typeof params.query === "string" ? params.query : "";
  const serverFilter = typeof params.server === "string" ? params.server : undefined;
  const requested = typeof params.limit === "number" ? Math.floor(params.limit) : 5;
  const limit = Math.max(1, Math.min(requested, 10));
  return { query, serverFilter, limit };
}

async function executeSearch(
  toolCtx: MiddlewareToolContext,
  args: unknown,
  exec: { signal?: AbortSignal; agent?: unknown },
) {
  const root = await toolCtx.resolveRoot(exec.agent);
  if (root === undefined) throw new Error("ws_mcp_search: 无法确定工作空间，请先选择工作区");
  const { query, serverFilter, limit } = parseSearchParams(args);
  if (toolCtx.stats?.isEnabled()) {
    toolCtx.stats.recordSearch(query);
  }
  const roots = visibleMiddlewareRoots(root, toolCtx.mode);
  const unit = await toolCtx.mw.projectUnitFor(root);
  if (unit === undefined) {
    return { results: [], unavailable: [], truncated: false };
  }
  // 等待 in-flight 连接/发现（预算内），再搜索。all 模式对可见全部单元
  // （含 @global 首次触达）都等待——否则全局目录首次为空（P1-3 修复）。
  for (const visible of roots) {
    const visibleUnit = visible === root ? unit : await toolCtx.mw.projectUnitFor(visible);
    if (visibleUnit !== undefined) await waitForDiscovery(visibleUnit);
  }
  const { results, unavailable, truncated } = searchCatalogMulti(toolCtx.mw.units, roots, query, limit);
  // truncated 由检索函数返回截断事实（恰好命中 limit 不误报，B10 修正——
  // 旧实现按过滤前 results.length >= limit 判定，恰恰等于 limit 也误报
  // 「可能未列全」）；serverFilter 过滤在截断判定之后，纯展示层过滤。
  const filtered = serverFilter === undefined ? results : results.filter((hit) => hit.server === serverFilter);
  return { results: filtered, unavailable, truncated };
}

export function buildSearchTool(toolCtx: MiddlewareToolContext): ToolDefinition {
  return {
    name: "ws_mcp_search",
    description:
      "Search workspace MCP tools catalog by keyword (matches server, tool, description, and parameter names). Search first, then invoke with ws_mcp_call; use ws_mcp_list for full inventory audits. Empty query returns capability summary.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query / keywords; empty returns capability summary" },
        server: { type: "string", description: "Optional: @<root>/<server> full name filter" },
        limit: { type: "number", description: "Max results to return (default 5, max 10)" },
      },
    },
    output: {
      schema: {
        type: "object",
        properties: {
          results: { type: "array", items: {} },
          unavailable: { type: "array", items: {} },
          truncated: { type: "boolean", description: "结果是否因 limit 截断（results 达到 limit 时为 true，提示模型可能未列全）" },
        },
        required: ["results", "unavailable", "truncated"],
        additionalProperties: false,
      },
      render: renderSearchOutput,
    },
    isConcurrencySafe: () => true,
    execute: (args, exec) => executeSearch(toolCtx, args, exec),
  };
}

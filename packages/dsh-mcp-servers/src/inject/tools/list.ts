/**
 * dsh-mcp-servers — inject/tools/list.ts
 *
 * 从 middleware-register.ts 迁入（P3 增量 3a，行为逐字保持）：ws_mcp_list 工具（渲染 / 参数解析 / 执行 / 组装）
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { McpMiddleware } from "../../connection/runtime/interface.ts";
import type { MiddlewareMode } from "../../types/interface.ts";
import { LIST_DEFAULT_TOOLS_PER_SERVER, LIST_MAX_TOOLS_PER_SERVER } from "../../connection/runtime/interface.ts";
import { listCatalog } from "../../catalog/interface.ts";
import { type MiddlewareToolContext, waitForDiscovery, visibleMiddlewareRoots } from "../middleware-shared.ts";

/** 项目级可见服务器名列表（A1 归因文案用；排序去重）。 */
function visibleProjectServers(mw: McpMiddleware, root: string): string[] {
  const names: string[] = [];
  for (const unit of mw.units.values()) {
    if (unit.root === root) {
      for (const serverName of unit.catalog.keys()) names.push(serverName);
    }
  }
  return [...new Set(names)].sort();
}

// ---------------------------------------------------------------------------
// 3. ws_mcp_list
// ---------------------------------------------------------------------------

function formatListTool(t: Record<string, unknown>): string {
  return `  - ${String(t.tool ?? "")}: ${String(t.description ?? "")}`;
}

function formatListServerEntry(entry: Record<string, unknown>): string {
  const server = String(entry.server ?? "");
  const tools = Array.isArray(entry.tools) ? (entry.tools as Array<Record<string, unknown>>) : [];
  const head =
    tools.length > 0
      ? `${server} (${tools.length} tools):\n${tools.map(formatListTool).join("\n")}`
      : `${server} (0 tools)`;
  const disabled = entry.disabled === true ? " [disabled]" : "";
  const unavailable =
    typeof entry.unavailable === "string" && entry.unavailable !== "" ? ` [unavailable: ${entry.unavailable}]` : "";
  const truncated =
    entry.toolsTruncated === true
      ? " [toolsTruncated: tool count reached limit, increase perServerLimit to retry]"
      : "";
  return `${head}${disabled}${unavailable}${truncated}`;
}

function renderListOutput(_args: unknown, value: unknown) {
  const v = (value ?? {}) as {
    workspace?: unknown;
    mode?: unknown;
    servers?: Array<Record<string, unknown>>;
    totalServers?: unknown;
    totalTools?: unknown;
    toolsTruncated?: unknown;
    message?: unknown;
  };
  const servers = v.servers ?? [];
  const lines = servers.map(formatListServerEntry);
  const prefix = `Workspace ${String(v.workspace ?? "")} (mode=${String(v.mode ?? "")}): ${String(v.totalServers ?? 0)} servers / ${String(v.totalTools ?? 0)} tools in total`;
  const body = lines.length > 0 ? lines.join("\n\n") : String(v.message ?? "(No MCP servers found in current workspace)");
  const truncated =
    v.toolsTruncated === true ? "\n(Some server tool lists were truncated; increase perServerLimit if needed)" : "";
  return [{ type: "text" as const, text: `${prefix}\n\n${body}${truncated}` }];
}

function parseListParams(args: unknown): { serverFilter?: string; toolLimit: number } {
  const params = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
  const serverFilter = typeof params.server === "string" && params.server !== "" ? params.server : undefined;
  const requested =
    typeof params.perServerLimit === "number" ? Math.floor(params.perServerLimit) : LIST_DEFAULT_TOOLS_PER_SERVER;
  const toolLimit = Math.max(1, Math.min(requested, LIST_MAX_TOOLS_PER_SERVER));
  return { serverFilter, toolLimit };
}

function resolveEmptyListMessage(
  serverFilter: string | undefined,
  mw: McpMiddleware,
  root: string,
  mode: MiddlewareMode,
): string {
  if (serverFilter !== undefined) {
    const visible = visibleProjectServers(mw, root);
    const visibleText = visible.length > 0 ? `可见项目级服务器：${visible.join(" / ")}；` : "当前工作空间无已发现的项目级服务器；";
    return `没有匹配 server=${JSON.stringify(serverFilter)} 的项目级服务器。${visibleText}全局级服务器不在此列出，请用 mcp__<server>__<tool> 前缀工具访问`;
  }
  return mode === "all"
    ? "当前工作空间没有可用 MCP 服务器（项目级与全局均未发现；若刚添加配置，请稍后重试）"
    : "当前工作空间没有可用 MCP 服务器（未配置项目级服务器；若刚添加配置，请稍后重试）";
}

async function resolveListWithoutUnit(
  mw: McpMiddleware,
  root: string,
  mode: MiddlewareMode,
  serverFilter: string | undefined,
  toolLimit: number,
) {
  if (mode !== "all") {
    return {
      workspace: root,
      mode,
      servers: [],
      totalServers: 0,
      totalTools: 0,
      toolsTruncated: false,
      message: "当前工作空间没有项目级 MCP 配置（可在 <项目根>/.dsh/mcp.json 添加服务器，或切换工作区）",
    };
  }
  const globalUnit = await mw.projectUnitFor("@global");
  if (globalUnit !== undefined) await waitForDiscovery(globalUnit);
  return listCatalog(
    mw.units,
    ["@global"],
    serverFilter,
    toolLimit,
    mode,
    "当前工作空间没有可用 MCP 服务器（项目级与全局均未发现；若刚添加配置，请稍后重试）",
    mw.disabledTools,
  );
}

async function executeList(
  toolCtx: MiddlewareToolContext,
  args: unknown,
  exec: { signal?: AbortSignal; agent?: unknown },
) {
  const root = await toolCtx.resolveRoot(exec.agent);
  if (root === undefined) throw new Error("ws_mcp_list: 无法确定工作空间，请先选择工作区");
  const { serverFilter, toolLimit } = parseListParams(args);
  if (toolCtx.stats?.isEnabled()) {
    toolCtx.stats.recordList(serverFilter);
  }
  const roots = visibleMiddlewareRoots(root, toolCtx.mode);
  const unit = await toolCtx.mw.projectUnitFor(root);
  if (unit === undefined) {
    return resolveListWithoutUnit(toolCtx.mw, root, toolCtx.mode, serverFilter, toolLimit);
  }
  // 等待 in-flight 连接/发现（预算内），再搜索。all 模式对可见全部单元
  // （含 @global 首次触达）都等待——否则全局目录首次为空（P1-3 修复）。
  for (const visible of roots) {
    const visibleUnit = visible === root ? unit : await toolCtx.mw.projectUnitFor(visible);
    if (visibleUnit !== undefined) await waitForDiscovery(visibleUnit);
  }
  const result = listCatalog(toolCtx.mw.units, roots, serverFilter, toolLimit, toolCtx.mode, "", toolCtx.mw.disabledTools);
  // A1：带 serverFilter 过滤后 0 命中 → message 可归因（不谎报「未配置」）。
  if (result.servers.length === 0) {
    result.message = resolveEmptyListMessage(serverFilter, toolCtx.mw, root, toolCtx.mode);
  }
  return result;
}

export function buildListTool(toolCtx: MiddlewareToolContext): ToolDefinition {
  return {
    name: "ws_mcp_list",
    description:
      "List all MCP servers and their complete tool inventories in current workspace (not truncated by search limit). Returns full server names, tool names, and descriptions. Does not return inputSchema (use ws_mcp_detail for full schemas). Includes global servers in all mode.",
    parameters: {
      type: "object",
      properties: {
        server: {
          type: "string",
          description: "Optional: @<root>/<server> full name or bare name filter (error if root is not in current workspace)",
        },
        perServerLimit: {
          type: "number",
          description: `Optional: max tools per server (default ${LIST_DEFAULT_TOOLS_PER_SERVER}, max ${LIST_MAX_TOOLS_PER_SERVER}; sets toolsTruncated=true when exceeded)`,
        },
      },
    },
    output: {
      schema: {
        type: "object",
        properties: {
          workspace: { type: "string" },
          mode: { type: "string" },
          servers: { type: "array", items: {} },
          totalServers: { type: "number" },
          totalTools: { type: "number" },
          toolsTruncated: { type: "boolean" },
          message: { type: "string" },
        },
        required: ["workspace", "mode", "servers", "totalServers", "totalTools", "toolsTruncated"],
        additionalProperties: false,
      },
      render: renderListOutput,
    },
    isConcurrencySafe: () => true,
    execute: (args, exec) => executeList(toolCtx, args, exec),
  };
}

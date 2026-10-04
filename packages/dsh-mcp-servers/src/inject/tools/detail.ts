/**
 * dsh-mcp-servers — inject/tools/detail.ts
 *
 * 从 middleware-register.ts 迁入（P3 增量 3a，行为逐字保持）：ws_mcp_detail 工具（渲染 / 参数解析 / 执行 / 组装）
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { findToolDetail } from "../../catalog/interface.ts";
import { parseFullServerName } from "../../workspace/interface.ts";
import { type MiddlewareToolContext, checkMiddlewareRoot, waitForDiscovery } from "../middleware-shared.ts";

// ---------------------------------------------------------------------------
// 4. ws_mcp_detail
// ---------------------------------------------------------------------------

function renderDetailOutput(_args: unknown, value: unknown) {
  const v = (value ?? {}) as {
    server?: unknown;
    tool?: unknown;
    description?: unknown;
    inputSchema?: unknown;
    fresh?: unknown;
    disabled?: unknown;
  };
  const server = String(v.server ?? "");
  const tool = String(v.tool ?? "");
  const description = typeof v.description === "string" && v.description !== "" ? v.description : "（无描述）";
  const schema = v.inputSchema === undefined ? "{}" : JSON.stringify(v.inputSchema, null, 2);
  const fresh = v.fresh === true ? "fresh" : "stale";
  const disabled = v.disabled === true ? " [disabled]" : "";
  return [{ type: "text" as const, text: `${server}/${tool}（${fresh}${disabled}）：${description}\n\ninputSchema:\n${schema}` }];
}

function parseDetailParams(args: unknown): { server: string; tool: string } {
  const params = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
  const server = typeof params.server === "string" ? params.server : "";
  const tool = typeof params.tool === "string" ? params.tool : "";
  return { server, tool };
}

async function executeDetail(
  toolCtx: MiddlewareToolContext,
  args: unknown,
  exec: { signal?: AbortSignal; agent?: unknown },
) {
  const root = await toolCtx.resolveRoot(exec.agent);
  if (root === undefined) throw new Error("ws_mcp_detail: 无法确定工作空间，请先选择工作区");
  const { server, tool } = parseDetailParams(args);
  if (server === "" || tool === "") throw new Error("ws_mcp_detail: server 与 tool 均为必填");
  const parsed = parseFullServerName(server);
  if (toolCtx.stats?.isEnabled()) {
    toolCtx.stats.recordDetail(parsed?.server ?? server, tool);
  }
  const targetRoot = await checkMiddlewareRoot("ws_mcp_detail", server, root, toolCtx.mode, toolCtx.mw);
  if (targetRoot === undefined) {
    throw new Error(
      `ws_mcp_detail: server ${JSON.stringify(server)} 不属于当前工作空间 ${JSON.stringify(root)}；路由一致性校验失败（防跨空间串台）`,
    );
  }
  const unit = await toolCtx.mw.projectUnitFor(targetRoot);
  if (unit !== undefined) await waitForDiscovery(unit);
  return findToolDetail(toolCtx.mw.units, targetRoot, server, tool);
}

export function buildDetailTool(toolCtx: MiddlewareToolContext): ToolDefinition {
  return {
    name: "ws_mcp_detail",
    description:
      "Query the exact parameter schema (inputSchema: properties/required/enum/description) of a single MCP tool by @<root>/<server> full name and bare tool name. Used before ws_mcp_call. Does not perform keyword search (use ws_mcp_list or ws_mcp_search to find tools).",
    parameters: {
      type: "object",
      properties: {
        server: { type: "string", description: "Required: @<root>/<server> full name (from ws_mcp_list / ws_mcp_search)" },
        tool: { type: "string", description: "Required: bare remote tool name (from ws_mcp_list / ws_mcp_search; supports mcp__<server>__<tool> prefix)" },
      },
      required: ["server", "tool"],
    },
    output: {
      schema: {
        type: "object",
        properties: {
          server: { type: "string" },
          tool: { type: "string" },
          description: { type: "string" },
          inputSchema: {},
          fresh: { type: "boolean" },
          disabled: { type: "boolean" },
        },
        required: ["server", "tool", "description", "inputSchema", "fresh"],
        additionalProperties: false,
      },
      render: renderDetailOutput,
    },
    isConcurrencySafe: () => true,
    execute: (args, exec) => executeDetail(toolCtx, args, exec),
  };
}

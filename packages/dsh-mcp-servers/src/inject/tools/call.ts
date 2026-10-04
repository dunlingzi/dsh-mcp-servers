/**
 * dsh-mcp-servers — inject/tools/call.ts
 *
 * 从 middleware-register.ts 迁入（P3 增量 3a，行为逐字保持）：ws_mcp_call 工具（内容块格式化 / 参数解析 / 执行 / 组装）
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { CONNECT_TIMEOUT_MS, DISCOVERY_TIMEOUT_MS, CALL_TIMEOUT_MS } from "../../connection/runtime/interface.ts";
import { parseFullServerName } from "../../workspace/interface.ts";
import { type MiddlewareToolContext, checkMiddlewareRoot } from "../middleware-shared.ts";

// ---------------------------------------------------------------------------
// 2. ws_mcp_call
// ---------------------------------------------------------------------------

function formatCallContentBlock(block: unknown): string {
  if (typeof block !== "object" || block === null) {
    return "[unsupported MCP content]";
  }
  const rec = block as Record<string, unknown>;
  if (rec.type === "text" && typeof rec.text === "string") {
    return rec.text;
  }
  if (rec.type === "resource" || rec.type === "resource_link") {
    return "[resource: content discarded]";
  }
  return `[${String(rec.type ?? "unknown")} content]`;
}

function renderCallOutput(_args: unknown, value: unknown) {
  const v = (value ?? {}) as { content?: unknown };
  const content = Array.isArray(v.content) ? v.content : [];
  const parts = content.map(formatCallContentBlock);
  return [{ type: "text" as const, text: parts.length > 0 ? parts.join("\n") : "(MCP tool returned no content)" }];
}

export function parseCallParams(args: unknown): { server: string; tool: string; arguments?: unknown } {
  const params = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
  const server = typeof params.server === "string" ? params.server : "";
  const tool = typeof params.tool === "string" ? params.tool : "";
  return { server, tool, arguments: params.arguments };
}

async function executeCall(
  toolCtx: MiddlewareToolContext,
  args: unknown,
  exec: { signal?: AbortSignal; agent?: unknown },
) {
  const root = await toolCtx.resolveRoot(exec.agent);
  if (root === undefined) throw new Error("ws_mcp_call: 无法确定工作空间，请先选择工作区");
  const { server, tool, arguments: callArguments } = parseCallParams(args);
  if (server === "" || tool === "") throw new Error("ws_mcp_call: server 与 tool 均为必填");
  const parsed = parseFullServerName(server);
  if (parsed === undefined) throw new Error("ws_mcp_call: server 参数格式非法，应为 @<root>/<server>");
  const targetRoot = await checkMiddlewareRoot("ws_mcp_call", server, root, toolCtx.mode, toolCtx.mw);
  if (targetRoot === undefined) {
    throw new Error(`ws_mcp_call: server ${JSON.stringify(server)} 不属于当前工作空间 ${JSON.stringify(root)}；路由一致性校验失败（防跨空间串台）`);
  }
  const unit = await toolCtx.mw.projectUnitFor(targetRoot);
  if (unit === undefined) throw new Error(`ws_mcp_call: 工作空间 ${JSON.stringify(targetRoot)} 无项目级 MCP 配置`);
  await toolCtx.mw.ensureConnected(targetRoot, parsed.server);
  // #413：透传 exec.agent 给 callTool（封装直呼分支的 execute 依赖
  // agent.session.header.cwd 做 projectPath 补全）。
  const startTime = Date.now();
  try {
    const result = await toolCtx.mw.callTool(server, tool, callArguments, exec.signal, exec.agent);
    const durationMs = Date.now() - startTime;
    if (toolCtx.stats?.isEnabled()) {
      toolCtx.stats.recordCall(parsed.server, tool, durationMs, true);
    }
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    if (toolCtx.stats?.isEnabled()) {
      toolCtx.stats.recordCall(parsed.server, tool, durationMs, false, error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
}

export function buildCallTool(toolCtx: MiddlewareToolContext): ToolDefinition {
  return {
    name: "ws_mcp_call",
    description:
      "Invoke an MCP tool in the current workspace (executes on live server). Verify parameter schema with ws_mcp_detail beforehand (can invoke directly if server and tool are known); obtain user consent before write or sensitive operations.",
    parameters: {
      type: "object",
      properties: {
        server: { type: "string", description: "Required: @<root>/<server> full name (from ws_mcp_search / ws_mcp_list)" },
        tool: { type: "string", description: "Required: bare remote tool name (from ws_mcp_search / ws_mcp_list)" },
        arguments: {
          type: "object",
          additionalProperties: true,
          description:
            "Arguments matching inputSchema from ws_mcp_detail (properties/required/enum/description); check with ws_mcp_detail when uncertain",
        },
      },
      required: ["server", "tool"],
    },
    output: {
      schema: {
        type: "object",
        properties: {
          content: { type: "array", items: {} },
          structuredContent: {},
        },
        required: ["content"],
        additionalProperties: false,
      },
      render: renderCallOutput,
    },
    isConcurrencySafe: () => true,
    timeoutMs: CONNECT_TIMEOUT_MS + DISCOVERY_TIMEOUT_MS + CALL_TIMEOUT_MS + 5000,
    execute: (args, exec) => executeCall(toolCtx, args, exec),
  };
}

/**
 * dsh-mcp-servers — inject/tools/load.ts
 *
 * ws_mcp_load：把中间层目录里的真实工具定义按需注册进**调用者 agent 作用域**。
 * 装载成功后，下一步的系统提示词装配（每 step 一次）会多出该工具，宿主
 * `buildRequest` 的工具名 diff 随即写入 `tool-addition` 记录 —— 这是宿主唯一
 * 可靠的激活通道（`deferLoading` 单独使用不产生 addition，见设计稿 §2.2）。
 *
 * 与 ws_mcp_call 的分工：load 只做「按需拿到强类型定义」，不转发调用；
 * 装载后的直呼走定义内 execute（callTool 同源：策略 / 禁用 / 超时 / 投影）。
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { searchCatalogMulti } from "../../catalog/interface.ts";
import { parseFullServerName, fullServerName, MIDDLEWARE_GLOBAL_ROOT, coversGlobal } from "../../workspace/interface.ts";
import { isToolDenied, policyAllows, policyDenialReason, toolDisabledReason } from "../../pipeline/interface.ts";
import type { LoadedToolEntry, LoadResult, Registrar } from "../../types/interface.ts";
import { buildLazyDefinition } from "../lazy-registrar.ts";
import { type MiddlewareToolContext, checkMiddlewareRoot, visibleMiddlewareRoots, waitForDiscovery } from "../middleware-shared.ts";

/** query 批量装载默认条数。 */
const LOAD_LIMIT_DEFAULT = 3;
/** query 批量装载硬上限（防单次装载撑爆常驻工具面）。 */
const LOAD_LIMIT_MAX = 8;
/** 返回给模型的描述截断长度（schema 已在下一步模型面，重复无益）。 */
const LOAD_DESC_MAX = 240;

/** 解析后的装载参数。 */
interface ParsedLoadParams {
  tools: string[];
  query: string;
  limit: number;
}

/** 单一候选（含按 root 优先级展开的候选全名）。 */
interface LoadCandidate {
  server: string;
  tool: string;
  /** 候选全名（显式 @root 单条；裸名按项目 root → @global 顺序）。 */
  serverFulls: string[];
}

function parseLoadParams(args: unknown): ParsedLoadParams {
  const params = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
  const tools = Array.isArray(params.tools) ? params.tools.filter((t): t is string => typeof t === "string" && t !== "") : [];
  const query = typeof params.query === "string" ? params.query.trim() : "";
  const rawLimit = typeof params.limit === "number" && Number.isFinite(params.limit) ? Math.floor(params.limit) : LOAD_LIMIT_DEFAULT;
  return { tools, query, limit: Math.min(Math.max(rawLimit, 1), LOAD_LIMIT_MAX) };
}

/**
 * 工具引用归一化（三种写法）：
 * - `mcp__<server>__<tool>`（模型面工具名，最常用）；
 * - `@<root>/<server>/<tool>`（ws_mcp_search / ws_mcp_list 的全名 + 裸工具名）；
 * - `<server>/<tool>`（裸名；按项目 root → @global 顺序解析）。
 * 非法输入返回 undefined（调用方进 missing，不抛错）。
 */
function parseRef(ref: string, roots: readonly string[]): { server: string; tool: string; serverFulls: string[] } | undefined {
  const trimmed = ref.trim();
  if (trimmed === "") return undefined;
  // @<root>/<server>/<tool>：从最后一个 `/` 切 tool，再从全名解析 root/server
  // （root 是绝对路径，可能自带 `/`，不能用固定段数切分）。
  if (trimmed.startsWith("@")) {
    const lastSlash = trimmed.lastIndexOf("/");
    if (lastSlash <= 1 || lastSlash === trimmed.length - 1) return undefined;
    const serverFull = trimmed.slice(0, lastSlash);
    const tool = trimmed.slice(lastSlash + 1);
    const parsed = parseFullServerName(serverFull);
    if (parsed === undefined) return undefined;
    return { server: parsed.server, tool, serverFulls: [serverFull] };
  }
  let rest = trimmed;
  if (rest.startsWith("mcp__")) rest = rest.slice("mcp__".length);
  const separator = rest.indexOf("__");
  if (separator > 0) {
    const server = rest.slice(0, separator);
    const tool = rest.slice(separator + 2);
    if (tool === "") return undefined;
    return { server, tool, serverFulls: roots.map((root) => fullServerName(root, server)) };
  }
  const slash = rest.indexOf("/");
  if (slash > 0) {
    const server = rest.slice(0, slash);
    const tool = rest.slice(slash + 1);
    if (tool === "") return undefined;
    return { server, tool, serverFulls: roots.map((root) => fullServerName(root, server)) };
  }
  return undefined;
}

/** 渲染装载结果（紧凑文本；不吐完整 schema —— 它已随下一步模型面下发）。 */
function renderLoadOutput(_args: unknown, value: unknown): Array<{ type: "text"; text: string }> {
  const v = (value ?? {}) as Partial<LoadResult>;
  const lines: string[] = [];
  for (const item of v.activated ?? []) {
    const required = item.required.length > 0 ? ` required: ${item.required.join(", ")}` : " (no required params)";
    lines.push(`+ ${item.name}${required} — ${item.description}`);
  }
  if ((v.alreadyLoaded ?? []).length > 0) lines.push(`= already loaded: ${(v.alreadyLoaded ?? []).join(", ")}`);
  if ((v.missing ?? []).length > 0) lines.push(`x not found: ${(v.missing ?? []).join(", ")}`);
  for (const entry of v.unavailable ?? []) lines.push(`! ${entry.server} unavailable: ${entry.reason}`);
  if (typeof v.message === "string" && v.message !== "") lines.push(v.message);
  return [{ type: "text", text: lines.join("\n") }];
}

/** 早失败文案：被禁用 / 被策略拒绝的工具不装载（避免「装上了却调不动」）。 */
function denialReason(policyKey: string, tool: string, mw: MiddlewareToolContext["mw"]): string {
  // 裁决族文案自带 ws_mcp_call: 前缀（三入口统一），装载侧换成 ws_mcp_load: 前缀。
  const strip = (text: string): string => text.replace(/^ws_mcp_call:\s*/u, "");
  if (!policyAllows(mw.policy, policyKey, tool)) {
    const reason = strip(policyDenialReason(mw.policy, policyKey, tool) ?? `工具 ${JSON.stringify(`${policyKey}/${tool}`)} 被策略拒绝`);
    return `${reason}；如需放行请调整 middlewarePolicy 配置`;
  }
  return strip(toolDisabledReason(policyKey, tool));
}

export function buildLoadTool(toolCtx: MiddlewareToolContext, registrar: Registrar): ToolDefinition {
  async function executeLoad(args: unknown, exec: { signal?: AbortSignal; agent?: unknown }): Promise<LoadResult> {
    const root = await toolCtx.resolveRoot(exec.agent);
    if (root === undefined) throw new Error("ws_mcp_load: 无法确定工作空间，请先选择工作区");
    const { tools: refs, query, limit } = parseLoadParams(args);
    if (refs.length === 0 && query === "") throw new Error("ws_mcp_load: 需要 tools 或 query（可先 ws_mcp_search 检索）");

    const roots = visibleMiddlewareRoots(root, toolCtx.mode);
    // 裸名解析顺序：项目 root → @global（all/lazy 下全局服务器经中间层持有）。
    const bareRoots = coversGlobal(toolCtx.mode) && root !== MIDDLEWARE_GLOBAL_ROOT ? [root, MIDDLEWARE_GLOBAL_ROOT] : [root];
    const candidates: LoadCandidate[] = [];
    const missing: string[] = [];
    for (const ref of refs) {
      const parsed = parseRef(ref, bareRoots);
      if (parsed === undefined) {
        missing.push(ref);
        continue;
      }
      candidates.push(parsed);
    }
    const unavailable: Array<{ server: string; reason: string }> = [];
    if (query !== "") {
      const search = searchCatalogMulti(toolCtx.mw.units, roots, query, limit);
      for (const hit of search.results) {
        const parsed = parseFullServerName(hit.server);
        if (parsed === undefined) continue;
        candidates.push({ server: parsed.server, tool: hit.tool, serverFulls: [hit.server] });
      }
      unavailable.push(...search.unavailable);
    }

    const definitions: Array<{ definition: ToolDefinition; server: string; tool: string }> = [];
    const metaByName = new Map<string, LoadedToolEntry>();
    for (const want of candidates) {
      const resolved = await resolveCandidate(toolCtx, root, want);
      if (resolved === undefined) {
        missing.push(`${want.server}/${want.tool}`);
        continue;
      }
      if ("reason" in resolved) {
        unavailable.push(resolved);
        continue;
      }
      const { targetRoot, entry } = resolved;
      const policyKey = fullServerName(targetRoot, want.server);
      if (isToolDenied(toolCtx.mw.disabledTools, toolCtx.mw.policy, policyKey, want.tool)) {
        throw new Error(`ws_mcp_load: ${denialReason(policyKey, want.tool, toolCtx.mw)}`);
      }
      const description = entry.description !== "" ? entry.description : `MCP tool ${want.tool} on ${policyKey}`;
      const schema = (entry.inputSchema ?? {}) as Record<string, unknown>;
      const required = Array.isArray(schema.required) ? (schema.required as unknown[]).filter((name): name is string => typeof name === "string") : [];
      definitions.push({
        server: want.server,
        tool: want.tool,
        definition: buildLazyDefinition(toolCtx.mw, targetRoot, want.server, want.tool, schema, description, toolCtx.stats),
      });
      metaByName.set(definitions[definitions.length - 1].definition.name, {
        name: definitions[definitions.length - 1].definition.name,
        server: policyKey,
        tool: want.tool,
        description: description.length > LOAD_DESC_MAX ? `${description.slice(0, LOAD_DESC_MAX - 1)}…` : description,
        required,
      });
    }

    const { activated, alreadyLoaded } = registrar.load(exec.agent, definitions);
    const result: LoadResult = {
      activated: activated.filter((name) => metaByName.has(name)).map((name) => metaByName.get(name) as LoadedToolEntry),
      alreadyLoaded,
      missing,
      unavailable,
      message: activated.length > 0
        ? `已装载 ${activated.length} 个工具，下一步可直接调用：${activated.join(", ")}`
        : "本次没有新装载的工具；已装载的直接调用，未找到的请先用 ws_mcp_search 检索（ws_mcp_load 可重复调用）。",
    };
    return result;
  }

  return {
    name: "ws_mcp_load",
    description:
      "Load real MCP tool definitions into this session on demand so the next step exposes the typed mcp__<server>__<tool> tool. Use it after ws_mcp_search / ws_mcp_list identifies a tool you need; repeat calls are idempotent. Prefer this over repeated ws_mcp_call for tools you will use more than once.",
    parameters: {
      type: "object",
      properties: {
        tools: {
          type: "array",
          items: { type: "string" },
          description: 'Exact tool refs: "mcp__<server>__<tool>", "@<root>/<server>/<tool>" or "<server>/<tool>". Batch up to 8.',
        },
        query: { type: "string", description: "Keyword batch load (alternative to tools): loads the top matches." },
        limit: { type: "number", description: `When using query: max tools to load (default ${LOAD_LIMIT_DEFAULT}, max ${LOAD_LIMIT_MAX}).` },
      },
      required: [],
    },
    output: {
      schema: {
        type: "object",
        properties: {
          activated: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                server: { type: "string" },
                tool: { type: "string" },
                description: { type: "string" },
                required: { type: "array", items: { type: "string" } },
              },
              required: ["name", "server", "tool", "description", "required"],
              additionalProperties: false,
            },
          },
          alreadyLoaded: { type: "array", items: { type: "string" } },
          missing: { type: "array", items: { type: "string" } },
          unavailable: {
            type: "array",
            items: {
              type: "object",
              properties: { server: { type: "string" }, reason: { type: "string" } },
              required: ["server", "reason"],
              additionalProperties: false,
            },
          },
          message: { type: "string" },
        },
        required: ["activated", "alreadyLoaded", "missing", "unavailable", "message"],
        additionalProperties: false,
      },
      render: renderLoadOutput,
    },
    isConcurrencySafe: () => true,
    execute: (args, exec) => executeLoad(args, exec),
  };
}

/**
 * 单个候选解析：按候选全名顺序找「已发现且含该工具」的目录条目。
 * - 命中 → { targetRoot, entry }；
 * - 服务器发现失败（目录 unavailable）→ { server, reason }（进 unavailable，不误报 not found）；
 * - 全部落空 → undefined（进 missing）。
 */
async function resolveCandidate(
  toolCtx: MiddlewareToolContext,
  root: string,
  want: LoadCandidate,
): Promise<{ targetRoot: string; entry: { description: string; inputSchema: Record<string, unknown> } } | { server: string; reason: string } | undefined> {
  for (const serverFull of want.serverFulls) {
    // checkMiddlewareRoot 抛错 = 路由非法（显式 @root 不属于本工作空间），
    // 这是调用方参数错误，直接上抛比静默进 missing 更容易自查。
    const targetRoot = await checkMiddlewareRoot("ws_mcp_load", serverFull, root, toolCtx.mode, toolCtx.mw);
    if (targetRoot === undefined) continue;
    // 先建单元（惰性连接入口），再确保该服务器连接，最后等 in-flight 发现收敛。
    const unit = await toolCtx.mw.projectUnitFor(targetRoot);
    if (unit === undefined) continue;
    await toolCtx.mw.ensureConnected(targetRoot, want.server);
    await waitForDiscovery(unit);
    const catalog = unit.catalog.get(want.server);
    if (catalog === undefined) continue;
    if (catalog.unavailable !== undefined) return { server: fullServerName(targetRoot, want.server), reason: catalog.unavailable };
    const entry = catalog.tools.get(want.tool);
    if (entry === undefined) continue;
    return { targetRoot, entry };
  }
  return undefined;
}

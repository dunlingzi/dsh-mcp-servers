/**
 * dsh-mcp-servers — connection/orchestrator/probe.ts：单次探活（设置页「测试」按钮）。
 *
 * 从 manager.ts 迁入（P3 拆分，行为逐字保持）：对目标服务器做一次性 MCP 连接
 * （initialize + tools/list，报告延迟与工具数），连接即断、不改任何连接状态、
 * 不注册工具——与 supervisor / 中间层连接池完全独立。
 *
 * 依赖经 ProbeDeps 显式注入（store / 项目 store 解析 / 运行时注册表 / 脱敏），
 * 故本文件不引用 McpServers 类，也不 import 本域门面（避免 interface → impl 回边）。
 */
import { SCOPE_GLOBAL, SCOPE_PROJECT } from "../../workspace/interface.ts";
import { createTransport, MCPClient } from "../runtime/interface.ts";
import { withTimeout } from "../../pipeline/interface.ts";
import type { McpStore } from "../../config/store/interface.ts";
import type { ServerConfig } from "../../types/interface.ts";

/** 单次探活硬超时（initialize + tools/list 全程；与连接超时无关的独立上限）。 */
export const PROBE_TIMEOUT_MS = 15_000;

/** 探活所需的最小宿主面（由 McpServers 装配）。 */
export interface ProbeDeps {
  /** 全局服务器存储。 */
  globalStore: McpStore;
  /** 当前会话的项目级存储（无活动项目时抛错）。 */
  projectStoreOrThrow: () => Promise<McpStore>;
  /** 运行时注册表（探活对 runtime 注入条目同样可见，与 connect 同口径）。 */
  runtimeRegistry: Map<string, ServerConfig>;
  /** 错误脱敏（与日志 / HTTP body 同口径）。 */
  redact: (error: unknown) => string;
}

/**
 * 对 `name`（scope 指定的存储）做一次性连接与工具清点。
 * 返回 `{ ok, latencyMs, toolCount?, serverInfo?, error? }`；未找到服务器时抛错。
 */
export async function probeServer(deps: ProbeDeps, name: string, scope: string): Promise<Record<string, unknown>> {
  const store = scope === SCOPE_PROJECT ? await deps.projectStoreOrThrow() : deps.globalStore;
  let server = store.find(name);
  // runtime 注入条目不落 store：global scope 查不到时回退 runtimeRegistry（与 connect 同口径）。
  if (server === undefined && scope === SCOPE_GLOBAL) {
    const runtime = deps.runtimeRegistry.get(name);
    if (runtime !== undefined) server = runtime;
  }
  if (server === undefined) throw new Error(`server "${name}" not found in ${scope} scope`);
  const startedAt = Date.now();
  const transport = createTransport(server);
  const client = new MCPClient(transport);
  try {
    const serverInfo = await withTimeout(client.initialize(), PROBE_TIMEOUT_MS, `probe initialize timed out (${PROBE_TIMEOUT_MS}ms)`);
    const tools = await withTimeout(client.listTools(), PROBE_TIMEOUT_MS, `probe tools/list timed out (${PROBE_TIMEOUT_MS}ms)`);
    const toolList = Array.isArray((tools as { tools?: unknown[] })?.tools) ? (tools as { tools: unknown[] }).tools : [];
    return { ok: true, latencyMs: Date.now() - startedAt, toolCount: toolList.length, serverInfo };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - startedAt, error: deps.redact(error) };
  } finally {
    try {
      await transport.close();
    } catch {
      // 子进程已退出 / 连接未建立：close 失败不影响探活结论
    }
  }
}

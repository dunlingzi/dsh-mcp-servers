/**
 * dsh-mcp-servers — inject/lazy-registrar.ts：lazy 模式的按需定义注册器。
 *
 * 职责：持有「谁装载了什么」，把中间层目录里的单工具投影成真实 `ToolDefinition`，
 * 注册进**调用者 agent 的作用域**（取不到时回退全局层），提供幂等装载与精确释放。
 *
 * 三条硬约束（设计稿 §3）：
 * - C1 不写 `deferLoading`：宿主只会在 update 投影时自动补该标记；提前写在
 *   baseline 工具上永远不会产生 `tool-addition`，工具变哑弹。
 * - C2 会话中途不卸载：`addition-only` 路由丢弃 `tool-removal`，但历史里的
 *   `tool_addition` 仍引用该工具——卸载会造成「引用未声明工具」的不一致。
 *   回收只发生在「服务器被删除 / 插件卸载 / agent 作用域销毁」。
 * - C4 注册幂等：同名重复装载返回 alreadyLoaded，绝不抛错。
 *
 * 状态全部收在 `createRegistrar` 闭包内（模块级禁止可变状态，见
 * scripts/gate/forbid-module-state-src.mjs）：同一进程内多次 apply 互不污染。
 */

import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { publicToolName, CONNECT_TIMEOUT_MS, DISCOVERY_TIMEOUT_MS, CALL_TIMEOUT_MS } from "../connection/runtime/interface.ts";
import type { McpMiddleware } from "../connection/runtime/interface.ts";
import type { LazyLoadable, LazyRegistrarStats, Registrar } from "../types/interface.ts";
import { fullServerName } from "../workspace/interface.ts";
import { msgOf } from "../pipeline/interface.ts";

/** 装载记录（精确 disposer + 归属，供按服务器 / 全量回收）。 */
interface LoadedEntry {
  dispose: () => void;
  server: string;
  tool: string;
}

/** agent（或全局回退槽）→ publicName → 装载记录。 */
type LoadedBucket = Map<string, LoadedEntry>;

/** 注册器依赖的宿主上下文最小面（Context.tools 已由 dsh-tools 声明合并注入）。 */
type ToolsRegistry = Pick<Context["tools"], "register">;

/** 从 agent 上取「调用者作用域」的工具注册表；不可用时返回 undefined。 */
function scopedRegistry(agent: unknown): ToolsRegistry | undefined {
  if (typeof agent !== "object" || agent === null) return undefined;
  const tools = (agent as { ctx?: { tools?: unknown } }).ctx?.tools;
  if (typeof tools !== "object" || tools === null || typeof (tools as { register?: unknown }).register !== "function") return undefined;
  return tools as ToolsRegistry;
}

/** 幂等 disposer（宿主 effect 卸载与注册器回收可能重复触发）。 */
function once(dispose: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    dispose();
  };
}

/** 目录条目 → 模型面工具定义（名称/参数/schema 投影契约，与直挂路径同源）。
 * @param mw 中间层实例（execute 复用 callTool：策略/禁用/超时/结果投影同源）。
 * @param root 目标工作空间 root（可与调用方不同：@global 单元）。
 * @param inputSchema MCP 远端 inputSchema（原样直传，dsh 注册不校验 parameters）。
 * @param description 模型面描述（空描述由调用方兜底）。
 */
export function buildLazyDefinition(
  mw: McpMiddleware,
  root: string,
  server: string,
  tool: string,
  inputSchema: Record<string, unknown>,
  description: string,
  stats?: LazyRegistrarStats,
): ToolDefinition {
  const serverFull = fullServerName(root, server);
  return {
    name: publicToolName(server, tool),
    description,
    parameters: inputSchema,
    output: {
      // 与 ws_mcp_call 完全同形的输出契约（content 数组 + 可选 structuredContent）：
      // callTool 的投影结果在此 schema 内必然通过校验。
      schema: {
        type: "object",
        properties: { content: { type: "array", items: {} }, structuredContent: {} },
        required: ["content"],
        additionalProperties: false,
      },
      render(_args: unknown, value: unknown) {
        const content = Array.isArray((value as { content?: unknown })?.content) ? ((value as { content: unknown[] }).content) : [];
        const text = content
          .map((block) => {
            const rec = (block ?? {}) as Record<string, unknown>;
            if (rec.type === "text" && typeof rec.text === "string") return rec.text;
            if (rec.type === "resource" || rec.type === "resource_link") return "[resource: content discarded]";
            return `[${String(rec.type ?? "unknown")} content]`;
          })
          .join("\n");
        return [{ type: "text" as const, text: text !== "" ? text : "(MCP tool returned no content)" }];
      },
    },
    isConcurrencySafe: () => true,
    // 与 ws_mcp_call 同预算（建连 + 发现 + 调用 + 兜底），声明式（实际超时由策略包装器管）。
    timeoutMs: CONNECT_TIMEOUT_MS + DISCOVERY_TIMEOUT_MS + CALL_TIMEOUT_MS + 5000,
    execute: async (args, exec) => {
      // 服务器断连时定义保留（C2）：callTool 会给出「未连接 / 可重连」的可行动错误。
      const startedAt = Date.now();
      try {
        const result = await mw.callTool(serverFull, tool, args, exec.signal, exec.agent);
        if (stats?.isEnabled?.() === true) stats.recordCall?.(server, tool, Date.now() - startedAt, true);
        return result;
      } catch (error) {
        if (stats?.isEnabled?.() === true) {
          stats.recordCall?.(server, tool, Date.now() - startedAt, false, msgOf(error));
        }
        throw error;
      }
    },
  };
}

/**
 * 创建注册器（每个插件实例一个；状态在闭包内）。
 * @param ctx 插件根上下文（全局回退层的注册表）。
 * @param options.stats 可选统计面（recordLoad / setLoadedTools）。
 */
export function createRegistrar(ctx: Context, options: { stats?: LazyRegistrarStats } = {}): Registrar {
  const stats = options.stats;
  /** agent 作用域装载桶（WeakMap 不可枚举，另存一份供服务器删除 / 全量清理遍历）。 */
  const buckets = new WeakMap<object, LoadedBucket>();
  const allBuckets = new Set<LoadedBucket>();
  /** 全局回退（取不到 agent.ctx 时）：publicName → 装载记录。 */
  const globalLoaded: LoadedBucket = new Map();

  const count = (): number => {
    let total = globalLoaded.size;
    for (const bucket of allBuckets) total += bucket.size;
    return total;
  };

  const notifyCount = (): void => {
    stats?.setLoadedTools?.(count());
  };

  const bucketFor = (agent: unknown): LoadedBucket | undefined => {
    if (scopedRegistry(agent) === undefined || typeof agent !== "object" || agent === null) return undefined;
    let bucket = buckets.get(agent);
    if (bucket === undefined) {
      bucket = new Map<string, LoadedEntry>();
      buckets.set(agent, bucket);
      allBuckets.add(bucket);
    }
    return bucket;
  };

  const removeEntry = (bucket: LoadedBucket, name: string): boolean => {
    const entry = bucket.get(name);
    if (entry === undefined) return false;
    entry.dispose();
    bucket.delete(name);
    return true;
  };

  return {
    load(agent, definitions) {
      const activated: string[] = [];
      const alreadyLoaded: string[] = [];
      const scoped = scopedRegistry(agent);
      const bucket = scoped === undefined ? undefined : bucketFor(agent);
      for (const { definition, server, tool } of definitions) {
        const name = definition.name;
        // 同一 agent 已装载 → 幂等（C4）；全局回退槽同名只注册一次。
        if (bucket?.has(name) === true || (bucket === undefined && globalLoaded.has(name))) {
          alreadyLoaded.push(name);
          continue;
        }
        if (bucket !== undefined && scoped !== undefined) {
          // agent 作用域：随 agent fiber 回收，不跨会话可见。
          const dispose = scoped.register(definition);
          bucket.set(name, { dispose: once(dispose), server, tool });
        } else {
          // 全局回退：同 publicName 只注册一次（C4），不做引用计数——C2 决定
          // 会话中途不卸载，计数只会增加出错面；真正回收只发生在 dispose*。
          const dispose = ctx.tools.register(definition);
          globalLoaded.set(name, { dispose: once(dispose), server, tool });
        }
        activated.push(name);
        if (stats?.isEnabled?.() === true) stats.recordLoad?.(server, tool);
      }
      if (activated.length > 0) notifyCount();
      return { activated, alreadyLoaded };
    },

    isLoadedBy(agent, publicName) {
      const bucket = typeof agent === "object" && agent !== null ? buckets.get(agent) : undefined;
      if (bucket !== undefined) return bucket.has(publicName);
      // agent 作用域不可得：只有全局回退槽可能提供该工具。
      return globalLoaded.has(publicName);
    },

    isRegistered(publicName) {
      if (globalLoaded.has(publicName)) return true;
      for (const bucket of allBuckets) {
        if (bucket.has(publicName)) return true;
      }
      return false;
    },

    loadedCount: count,

    disposeAgent(agent) {
      if (typeof agent !== "object" || agent === null) return;
      const bucket = buckets.get(agent);
      if (bucket === undefined) return;
      for (const name of [...bucket.keys()]) removeEntry(bucket, name);
      buckets.delete(agent);
      allBuckets.delete(bucket);
      notifyCount();
    },

    disposeServer(server) {
      let changed = false;
      for (const name of [...globalLoaded.keys()]) {
        if (globalLoaded.get(name)?.server !== server) continue;
        changed = removeEntry(globalLoaded, name) || changed;
      }
      for (const bucket of allBuckets) {
        for (const name of [...bucket.keys()]) {
          if (bucket.get(name)?.server !== server) continue;
          changed = removeEntry(bucket, name) || changed;
        }
      }
      if (changed) notifyCount();
    },

    disposeAll() {
      // 以回收前的总数判「是否真的变了」：只有 agent 侧桶有装载时 globalLoaded.size
      // 为 0，不能据此跳过回填（否则 stats.loadedTools 停在旧值）。
      const before = count();
      for (const name of [...globalLoaded.keys()]) removeEntry(globalLoaded, name);
      for (const bucket of allBuckets) {
        for (const name of [...bucket.keys()]) removeEntry(bucket, name);
      }
      allBuckets.clear();
      if (before > 0) notifyCount();
    },
  };
}

// @ts-nocheck
/**
 * dsh-mcp-servers — integration：lazy 模式的注册面 / 热切换 / 接管口径。
 *
 * 覆盖设计稿 §6 的 integration 行：
 * - middlewareTakes(lazy, global) → true（无双进程：不建 supervisor）；
 * - registerMiddlewareTools(mode="lazy") → 5 个工具；project/all 仍 4 个（unit 已覆盖，此处锁热切换面）；
 * - 热切换 all → lazy：旧 disposer 全部释放、装载器可用、无重复注册抛错、section 文案重建；
 * - 文案三处一致性：lazy 引导含 ws_mcp_load，且不再说「不要直呼 mcp__」。
 *
 * 手法：真实 registerMiddlewareTools + 真实中间层实例（宿主桩）+ 结构 manager 桩；
 * 全程零子进程、零网络。
 */
import { describe, expect, it } from "vitest";

const {
  McpMiddleware,
  registerMiddlewareTools,
  createRegistrar,
  makeMiddlewareHotSwitch,
  normalizeMiddlewareMode,
  MIDDLEWARE_GLOBAL_ROOT,
  SCOPE_GLOBAL,
  SCOPE_PROJECT,
} = await import("../../src/index.ts");
const { middlewareTakes } = await import("../../src/connection/orchestrator/middleware-bridge.ts");
const { reconcileServers, startServer } = await import("../../src/connection/orchestrator/reconcile.ts");
const { mcpGuidance, MCP_GUIDANCE } = await import("../../src/bootstrap/apply-guidance.ts");
const { McpStore } = await import("../../src/index.ts");

const ROOT = "/proj";

function makeHost() {
  return {
    ctx: { tools: { register: () => () => {} } },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    projectServersFor: async () => undefined,
    globalServers: () => [],
    normalizedProjectRoot: async (cwd) => (cwd === ROOT ? ROOT : undefined),
    saveUserState: async () => {},
    emitStatus: () => {},
    catalogCachePath: () => "/tmp/dsh-mcp-servers-nonexistent-cache.json",
    isGlobalServer: () => false,
  };
}

/** ctx 桩：记录注册表（重名即抛，证明热切换不重复注册），并暴露 tools/pre-execute。 */
function makeCtx() {
  const registered = new Map();
  const listeners = new Map();
  const ctx = {
    tools: {
      register(definition) {
        if (registered.has(definition.name)) throw new Error(`duplicate tool: ${definition.name}`);
        registered.set(definition.name, definition);
        return () => registered.delete(definition.name);
      },
    },
    on(event, handler) {
      listeners.set(event, handler);
      return () => listeners.delete(event);
    },
  };
  return { ctx, registered, listeners };
}

// ---------------------------------------------------------------------------
// 接管判定（防双进程）
// ---------------------------------------------------------------------------

describe("middlewareTakes：lazy 与 all 同口径覆盖全局服务器", () => {
  const mw = {};
  const hostOf = (mode) => ({ middleware: mw, middlewareMode: mode, projectRoot: undefined, projectStore: undefined, logger: { warn: () => {} } });

  it("lazy + 全局 → 由连接池接管（不建 supervisor）", () => {
    expect(middlewareTakes(hostOf("lazy"), "dbx", SCOPE_GLOBAL)).toBe(true);
  });

  it("lazy + 项目 → 接管", () => {
    expect(middlewareTakes(hostOf("lazy"), "proj", SCOPE_PROJECT)).toBe(true);
  });

  it("project + 全局 → 不接管（保持 mcp__ 直挂）", () => {
    expect(middlewareTakes(hostOf("project"), "dbx", SCOPE_GLOBAL)).toBe(false);
  });

  it("off → 一律不接管", () => {
    expect(middlewareTakes(hostOf("off"), "dbx", SCOPE_GLOBAL)).toBe(false);
    expect(middlewareTakes(hostOf("off"), "proj", SCOPE_PROJECT)).toBe(false);
  });

  it("lazy 模式 reconcile：全局服务器只触达 @global 单元，supervisor 集合保持为空", () => {
    const store = new McpStore("/tmp/dsh-mcp-servers-lazy-int-store.json");
    store.data = { version: 1, servers: [{ name: "g1", transport: "stdio", command: "echo", enabled: true }] };
    const mw = new McpMiddleware(makeHost(), {});
    const host = {
      store,
      projectStore: undefined,
      runtimeRegistry: new Map(),
      supervisors: new Map(),
      middleware: mw,
      middlewareMode: "lazy",
      projectRoot: ROOT,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      reconcileBusy: false,
      emitStatus: () => {},
    };
    const calls = [];
    reconcileServers(host, {
      middlewareTakes: (name, scope) => middlewareTakes(host, name, scope),
      stop: (name) => calls.push(["stop", name]),
      start: (name, scope) => {
        calls.push(["start", name, scope]);
        // start 内部下沉接管：与 host.reconcileServers 同款接线
        startServer(host, {
          middlewareTakes: (n, s) => middlewareTakes(host, n, s),
          ensureMiddlewareServer: (n) => calls.push(["pool-project", n]),
          touchGlobalUnit: (n) => calls.push(["pool-global", n]),
        }, name, scope);
      },
    });
    expect(calls).toEqual([["start", "g1", SCOPE_GLOBAL], ["pool-global", "g1"]]);
    // 关键不变量：没有任何 supervisor 被创建（否则同一 server 双进程）
    expect(host.supervisors.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 热切换
// ---------------------------------------------------------------------------

describe("热切换 all → lazy：注册面重建 + 文案重建", () => {
  function makeSwitchEnv() {
    const { ctx, registered, listeners } = makeCtx();
    const mw = new McpMiddleware(makeHost(), {});
    const registrar = createRegistrar(ctx, {});
    const resolveRoot = async (agent) => (agent?.session?.header?.cwd === ROOT ? ROOT : undefined);
    const events = { reconciled: 0, emitted: 0, sections: [] };
    const manager = {
      middlewareMode: "all",
      ctx,
      disabledTools: new Map(),
      stats: { isEnabled: () => false },
      middleware: mw,
      initMiddleware: async (mode) => {
        manager.middlewareMode = mode;
        return mw;
      },
      reconcileServers: () => {
        events.reconciled += 1;
        return true;
      },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      emitStatus: () => {
        events.emitted += 1;
      },
    };
    const holder = {
      current: registerMiddlewareTools(ctx, mw, resolveRoot, "all", { registrar }),
    };
    const hotSwitch = makeMiddlewareHotSwitch(manager, {}, resolveRoot, holder, {
      registrar,
      onModeApplied: (mode) => events.sections.push(mcpGuidance(mode)),
    });
    return { ctx, registered, listeners, mw, registrar, manager, holder, hotSwitch, events };
  }

  it("切到 lazy：4 个旧工具释放，重注册为 5 个（含 ws_mcp_load），无重复注册抛错", async () => {
    const env = makeSwitchEnv();
    expect([...env.registered.keys()]).toHaveLength(4);
    await env.hotSwitch("lazy");
    expect(env.manager.middlewareMode).toBe("lazy");
    expect([...env.registered.keys()].sort()).toEqual(["ws_mcp_call", "ws_mcp_detail", "ws_mcp_list", "ws_mcp_load", "ws_mcp_search"]);
    expect(env.events.reconciled).toBe(1);
    expect(env.events.emitted).toBeGreaterThanOrEqual(1);
  });

  it("切到 lazy：section 按新模式重建，文案含 ws_mcp_load 且不再禁止直呼 mcp__", async () => {
    const env = makeSwitchEnv();
    await env.hotSwitch("lazy");
    expect(env.events.sections).toHaveLength(1);
    const text = env.events.sections[0];
    expect(text).toContain("ws_mcp_load");
    expect(text).toContain("Lazy mode (lazy)");
    expect(text).not.toContain("Do NOT call mcp__ prefixed tools directly");
    expect(text).toContain("Do not retry a failing server tool more than twice");
  });

  it("同模式重复提交 → 完全 no-op（不重复重建）", async () => {
    const env = makeSwitchEnv();
    await env.hotSwitch("all");
    expect(env.events.reconciled).toBe(0);
    expect(env.events.sections).toHaveLength(0);
    expect([...env.registered.keys()]).toHaveLength(4);
  });

  it("lazy → all：装回 4 个工具（装载器消失），已装载的真实定义不被卸载（C2）", async () => {
    const env = makeSwitchEnv();
    await env.hotSwitch("lazy");
    const { buildLazyDefinition } = await import("../../src/index.ts");
    env.registrar.load({}, [{ definition: buildLazyDefinition(env.mw, ROOT, "dbx", "q", {}, "d"), server: "dbx", tool: "q" }]);
    await env.hotSwitch("all");
    expect(env.registered.has("ws_mcp_load")).toBe(false);
    // C2：会话中途不卸载已装载的真实工具
    expect(env.registrar.isRegistered("mcp__dbx__q")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 文案一致性
// ---------------------------------------------------------------------------

describe("mcpGuidance：三处文案同源（lazy 不再是「禁止直呼」）", () => {
  it("project / all / off 保持既有文案（字节等价）", () => {
    expect(mcpGuidance("project")).toBe(MCP_GUIDANCE);
    expect(mcpGuidance("all")).toBe(MCP_GUIDANCE);
    expect(mcpGuidance(normalizeMiddlewareMode("weird"))).toBe(MCP_GUIDANCE);
  });

  it("lazy 换成装载引导", () => {
    const text = mcpGuidance("lazy");
    expect(text).toContain("ws_mcp_search");
    expect(text).toContain("ws_mcp_load");
    expect(text).toContain("mcp__<server>__<tool>");
    expect(text.startsWith("dsh-mcp-servers is active:")).toBe(true);
  });
});

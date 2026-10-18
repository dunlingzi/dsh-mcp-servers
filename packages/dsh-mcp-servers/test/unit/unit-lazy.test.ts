// @ts-nocheck
/**
 * dsh-mcp-servers — unit：lazy 模式（模式判定 / 按需注册器 / ws_mcp_load）。
 *
 * 覆盖设计稿 §6 的 unit 行：
 * - normalizeRef 三种写法解析到同一目标；非法输入进 missing；
 * - registrar.load 幂等（同名二次装载 alreadyLoaded，register 只调一次）；
 * - registrar.load 走 agent 作用域（exec.agent.ctx.tools.register，根 ctx 不被调用）；
 * - 全局回退去重（两个 agent 装载同名工具 → register 只一次）；
 * - disposeServer / disposeAgent / disposeAll 精确回收；
 * - 禁用 / 策略早失败（不进入 register，文案含 ws_mcp_load）；
 * - ws_mcp_load 输出 schema 通过宿主 JSON Schema 子集校验；
 * - 模式归一化（lazy 不被静默降级成 off）与 coversGlobal；
 * - resolveRoot 无项目 cwd 时 lazy 回落 @global。
 *
 * 手法与 unit-inject-tools.test.ts 同源：真实 McpMiddleware + 手工投影单元
 * （不走 projectUnitFor 的惰性连接路径，故不 spawn 任何子进程）。
 */
import { describe, expect, it } from "vitest";

const {
  normalizeMiddlewareMode,
  coversGlobal,
  createRegistrar,
  buildLazyDefinition,
  makeResolveRoot,
  fullServerName,
  parseFullServerName,
  McpMiddleware,
  registerMiddlewareTools,
  assertSupportedOutputSchema,
  Config,
  resolveMiddlewareMode,
  MIDDLEWARE_GLOBAL_ROOT,
} = await import("../../src/index.ts");
const { buildLoadTool } = await import("../../src/inject/tools/load.ts");

/**
 * 输出值契约校验（比宿主 schema 更严：额外键 / 缺失 required 键一律判红）。
 *
 * 为什么不自接引入宿主 `validateJsonSchemaValue`：本仓库依赖树里 `@deepseek-ai/dsh-tools`
 * 的 peer `@deepseek-ai/dsh-scope` 未安装，运行时 import 会因解析失败而整份 fixture
 * 崩掉（e2e 对同一问题采用「解析不到则告警跳过」的既有策略）。故这里按 schema 逐键
 * 手写等价断言（additionalProperties:false / required 全集 / 字段类型），并附
 * lossless JSON 校验；schema 本身是否落在宿主支持子集由 assertSupportedOutputSchema
 * （官方规则的本仓镜像）硬断言。
 */
function loadResultViolations(value) {
  const errors = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ["root must be an object"];
  const allowedRoot = ["activated", "alreadyLoaded", "missing", "unavailable", "message"];
  for (const key of Object.keys(value)) if (!allowedRoot.includes(key)) errors.push(`unexpected key: ${key}`);
  for (const key of allowedRoot) if (!Object.hasOwn(value, key)) errors.push(`missing required key: ${key}`);
  if (!Array.isArray(value.activated)) {
    errors.push("activated must be an array");
  } else {
    const allowedEntry = ["name", "server", "tool", "description", "required"];
    value.activated.forEach((item, index) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        errors.push(`activated[${index}] must be an object`);
        return;
      }
      for (const key of Object.keys(item)) if (!allowedEntry.includes(key)) errors.push(`activated[${index}] unexpected key: ${key}`);
      for (const key of allowedEntry) if (!Object.hasOwn(item, key)) errors.push(`activated[${index}] missing key: ${key}`);
      for (const key of ["name", "server", "tool", "description"]) {
        if (typeof item[key] !== "string") errors.push(`activated[${index}].${key} must be a string`);
      }
      if (!Array.isArray(item.required) || item.required.some((name) => typeof name !== "string")) {
        errors.push(`activated[${index}].required must be string[]`);
      }
    });
  }
  for (const key of ["alreadyLoaded", "missing"]) {
    if (!Array.isArray(value[key]) || value[key].some((name) => typeof name !== "string")) errors.push(`${key} must be string[]`);
  }
  if (!Array.isArray(value.unavailable)) {
    errors.push("unavailable must be an array");
  } else {
    value.unavailable.forEach((item, index) => {
      if (typeof item !== "object" || item === null) {
        errors.push(`unavailable[${index}] must be an object`);
        return;
      }
      if (typeof item.server !== "string" || typeof item.reason !== "string") errors.push(`unavailable[${index}] server/reason must be strings`);
      for (const key of Object.keys(item)) if (key !== "server" && key !== "reason") errors.push(`unavailable[${index}] unexpected key: ${key}`);
    });
  }
  if (typeof value.message !== "string") errors.push("message must be a string");
  try {
    const roundTrip = JSON.parse(JSON.stringify(value));
    if (JSON.stringify(roundTrip) !== JSON.stringify(value)) errors.push("value is not lossless JSON");
  } catch {
    errors.push("value is not lossless JSON");
  }
  return errors;
}

const ROOT = "/proj";
const GLOBAL_ROOT = MIDDLEWARE_GLOBAL_ROOT;
const full = (root, server) => fullServerName(root, server);

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 宿主最小面桩（与 unit-inject-tools 同形）。 */
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

/** 目录工具条目。 */
function catalogTool(description, properties = {}, required = []) {
  return { description, inputSchema: { type: "object", properties, ...(required.length > 0 ? { required } : {}) } };
}

/** 手工构造单元（字段与 ProjectUnit 契约一致；connections 空 → 无真实连接）。 */
function makeUnit(root, catalogEntries = []) {
  return {
    root,
    connections: new Map(),
    catalog: new Map(catalogEntries),
    userDisabled: new Set(),
    lastTouchedAt: Date.now(),
    inFlight: new Map(),
  };
}

/** 真实中间层 + 预置单元 + 连接面桩。 */
function makeMw(units = []) {
  const mw = new McpMiddleware(makeHost(), {});
  for (const [root, unit] of units) mw.units.set(root, unit);
  // 连接面桩：预置单元已视为已连接（避免 spawn）。
  mw.ensureConnected = async () => {};
  return mw;
}

/** 结构符合 Registrar 的宿主上下文：记录注册 / 注销，重名即抛（证明幂等）。 */
function makeRegistrarCtx() {
  const registered = new Map();
  const disposals = [];
  const ctx = {
    tools: {
      register(definition) {
        if (registered.has(definition.name)) throw new Error(`duplicate tool: ${definition.name}`);
        registered.set(definition.name, definition);
        const dispose = () => {
          disposals.push(definition.name);
          registered.delete(definition.name);
        };
        return dispose;
      },
    },
  };
  return { ctx, registered, disposals };
}

/** agent 桩：带自己的作用域注册表（模拟 agent.ctx.tools）。 */
function makeScopedAgent(cwd = ROOT) {
  const scoped = makeRegistrarCtx();
  return {
    agent: { session: { header: { cwd } }, ctx: { tools: scoped.ctx.tools } },
    registered: scoped.registered,
    disposals: scoped.disposals,
  };
}

/** 统计面桩：记录装载与回填的已装载数。 */
function makeStats(enabled = true) {
  const calls = [];
  const counts = [];
  return {
    calls,
    counts,
    isEnabled: () => enabled,
    recordCall: (server, tool, durationMs, success, errorMsg) =>
      calls.push(["call", server, tool, typeof durationMs === "number", success, errorMsg]),
    recordLoad: (server, tool) => calls.push(["load", server, tool]),
    setLoadedTools: (count) => counts.push(count),
  };
}

function definitionFor(mw, { root = ROOT, server = "dbx", tool = "dbx_execute_query", description = "Run a SQL query", schema } = {}) {
  return {
    definition: buildLazyDefinition(
      mw,
      root,
      server,
      tool,
      schema ?? { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
      description,
    ),
    server,
    tool,
  };
}

// ---------------------------------------------------------------------------
// 模式判定
// ---------------------------------------------------------------------------

describe("normalizeMiddlewareMode / coversGlobal（lazy 不被静默降级）", () => {
  it("lazy 归一化后仍是 lazy（防静默降级成 off）", () => {
    expect(normalizeMiddlewareMode("lazy")).toBe("lazy");
  });

  it("其它合法值与非法的既有口径不变", () => {
    expect(normalizeMiddlewareMode("off")).toBe("off");
    expect(normalizeMiddlewareMode("project")).toBe("project");
    expect(normalizeMiddlewareMode("all")).toBe("all");
    expect(normalizeMiddlewareMode("bogus")).toBe("off");
    expect(normalizeMiddlewareMode(undefined)).toBe("off");
  });

  it("coversGlobal：off/project 不覆盖全局，all/lazy 覆盖", () => {
    expect(coversGlobal("off")).toBe(false);
    expect(coversGlobal("project")).toBe(false);
    expect(coversGlobal("all")).toBe(true);
    expect(coversGlobal("lazy")).toBe(true);
  });
});

describe("resolveRoot：lazy 与 all 同口径回落 @global", () => {
  function managerWithMode(mode, globalServers = []) {
    return {
      middlewareMode: mode,
      projectServersFor: async (root) => (root === GLOBAL_ROOT ? globalServers : undefined),
    };
  }

  it("lazy + 无项目 cwd + 有全局服务器 → @global", async () => {
    const resolve = makeResolveRoot(managerWithMode("lazy", [{ name: "dbx", enabled: true }]));
    expect(await resolve({ session: { header: { cwd: undefined } } })).toBe(GLOBAL_ROOT);
  });

  it("lazy + 无全局服务器 → undefined（保持项目语义）", async () => {
    const resolve = makeResolveRoot(managerWithMode("lazy", []));
    expect(await resolve({ session: { header: { cwd: undefined } } })).toBeUndefined();
  });

  it("project 保持现状：无项目 cwd → undefined", async () => {
    const resolve = makeResolveRoot(managerWithMode("project", [{ name: "dbx", enabled: true }]));
    expect(await resolve({ session: { header: { cwd: undefined } } })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// P4：默认中间层模式 = lazy（Config 默认与运行时回落必须同源）
// ---------------------------------------------------------------------------

describe("默认中间层模式 lazy（P4）", () => {
  it("Config({}) 默认 lazy；四个模式都仍是合法值域", () => {
    expect(Config({}).middleware).toBe("lazy");
    expect(Config({ middleware: "off" }).middleware).toBe("off");
    expect(Config({ middleware: "project" }).middleware).toBe("project");
    expect(Config({ middleware: "all" }).middleware).toBe("all");
    expect(Config({ middleware: "lazy" }).middleware).toBe("lazy");
  });

  it("resolveMiddlewareMode：无持久化值且无显式配置 → lazy（与 schema 默认同源）", () => {
    const manager = { uiConfigSource: () => ({}) };
    expect(resolveMiddlewareMode(manager, undefined)).toBe("lazy");
  });

  it("resolveMiddlewareMode：显式配置优先于默认", () => {
    expect(resolveMiddlewareMode({ uiConfigSource: () => ({}) }, "project")).toBe("project");
  });

  it("resolveMiddlewareMode：settings 持久化值优先于显式配置（用户选择不被覆盖）", () => {
    const manager = { uiConfigSource: () => ({ middleware: "all" }) };
    expect(resolveMiddlewareMode(manager, "lazy")).toBe("all");
  });
});

// ---------------------------------------------------------------------------
// buildLazyDefinition
// ---------------------------------------------------------------------------

describe("buildLazyDefinition：模型面定义与执行同源", () => {
  it("名字走 publicToolName（与直挂路径同名契约）", () => {
    const mw = makeMw();
    const { definition } = definitionFor(mw);
    expect(definition.name).toBe("mcp__dbx__dbx_execute_query");
    expect(definition.parameters.required).toEqual(["sql"]);
    expect(definition.isConcurrencySafe()).toBe(true);
    expect(typeof definition.timeoutMs).toBe("number");
  });

  it("C1：不带 deferLoading（提前标记永远等不到 tool-addition）", () => {
    const { definition } = definitionFor(makeMw());
    expect(Object.prototype.hasOwnProperty.call(definition, "deferLoading")).toBe(false);
  });

  it("execute 走 mw.callTool（策略/禁用/超时/投影同源）", async () => {
    const mw = makeMw();
    const seen = [];
    mw.callTool = async (...args) => {
      seen.push(args);
      return { content: [{ type: "text", text: "ok" }] };
    };
    const { definition } = definitionFor(mw, { root: GLOBAL_ROOT });
    const agent = { id: "a1" };
    const signal = new AbortController().signal;
    const value = await definition.execute({ sql: "select 1" }, { signal, agent });
    expect(value).toEqual({ content: [{ type: "text", text: "ok" }] });
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBe(full(GLOBAL_ROOT, "dbx"));
    expect(seen[0][1]).toBe("dbx_execute_query");
    expect(seen[0][2]).toEqual({ sql: "select 1" });
    expect(seen[0][3]).toBe(signal);
    expect(seen[0][4]).toBe(agent);
  });

  it("execute 失败时原样上抛并记一次失败统计", async () => {
    const mw = makeMw();
    const stats = makeStats();
    mw.callTool = async () => {
      throw new Error("server 未连接");
    };
    const definition = buildLazyDefinition(mw, ROOT, "dbx", "t", {}, "d", stats);
    await expect(definition.execute({}, {})).rejects.toThrow("server 未连接");
    expect(stats.calls).toEqual([["call", "dbx", "t", true, false, "server 未连接"]]);
  });

  it("render 投影 content：文本直出、资源降级占位、空返回兜底", () => {
    const { definition } = definitionFor(makeMw());
    const blocks = definition.output.render({}, {
      content: [{ type: "text", text: "line1" }, { type: "resource_link", uri: "file:///x" }, { type: "image", mimeType: "image/png" }],
    });
    expect(blocks[0].text).toBe("line1\n[resource: content discarded]\n[image content]");
    expect(definition.output.render({}, { content: [] })[0].text).toBe("(MCP tool returned no content)");
  });

  it("输出 schema 落在宿主支持子集（含 structuredContent 可选键）", () => {
    const { definition } = definitionFor(makeMw());
    // assertSupportedOutputSchema = 宿主 assertSupportedJsonSchema 的本仓镜像；
    // 返回 undefined 即「含不支持关键字」，必须原样返回 schema 才算通过。
    expect(assertSupportedOutputSchema(definition.output.schema)).toBe(definition.output.schema);
    // 结构等价性：content 必填、structuredContent 可选
    expect(definition.output.schema.required).toEqual(["content"]);
    expect(definition.output.schema.additionalProperties).toBe(false);
    expect(Object.keys(definition.output.schema.properties).sort()).toEqual(["content", "structuredContent"]);
  });
});

// ---------------------------------------------------------------------------
// createRegistrar
// ---------------------------------------------------------------------------

describe("createRegistrar：作用域 / 幂等 / 回收", () => {
  it("agent 作用域注册：exec.agent.ctx.tools.register 被调用，根 ctx 未被调用", () => {
    const root = makeRegistrarCtx();
    const registrar = createRegistrar(root.ctx, {});
    const scoped = makeScopedAgent();
    const mw = makeMw();
    const result = registrar.load(scoped.agent, [definitionFor(mw)]);
    expect(result.activated).toEqual(["mcp__dbx__dbx_execute_query"]);
    expect(result.alreadyLoaded).toEqual([]);
    expect(scoped.registered.has("mcp__dbx__dbx_execute_query")).toBe(true);
    expect(root.registered.size).toBe(0);
  });

  it("同名二次装载 → alreadyLoaded，register 只调一次（C4）", () => {
    const root = makeRegistrarCtx();
    const registrar = createRegistrar(root.ctx, {});
    const scoped = makeScopedAgent();
    const mw = makeMw();
    const first = registrar.load(scoped.agent, [definitionFor(mw)]);
    const second = registrar.load(scoped.agent, [definitionFor(mw)]);
    expect(first.activated).toHaveLength(1);
    expect(second.activated).toEqual([]);
    expect(second.alreadyLoaded).toEqual(["mcp__dbx__dbx_execute_query"]);
    expect(scoped.registered.size).toBe(1);
  });

  it("全局回退：两个无作用域 agent 装载同名工具 → register 只一次", () => {
    const root = makeRegistrarCtx();
    const registrar = createRegistrar(root.ctx, {});
    const mw = makeMw();
    const a1 = { session: { header: { cwd: ROOT } } };
    const a2 = { session: { header: { cwd: ROOT } } };
    registrar.load(a1, [definitionFor(mw)]);
    const second = registrar.load(a2, [definitionFor(mw)]);
    expect(second.activated).toEqual([]);
    expect(second.alreadyLoaded).toEqual(["mcp__dbx__dbx_execute_query"]);
    expect(root.registered.size).toBe(1);
  });

  it("isRegistered / isLoadedBy：全局回退对无作用域 agent 可见，对另一作用域不可见", () => {
    const root = makeRegistrarCtx();
    const registrar = createRegistrar(root.ctx, {});
    const mw = makeMw();
    const scoped = makeScopedAgent();
    registrar.load(scoped.agent, [definitionFor(mw)]);
    const name = "mcp__dbx__dbx_execute_query";
    expect(registrar.isRegistered(name)).toBe(true);
    expect(registrar.isLoadedBy(scoped.agent, name)).toBe(true);
    // 另一个 agent（作用域注册）：看不到别人作用域里的工具
    expect(registrar.isLoadedBy(makeScopedAgent().agent, name)).toBe(false);
    // 无作用域 agent：回退看全局槽（未注册 → false）
    expect(registrar.isLoadedBy({}, name)).toBe(false);
  });

  it("disposeAgent 精确回收该 agent 的全部装载", () => {
    const root = makeRegistrarCtx();
    const registrar = createRegistrar(root.ctx, {});
    const mw = makeMw();
    const scoped = makeScopedAgent();
    registrar.load(scoped.agent, [definitionFor(mw)]);
    expect(registrar.loadedCount()).toBe(1);
    registrar.disposeAgent(scoped.agent);
    expect(scoped.disposals).toEqual(["mcp__dbx__dbx_execute_query"]);
    expect(registrar.loadedCount()).toBe(0);
    expect(registrar.isLoadedBy(scoped.agent, "mcp__dbx__dbx_execute_query")).toBe(false);
  });

  it("disposeServer 扫 agent 侧桶与全局回退槽", () => {
    const root = makeRegistrarCtx();
    const registrar = createRegistrar(root.ctx, {});
    const mw = makeMw();
    const scoped = makeScopedAgent();
    registrar.load(scoped.agent, [definitionFor(mw, { server: "dbx", tool: "keep" }), definitionFor(mw, { server: "other", tool: "gone" })]);
    registrar.load({}, [definitionFor(mw, { server: "other", tool: "orphan" })]);
    expect(registrar.loadedCount()).toBe(3);
    registrar.disposeServer("other");
    expect(scoped.registered.has("mcp__other__gone")).toBe(false);
    expect(root.registered.has("mcp__other__orphan")).toBe(false);
    expect(registrar.loadedCount()).toBe(1);
  });

  it("disposeAll 清空全部层并回填 0", () => {
    const root = makeRegistrarCtx();
    const stats = makeStats();
    const registrar = createRegistrar(root.ctx, { stats });
    const mw = makeMw();
    registrar.load(makeScopedAgent().agent, [definitionFor(mw)]);
    registrar.load({}, [definitionFor(mw, { server: "g", tool: "global_one" })]);
    registrar.disposeAll();
    expect(registrar.loadedCount()).toBe(0);
    expect(root.registered.size).toBe(0);
    // 三次回填：作用域装载 1 → 全局装载后 2 → 全量回收后 0
    expect(stats.counts).toEqual([1, 2, 0]);
  });

  it("统计：只有真正激活才 recordLoad，幂等命中不计数", () => {
    const stats = makeStats();
    const root = makeRegistrarCtx();
    const registrar = createRegistrar(root.ctx, { stats });
    const mw = makeMw();
    const scoped = makeScopedAgent();
    registrar.load(scoped.agent, [definitionFor(mw)]);
    registrar.load(scoped.agent, [definitionFor(mw)]);
    expect(stats.calls).toEqual([["load", "dbx", "dbx_execute_query"]]);
  });

  it("disposeAll 在只有 agent 侧装载时也回填 0（globalLoaded 为空不能跳过通知）", () => {
    const stats = makeStats();
    const root = makeRegistrarCtx();
    const registrar = createRegistrar(root.ctx, { stats });
    const mw = makeMw();
    registrar.load(makeScopedAgent().agent, [definitionFor(mw)]);
    registrar.disposeAll();
    expect(registrar.loadedCount()).toBe(0);
    expect(stats.counts).toEqual([1, 0]);
  });
});

// ---------------------------------------------------------------------------
// ws_mcp_load
// ---------------------------------------------------------------------------

/** lazy 夹具：项目单元（proj）+ 全局单元（dbx），另带一台发现失败的服务器。 */
function makeLoadEnv({ policy = {}, disabledTools, mode = "lazy" } = {}) {
  const mw = makeMw([
    [ROOT, makeUnit(ROOT, [["proj", { discoveredAt: Date.now(), tools: new Map([["proj_tool", catalogTool("Project capability", { q: { type: "string" } }, ["q"])]]) }]])],
    [
      GLOBAL_ROOT,
      makeUnit(GLOBAL_ROOT, [
        [
          "dbx",
          {
            discoveredAt: Date.now(),
            tools: new Map([
              ["dbx_execute_query", catalogTool("Run a SQL query against the DBX connection", { sql: { type: "string" } }, ["sql"])],
              ["dbx_add_connection", catalogTool("Add a DBX database connection", { name: { type: "string" } }, ["name"])],
            ]),
          },
        ],
        ["broken", { discoveredAt: 0, tools: new Map(), unavailable: "spawn ENOENT" }],
      ]),
    ],
  ]);
  mw.policy = policy;
  if (disabledTools !== undefined) mw.disabledTools = disabledTools;
  const stats = makeStats();
  const root = makeRegistrarCtx();
  const registrar = createRegistrar(root.ctx, { stats });
  const toolCtx = {
    mw,
    resolveRoot: async (agent) => (agent?.session?.header?.cwd === ROOT ? ROOT : undefined),
    mode,
    stats,
  };
  const tool = buildLoadTool(toolCtx, registrar);
  return { mw, stats, root, registrar, tool };
}

const agentIn = (cwd = ROOT) => makeScopedAgent(cwd).agent;

describe("ws_mcp_load：三种引用写法与装载结果", () => {
  it("mcp__<server>__<tool>（裸 server 回落 @global 单元）", async () => {
    const env = makeLoadEnv();
    const agent = agentIn();
    const result = await env.tool.execute({ tools: ["mcp__dbx__dbx_execute_query"] }, { agent });
    expect(result.activated).toHaveLength(1);
    const entry = result.activated[0];
    expect(entry.name).toBe("mcp__dbx__dbx_execute_query");
    expect(entry.server).toBe(full(GLOBAL_ROOT, "dbx"));
    expect(entry.tool).toBe("dbx_execute_query");
    expect(entry.required).toEqual(["sql"]);
    expect(entry.description).toContain("Run a SQL query");
    expect(env.registrar.isLoadedBy(agent, entry.name)).toBe(true);
  });

  it("@<root>/<server>/<tool> 显式全名（项目级）", async () => {
    const env = makeLoadEnv();
    const result = await env.tool.execute({ tools: [`@${ROOT}/proj/proj_tool`] }, { agent: agentIn() });
    expect(result.activated[0].name).toBe("mcp__proj__proj_tool");
    expect(result.activated[0].server).toBe(full(ROOT, "proj"));
  });

  it("<server>/<tool> 裸写（项目级）", async () => {
    const env = makeLoadEnv();
    const result = await env.tool.execute({ tools: ["proj/proj_tool"] }, { agent: agentIn() });
    expect(result.activated[0].name).toBe("mcp__proj__proj_tool");
  });

  it("非法引用进 missing，不抛错", async () => {
    const env = makeLoadEnv();
    const result = await env.tool.execute({ tools: ["", "   ", "not-a-ref"] }, { agent: agentIn() });
    expect(result.activated).toEqual([]);
    expect(result.missing).toContain("not-a-ref");
  });

  it("不存在的工具进 missing", async () => {
    const env = makeLoadEnv();
    const result = await env.tool.execute({ tools: ["dbx/dbx_nope"] }, { agent: agentIn() });
    expect(result.missing).toEqual(["dbx/dbx_nope"]);
    expect(result.message).toContain("ws_mcp_search");
  });

  it("发现失败的服务器进 unavailable（不误报 not found）", async () => {
    const env = makeLoadEnv();
    const result = await env.tool.execute({ tools: ["broken/whatever"] }, { agent: agentIn() });
    expect(result.activated).toEqual([]);
    expect(result.unavailable).toEqual([{ server: full(GLOBAL_ROOT, "broken"), reason: "spawn ENOENT" }]);
  });

  it("重复装载 → alreadyLoaded", async () => {
    const env = makeLoadEnv();
    const agent = agentIn();
    await env.tool.execute({ tools: ["mcp__dbx__dbx_execute_query"] }, { agent });
    const second = await env.tool.execute({ tools: ["mcp__dbx__dbx_execute_query"] }, { agent });
    expect(second.activated).toEqual([]);
    expect(second.alreadyLoaded).toEqual(["mcp__dbx__dbx_execute_query"]);
  });

  it("query 批量装载受 limit 钳制（默认 3 / 硬上限 8）", async () => {
    const env = makeLoadEnv();
    const result = await env.tool.execute({ query: "dbx", limit: 99 }, { agent: agentIn() });
    expect(result.activated).toHaveLength(2);
    expect(result.activated.map((item) => item.name).sort()).toEqual(["mcp__dbx__dbx_add_connection", "mcp__dbx__dbx_execute_query"]);
  });

  it("tools 与 query 都为空 → 抛错给出下一步", async () => {
    const env = makeLoadEnv();
    await expect(env.tool.execute({}, { agent: agentIn() })).rejects.toThrow(/ws_mcp_load/);
  });

  it("无法确定工作空间 → 抛错（与其它 ws_mcp_* 同口径）", async () => {
    const env = makeLoadEnv();
    await expect(env.tool.execute({ tools: ["dbx/dbx_execute_query"] }, { agent: {} })).rejects.toThrow(/无法确定工作空间/);
  });
});

describe("ws_mcp_load：禁用 / 策略早失败（避免装上了调不动）", () => {
  it("工具级禁用 → 抛错含 ws_mcp_load，且不注册", async () => {
    const env = makeLoadEnv({ disabledTools: new Map([[GLOBAL_ROOT, new Map([["dbx", new Set(["dbx_execute_query"])]])]]) });
    await expect(env.tool.execute({ tools: ["dbx/dbx_execute_query"] }, { agent: agentIn() })).rejects.toThrow(/ws_mcp_load/);
    expect(env.registrar.isRegistered("mcp__dbx__dbx_execute_query")).toBe(false);
  });

  it("allowTools 白名单外 → 抛错含策略下一步，且不注册", async () => {
    const env = makeLoadEnv({ policy: { allowTools: { dbx: ["dbx_add_*"] } } });
    await expect(env.tool.execute({ tools: ["dbx/dbx_execute_query"] }, { agent: agentIn() })).rejects.toThrow(/middlewarePolicy/);
    expect(env.registrar.isRegistered("mcp__dbx__dbx_execute_query")).toBe(false);
  });
});

describe("ws_mcp_load：输出契约与渲染", () => {
  it("返回值通过输出契约校验（required 全集 / 无额外键 / lossless JSON）", async () => {
    const env = makeLoadEnv();
    const result = await env.tool.execute({ tools: ["dbx/dbx_execute_query", "nope/nope"] }, { agent: agentIn() });
    expect(assertSupportedOutputSchema(env.tool.output.schema)).toBe(env.tool.output.schema);
    expect(loadResultViolations(result)).toEqual([]);
  });

  it("render 只输出紧凑文本（不重复完整 schema）", async () => {
    const env = makeLoadEnv();
    const result = await env.tool.execute({ tools: ["dbx/dbx_execute_query"] }, { agent: agentIn() });
    const text = env.tool.output.render({}, result)[0].text;
    expect(text).toContain("mcp__dbx__dbx_execute_query");
    expect(text).toContain("required: sql");
    expect(text).not.toContain("inputSchema");
    expect(text).toContain("已装载 1 个工具");
  });
});

// ---------------------------------------------------------------------------
// pre-execute guard（lazy 专属分支）
// ---------------------------------------------------------------------------

describe("lazy guard：本插件注册过但本 agent 未装载的 mcp__ 工具给可行动拒绝", () => {
  function guardEnv(mode = "lazy") {
    const guards = new Map();
    const registrations = new Map();
    const ctx = {
      tools: {
        register(definition) {
          registrations.set(definition.name, definition);
          return () => registrations.delete(definition.name);
        },
      },
      on: (event, handler) => {
        guards.set(event, handler);
        return () => guards.delete(event);
      },
    };
    const mw = makeMw();
    mw.ensureConnected = async () => {};
    const registrar = createRegistrar(ctx, {});
    const dispose = registerMiddlewareTools(ctx, mw, async () => ROOT, mode, { registrar });
    return { guards, registrations, registrar, dispose, ctx };
  }

  it("lazy：注册面含 ws_mcp_load（5 个工具）", () => {
    const { registrations } = guardEnv("lazy");
    expect([...registrations.keys()].sort()).toEqual(["ws_mcp_call", "ws_mcp_detail", "ws_mcp_list", "ws_mcp_load", "ws_mcp_search"]);
  });

  it("project / all：仍是 4 个工具（不暴露装载器）", () => {
    expect([...guardEnv("project").registrations.keys()]).toHaveLength(4);
    expect(guardEnv("project").registrations.has("ws_mcp_load")).toBe(false);
    expect(guardEnv("all").registrations.has("ws_mcp_load")).toBe(false);
  });

  it("本插件注册在别的 agent 作用域、本 agent 未装载 → deny，reason 含 ws_mcp_load", async () => {
    const { guards, registrar } = guardEnv("lazy");
    const mw = makeMw();
    // 装载进 agent A 的作用域；agent B 看不到也装不上 → guard 兜底拒绝
    registrar.load(makeScopedAgent().agent, [definitionFor(mw)]);
    const decision = await guards.get("tools/pre-execute")(
      { name: "mcp__dbx__dbx_execute_query", agent: makeScopedAgent().agent },
      async () => ({ kind: "allow" }),
    );
    expect(decision.kind).toBe("deny");
    expect(decision.reason).toContain("ws_mcp_load");
    expect(decision.reason).toContain("mcp__dbx__dbx_execute_query");
  });

  it("全局回退槽（无作用域）注册的工具对无作用域 agent 放行（回退语义）", async () => {
    const { guards, registrar } = guardEnv("lazy");
    const mw = makeMw();
    registrar.load({}, [definitionFor(mw)]);
    const decision = await guards.get("tools/pre-execute")(
      { name: "mcp__dbx__dbx_execute_query", agent: { session: { header: { cwd: ROOT } } } },
      async () => ({ kind: "allow" }),
    );
    expect(decision.kind).toBe("allow");
  });

  it("已装载（同一 agent）→ next()", async () => {
    const { guards, registrar } = guardEnv("lazy");
    const mw = makeMw();
    const scoped = makeScopedAgent();
    registrar.load(scoped.agent, [definitionFor(mw)]);
    const decision = await guards.get("tools/pre-execute")(
      { name: "mcp__dbx__dbx_execute_query", agent: scoped.agent },
      async () => ({ kind: "allow" }),
    );
    expect(decision.kind).toBe("allow");
  });

  it("非本插件注册的 mcp__ 工具不误伤（isRegistered=false → 放行）", async () => {
    const { guards } = guardEnv("lazy");
    const decision = await guards.get("tools/pre-execute")(
      { name: "mcp__other__tool", agent: { session: { header: { cwd: ROOT } } } },
      async () => ({ kind: "allow" }),
    );
    expect(decision.kind).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// 引用解析细节（经 ws_mcp_load 行为间接覆盖）
// ---------------------------------------------------------------------------

describe("引用解析：@root 形态与全名解析一致性", () => {
  it("默认 @global 写法 @global/<server>/<tool> 与 @@global 等价", async () => {
    const env = makeLoadEnv();
    const a = await env.tool.execute({ tools: ["@global/dbx/dbx_add_connection"] }, { agent: agentIn() });
    expect(a.activated[0].name).toBe("mcp__dbx__dbx_add_connection");
    expect(parseFullServerName(full(GLOBAL_ROOT, "dbx")).root).toBe(GLOBAL_ROOT);
  });
});

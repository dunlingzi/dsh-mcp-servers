// @ts-nocheck
/**
 * dsh-mcp-servers — unit：中间层四工具（src/inject/tools/*）+ 共享 helper（middleware-shared）。
 *
 * 为什么单独一份：夜班变异热点定位（run 47675883 同期报告）显示 `inject/tools/*` 的
 * Killed=0、NoCoverage 占全仓 28%（语句覆盖 1.72%–4.87%、分支 0%）——四个模型面工具的处理
 * 函数此前只有 smoke 的「注册 + 描述 + schema 形状」断言，**没有任何用例执行 handler**。
 *
 * 手法（与 smoke.test.ts 的中间层用例同源，全程零子进程、零网络）：
 *   - 构造真实 McpMiddleware（宿主桩），把手工构造的 ProjectUnit 直接塞进 mw.units
 *     （不走 projectUnitFor 的惰性连接路径，故不 spawn）；
 *   - 连接面（ensureConnected / callTool）用实例级覆写替代真实建连；
 *   - 直调 tool.execute(args, exec) 与 tool.output.render(args, value)。
 *
 * 全名一律用 fullServerName(root, server) 生成（形态 `@<root>/<server>`），不手写字符串——
 * 手写极易漏 `@`，而 parseFullServerName 对无 `@` 前缀的输入一律判非法。
 */
import { describe, expect, it } from "vitest";
import { McpMiddleware } from "../../src/connection/runtime/middleware.ts";
import { CATALOG_TTL_MS, LIST_DEFAULT_TOOLS_PER_SERVER, LIST_MAX_TOOLS_PER_SERVER } from "../../src/connection/runtime/interface.ts";
import { buildListTool } from "../../src/inject/tools/list.ts";
import { buildSearchTool } from "../../src/inject/tools/search.ts";
import { buildDetailTool } from "../../src/inject/tools/detail.ts";
import { buildCallTool, parseCallParams } from "../../src/inject/tools/call.ts";
import { checkMiddlewareRoot, visibleMiddlewareRoots, waitForDiscovery } from "../../src/inject/middleware-shared.ts";
import { MIDDLEWARE_GLOBAL_ROOT, fullServerName } from "../../src/workspace/interface.ts";

const ROOT = "/proj";
const OTHER_ROOT = "/other";
const GLOBAL_ROOT = MIDDLEWARE_GLOBAL_ROOT; // "@global"
const full = (root, server) => fullServerName(root, server);

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 工具目录夹具：n 个工具，描述与 schema 都带同一关键词，便于检索命中。 */
function makeTools(n, prefix = "tool") {
  return new Map(
    Array.from({ length: n }, (_, i) => [
      `${prefix}${i}`,
      {
        description: `browser capability ${prefix}${i}`,
        inputSchema: { type: "object", properties: { q: { type: "string", description: `arg ${i}` } } },
      },
    ]),
  );
}

function makeCatalog(overrides = {}) {
  return { discoveredAt: Date.now(), tools: makeTools(3), ...overrides };
}

/** 手工构造单元（不走惰性连接；字段与 ProjectUnit 契约一致）。 */
function makeUnit(root, catalogEntries = [], { userDisabled = [], inFlight = new Map() } = {}) {
  return {
    root,
    connections: new Map(),
    catalog: new Map(catalogEntries),
    userDisabled: new Set(userDisabled),
    lastTouchedAt: Date.now(),
    inFlight,
  };
}

function makeHost(overrides = {}) {
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
    ...overrides,
  };
}

/** 统计收集器桩：记录调用序，供「是否上报统计」断言。 */
function fakeStats(enabled = true) {
  const calls = [];
  return {
    calls,
    isEnabled: () => enabled,
    recordList: (filter) => calls.push(["list", filter]),
    recordSearch: (query) => calls.push(["search", query]),
    recordDetail: (server, tool) => calls.push(["detail", server, tool]),
    recordCall: (server, tool, durationMs, success, err) =>
      calls.push(["call", server, tool, typeof durationMs === "number", success, err]),
  };
}

/**
 * 组装：真实 mw（宿主桩）+ 预置单元 + 工具上下文。
 * patch 用于实例级覆写连接面（ensureConnected / callTool），避免真实建连。
 */
function makeEnv({ mode = "project", host = {}, stats = fakeStats(), patch = {}, units = [] } = {}) {
  const mw = new McpMiddleware(makeHost(host), {});
  for (const [root, unit] of units) mw.units.set(root, unit);
  Object.assign(mw, patch);
  const toolCtx = {
    mw,
    resolveRoot: async (agent) => (agent?.session?.header?.cwd === ROOT ? ROOT : undefined),
    mode,
    stats,
  };
  return { mw, toolCtx };
}

const agentIn = (cwd) => ({ session: { header: { cwd } } });
const textOf = (blocks) => blocks.map((b) => b.text).join("\n");

// ---------------------------------------------------------------------------
// ws_mcp_list
// ---------------------------------------------------------------------------

describe("ws_mcp_list：参数钳制 / 过滤 / 空返回归因 / 渲染", () => {
  function envWithServers(extra = {}) {
    return makeEnv({
      units: [[ROOT, makeUnit(ROOT, [["alpha", makeCatalog()], ["beta", makeCatalog({ tools: makeTools(5, "cap") })]])]],
      ...extra,
    });
  }

  it("perServerLimit 钳制：0 → 1、超上限 → 上限、小数 → 下取整、非数字/负数 → 默认/1", async () => {
    const tool = buildListTool(envWithServers().toolCtx);

    const zero = await tool.execute({ perServerLimit: 0 }, { agent: agentIn(ROOT) });
    expect(zero.servers.map((s) => s.tools.length)).toEqual([1, 1]);
    expect(zero.toolsTruncated, "钳到 1 后必然截断").toBe(true);

    const huge = await tool.execute({ perServerLimit: 9999 }, { agent: agentIn(ROOT) });
    expect(huge.servers.map((s) => s.tools.length)).toEqual([3, 5]);
    expect(huge.toolsTruncated, "上限内不截断").toBe(false);
    expect(huge.totalTools).toBe(8);
    expect(huge.totalServers).toBe(2);

    const frac = await tool.execute({ perServerLimit: 2.9 }, { agent: agentIn(ROOT) });
    expect(frac.servers.map((s) => s.tools.length), "2.9 → floor 2").toEqual([2, 2]);
    expect(frac.toolsTruncated).toBe(true);

    const nonNumber = await tool.execute({ perServerLimit: "3" }, { agent: agentIn(ROOT) });
    expect(nonNumber.servers[0].tools.length, "非数字回落默认值").toBe(Math.min(LIST_DEFAULT_TOOLS_PER_SERVER, 3));

    const negative = await tool.execute({ perServerLimit: -5 }, { agent: agentIn(ROOT) });
    expect(negative.servers[0].tools.length, "负数钳到 1").toBe(1);

    expect(LIST_MAX_TOOLS_PER_SERVER).toBeGreaterThan(LIST_DEFAULT_TOOLS_PER_SERVER);
  });

  it("server 过滤：裸名与全名等价，命中只留一台；未命中给归因文案", async () => {
    const tool = buildListTool(envWithServers().toolCtx);

    const bare = await tool.execute({ server: "alpha" }, { agent: agentIn(ROOT) });
    expect(bare.servers.map((s) => s.server)).toEqual([full(ROOT, "alpha")]);
    expect(bare.totalServers).toBe(1);

    const byFull = await tool.execute({ server: full(ROOT, "beta") }, { agent: agentIn(ROOT) });
    expect(byFull.servers.map((s) => s.server)).toEqual([full(ROOT, "beta")]);

    const miss = await tool.execute({ server: "gamma" }, { agent: agentIn(ROOT) });
    expect(miss.servers).toEqual([]);
    expect(miss.message, "A1：未命中不谎报未配置，给出可见清单").toMatch(/没有匹配 server="gamma"/);
    expect(miss.message).toMatch(/可见项目级服务器：alpha \/ beta/);
    expect(miss.message, "提示全局服务器走 mcp__ 前缀").toMatch(/mcp__<server>__<tool>/);
  });

  it("空字符串 server 视为不过滤；过滤到 0 条时 message 仍可归因", async () => {
    const tool = buildListTool(envWithServers().toolCtx);
    const blank = await tool.execute({ server: "" }, { agent: agentIn(ROOT) });
    expect(blank.servers, "空字符串不做过滤").toHaveLength(2);
    expect(blank.message, "有命中则不带 message").toBeUndefined();
  });

  it("无法确定工作空间 → 抛错", async () => {
    const tool = buildListTool(envWithServers().toolCtx);
    await expect(() => tool.execute({}, { agent: agentIn(OTHER_ROOT) })).rejects.toThrow(/无法确定工作空间/);
    await expect(() => tool.execute({}, {})).rejects.toThrow(/无法确定工作空间/);
  });

  it("无项目配置（unit undefined）+ project 模式 → 专属文案", async () => {
    const tool = buildListTool(makeEnv({ host: { projectServersFor: async () => undefined } }).toolCtx);
    const out = await tool.execute({}, { agent: agentIn(ROOT) });
    expect(out.totalServers).toBe(0);
    expect(out.toolsTruncated).toBe(false);
    expect(out.message).toMatch(/没有项目级 MCP 配置/);
  });

  it("无项目配置 + all 模式：无全局单元 → 传入口径文案；有全局单元 → 列出 @global", async () => {
    const toolNoGlobal = buildListTool(makeEnv({ mode: "all", host: { projectServersFor: async () => undefined } }).toolCtx);
    const empty = await toolNoGlobal.execute({}, { agent: agentIn(ROOT) });
    expect(empty.servers).toEqual([]);
    expect(empty.message).toMatch(/项目级与全局均未发现/);

    const toolAll = buildListTool(
      makeEnv({
        mode: "all",
        host: { projectServersFor: async () => undefined },
        units: [[GLOBAL_ROOT, makeUnit(GLOBAL_ROOT, [["gctx", makeCatalog()]])]],
      }).toolCtx,
    );
    const withGlobal = await toolAll.execute({}, { agent: agentIn(ROOT) });
    expect(withGlobal.servers.map((s) => s.server)).toEqual([full(GLOBAL_ROOT, "gctx")]);
    expect(withGlobal.workspace, "roots[0] 即参与盘点的 root 列表首项").toBe(GLOBAL_ROOT);
  });

  it("all 模式：项目单元与全局单元合并可见", async () => {
    const { toolCtx } = makeEnv({
      mode: "all",
      units: [
        [ROOT, makeUnit(ROOT, [["alpha", makeCatalog()]])],
        [GLOBAL_ROOT, makeUnit(GLOBAL_ROOT, [["gctx", makeCatalog()]])],
      ],
    });
    const tool = buildListTool(toolCtx);
    const out = await tool.execute({}, { agent: agentIn(ROOT) });
    expect(out.servers.map((s) => s.server)).toEqual([full(ROOT, "alpha"), full(GLOBAL_ROOT, "gctx")]);
    expect(out.totalServers).toBe(2);
    expect(out.workspace).toBe(ROOT);
  });

  it("userDisabled 与工具级禁用：条目/工具行各自标注", async () => {
    const unit = makeUnit(ROOT, [["alpha", makeCatalog()], ["beta", makeCatalog({ tools: makeTools(1, "b") })]], {
      userDisabled: ["beta"],
    });
    const { mw, toolCtx } = makeEnv({ units: [[ROOT, unit]] });
    mw.disabledTools.set(ROOT, new Map([["alpha", new Set(["tool0"])]]));

    const tool = buildListTool(toolCtx);
    const out = await tool.execute({}, { agent: agentIn(ROOT) });
    const alpha = out.servers.find((s) => s.server === full(ROOT, "alpha"));
    const beta = out.servers.find((s) => s.server === full(ROOT, "beta"));
    expect(alpha.disabled, "alpha 未被禁用").toBeUndefined();
    expect(alpha.tools[0].disabled, "工具级禁用标注").toBe(true);
    expect(alpha.tools[1].disabled).toBeUndefined();
    expect(beta.disabled, "服务器级禁用标注").toBe(true);
  });

  it("unavailable 目录：条目标注原因且不计入工具数", async () => {
    const unit = makeUnit(ROOT, [
      ["broken", { discoveredAt: Date.now(), tools: new Map(), unavailable: "spawn ENOENT" }],
      ["alpha", makeCatalog()],
    ]);
    const tool = buildListTool(makeEnv({ units: [[ROOT, unit]] }).toolCtx);
    const out = await tool.execute({}, { agent: agentIn(ROOT) });
    const broken = out.servers.find((s) => s.server === full(ROOT, "broken"));
    expect(broken.unavailable).toBe("spawn ENOENT");
    expect(broken.tools).toEqual([]);
    expect(out.totalTools, "unavailable 不计工具数").toBe(3);
  });

  it("统计：enabled 时按 serverFilter 上报，disabled 时不报", async () => {
    const on = fakeStats(true);
    const toolOn = buildListTool(envWithServers({ stats: on }).toolCtx);
    await toolOn.execute({ server: "alpha" }, { agent: agentIn(ROOT) });
    expect(on.calls).toEqual([["list", "alpha"]]);

    const off = fakeStats(false);
    const toolOff = buildListTool(envWithServers({ stats: off }).toolCtx);
    await toolOff.execute({}, { agent: agentIn(ROOT) });
    expect(off.calls).toEqual([]);
  });

  it("render：前缀/工具行/disabled/unavailable/toolsTruncated/空目录 message", () => {
    const tool = buildListTool(envWithServers().toolCtx);
    const render = tool.output.render;

    const fullText = textOf(
      render(undefined, {
        workspace: ROOT,
        mode: "project",
        totalServers: 2,
        totalTools: 4,
        servers: [
          { server: full(ROOT, "alpha"), tools: [{ tool: "t1", description: "d1" }], toolsTruncated: false },
          { server: full(ROOT, "beta"), tools: [], disabled: true, unavailable: "boom", toolsTruncated: true },
        ],
        toolsTruncated: true,
      }),
    );
    expect(fullText).toContain(`Workspace ${ROOT} (mode=project): 2 servers / 4 tools in total`);
    expect(fullText).toContain("  - t1: d1");
    expect(fullText).toContain(`${full(ROOT, "beta")} (0 tools)`);
    expect(fullText).toContain("[disabled]");
    expect(fullText).toContain("[unavailable: boom]");
    expect(fullText).toContain("[toolsTruncated: tool count reached limit");
    expect(fullText).toContain("(Some server tool lists were truncated; increase perServerLimit if needed)");

    const emptyText = textOf(
      render(undefined, { workspace: ROOT, mode: "project", servers: [], totalServers: 0, totalTools: 0, toolsTruncated: false, message: "NO_SERVERS" }),
    );
    expect(emptyText).toContain("NO_SERVERS");
    expect(emptyText).toContain("0 servers / 0 tools in total");

    const nil = textOf(render(undefined, null));
    expect(nil).toContain("(No MCP servers found in current workspace)");
    expect(nil).toContain("Workspace  (mode=)");

    const nonArrayTools = textOf(
      render(undefined, { workspace: ROOT, mode: "all", servers: [{ server: "x", tools: 5 }], totalServers: 1, totalTools: 0, toolsTruncated: false }),
    );
    expect(nonArrayTools, "tools 非数组按 0 条处理").toContain("x (0 tools)");

    const noFlags = textOf(
      render(undefined, {
        workspace: ROOT,
        mode: "all",
        servers: [{ server: "y", tools: [], disabled: false, unavailable: "", toolsTruncated: false }],
        totalServers: 1,
        totalTools: 0,
        toolsTruncated: false,
      }),
    );
    expect(noFlags, "disabled=false / unavailable='' 都不标注").not.toContain("[disabled]");
    expect(noFlags).not.toContain("[unavailable");
    expect(noFlags).not.toContain("(Some server tool lists were truncated");
  });
});

// ---------------------------------------------------------------------------
// ws_mcp_search
// ---------------------------------------------------------------------------

describe("ws_mcp_search：检索 / 空 query 能力摘要 / 过滤 / 截断 / 渲染", () => {
  function searchEnv({ toolsCount = 12, mode = "project", stats = fakeStats() } = {}) {
    const unit = makeUnit(ROOT, [["alpha", makeCatalog({ tools: makeTools(toolsCount, "cap") })]]);
    return makeEnv({ mode, stats, units: [[ROOT, unit]] });
  }

  it("limit 钳制：0 → 1、超上限 → 10、小数 → 下取整、非数字 → 5、负数 → 1", async () => {
    const tool = buildSearchTool(searchEnv().toolCtx);
    const q = "browser";

    const zero = await tool.execute({ query: q, limit: 0 }, { agent: agentIn(ROOT) });
    expect(zero.results).toHaveLength(1);
    expect(zero.truncated).toBe(true);

    const huge = await tool.execute({ query: q, limit: 999 }, { agent: agentIn(ROOT) });
    expect(huge.results).toHaveLength(10);
    expect(huge.truncated, "命中 12 条、上限 10 → 截断").toBe(true);

    const frac = await tool.execute({ query: q, limit: 2.7 }, { agent: agentIn(ROOT) });
    expect(frac.results).toHaveLength(2);

    const nonNumber = await tool.execute({ query: q, limit: "9" }, { agent: agentIn(ROOT) });
    expect(nonNumber.results).toHaveLength(5);

    const negative = await tool.execute({ query: q, limit: -1 }, { agent: agentIn(ROOT) });
    expect(negative.results).toHaveLength(1);

    const exact = await tool.execute({ query: q, limit: 12 }, { agent: agentIn(ROOT) });
    expect(exact.results.length, "上限 10：12 也只得 10 条").toBe(10);
  });

  it("空 query → 能力摘要（不按 score 过滤）；无命中才给提示文案", async () => {
    const tool = buildSearchTool(searchEnv().toolCtx);

    const summary = await tool.execute({}, { agent: agentIn(ROOT) });
    expect(summary.results.length, "空 query 返回能力摘要").toBeGreaterThan(0);
    expect(summary.results[0].score).toBe(0);
    expect(summary.results[0].matchedTerms).toEqual([]);

    const nonStringQuery = await tool.execute({ query: 42 }, { agent: agentIn(ROOT) });
    expect(nonStringQuery.results.length, "非字符串 query 归一为空串").toBeGreaterThan(0);

    const miss = await tool.execute({ query: "zzz-no-such-term" }, { agent: agentIn(ROOT) });
    expect(miss.results).toEqual([]);
    expect(textOf(tool.output.render(undefined, miss))).toMatch(/No matching MCP tools found in current workspace/);
  });

  it("server 过滤在截断判定之后（展示层过滤，不改 truncated 事实）", async () => {
    const unit = makeUnit(ROOT, [["alpha", makeCatalog({ tools: makeTools(12, "cap") })]]);
    const tool = buildSearchTool(makeEnv({ units: [[ROOT, unit]] }).toolCtx);

    const filtered = await tool.execute({ query: "browser", server: full(ROOT, "alpha"), limit: 3 }, { agent: agentIn(ROOT) });
    expect(filtered.results).toHaveLength(3);
    expect(filtered.truncated).toBe(true);

    const filteredOut = await tool.execute({ query: "browser", server: "beta", limit: 3 }, { agent: agentIn(ROOT) });
    expect(filteredOut.results, "过滤到 0 条但 truncated 事实保留").toEqual([]);
    expect(filteredOut.truncated).toBe(true);

    const nonStringServer = await tool.execute({ query: "browser", server: 42, limit: 3 }, { agent: agentIn(ROOT) });
    expect(nonStringServer.results, "非字符串 server 视为不过滤").toHaveLength(3);
  });

  it("unit undefined → 早退空结果（output.schema 三字段齐备）", async () => {
    const tool = buildSearchTool(makeEnv({ host: { projectServersFor: async () => undefined } }).toolCtx);
    const out = await tool.execute({ query: "x" }, { agent: agentIn(ROOT) });
    expect(out).toEqual({ results: [], unavailable: [], truncated: false });
  });

  it("无法确定工作空间 → 抛错；统计按 query 上报", async () => {
    const stats = fakeStats(true);
    const tool = buildSearchTool(searchEnv({ stats }).toolCtx);
    await expect(() => tool.execute({ query: "x" }, { agent: agentIn(OTHER_ROOT) })).rejects.toThrow(/无法确定工作空间/);

    await tool.execute({ query: "browser" }, { agent: agentIn(ROOT) });
    expect(stats.calls).toEqual([["search", "browser"]]);

    const off = fakeStats(false);
    const toolOff = buildSearchTool(searchEnv({ stats: off }).toolCtx);
    await toolOff.execute({ query: "browser" }, { agent: agentIn(ROOT) });
    expect(off.calls).toEqual([]);
  });

  it("all 模式：全局单元合并进结果，不可用服务器进 unavailable 段", async () => {
    const units = [
      [ROOT, makeUnit(ROOT, [["alpha", makeCatalog({ tools: makeTools(2, "cap") })]])],
      [
        GLOBAL_ROOT,
        makeUnit(GLOBAL_ROOT, [
          ["gctx", makeCatalog({ tools: makeTools(1, "g") })],
          ["down", { discoveredAt: Date.now(), tools: new Map(), unavailable: "connect refused" }],
        ]),
      ],
    ];
    const tool = buildSearchTool(makeEnv({ mode: "all", units }).toolCtx);
    const out = await tool.execute({ query: "browser", limit: 10 }, { agent: agentIn(ROOT) });
    const servers = out.results.map((r) => r.server);
    expect(servers).toContain(full(ROOT, "alpha"));
    expect(servers).toContain(full(GLOBAL_ROOT, "gctx"));
    expect(out.unavailable).toEqual([{ server: full(GLOBAL_ROOT, "down"), reason: "connect refused" }]);

    const rendered = textOf(tool.output.render(undefined, out));
    expect(rendered).toContain("Unavailable servers:");
    expect(rendered).toContain(`${full(GLOBAL_ROOT, "down")}: connect refused`);
  });

  it("render：命中行 / truncated 尾注 / unavailable 段 / 空值兜底", () => {
    const tool = buildSearchTool(searchEnv().toolCtx);
    const render = tool.output.render;

    const hit = textOf(render(undefined, { results: [{ server: "@r/s", tool: "t", description: "d" }], unavailable: [], truncated: true }));
    expect(hit).toContain("@r/s/t: d");
    expect(hit).toContain("(Results reached limit and may be incomplete");

    const emptyValue = textOf(render(undefined, {}));
    expect(emptyValue).toMatch(/No matching MCP tools found/);
    expect(emptyValue, "无 truncated 时不加尾注").not.toContain("Results reached limit");

    const onlyUnavailable = textOf(render(undefined, { results: [], unavailable: [{ server: "@r/x", reason: "boom" }], truncated: false }));
    expect(onlyUnavailable).toContain("Unavailable servers:");
    expect(onlyUnavailable).toContain("@r/x: boom");

    const missingFields = textOf(render(undefined, { results: [{}] }));
    expect(missingFields).toContain("/: ");
  });
});

// ---------------------------------------------------------------------------
// ws_mcp_detail
// ---------------------------------------------------------------------------

describe("ws_mcp_detail：必填 / 路由校验 / 三分错误 / fresh / 禁用 / 渲染", () => {
  const healthyUnit = () => makeUnit(ROOT, [["alpha", makeCatalog({ tools: makeTools(2, "cap") })]]);

  it("必填与格式校验：缺 server/tool、非字符串、非法全名", async () => {
    const tool = buildDetailTool(makeEnv({ units: [[ROOT, healthyUnit()]] }).toolCtx);
    await expect(() => tool.execute({}, { agent: agentIn(ROOT) })).rejects.toThrow(/server 与 tool 均为必填/);
    await expect(() => tool.execute({ server: full(ROOT, "alpha") }, { agent: agentIn(ROOT) })).rejects.toThrow(/均为必填/);
    await expect(() => tool.execute({ tool: "cap0" }, { agent: agentIn(ROOT) })).rejects.toThrow(/均为必填/);
    await expect(() => tool.execute({ server: 42, tool: "cap0" }, { agent: agentIn(ROOT) })).rejects.toThrow(/均为必填/);
    await expect(() => tool.execute({ server: "no-at-sign", tool: "cap0" }, { agent: agentIn(ROOT) })).rejects.toThrow(/server 参数格式非法/);
  });

  it("跨越工作空间 → 路由一致性校验拒绝（全名合法但 root 不符）", async () => {
    const tool = buildDetailTool(makeEnv({ units: [[ROOT, healthyUnit()]] }).toolCtx);
    await expect(() => tool.execute({ server: full(OTHER_ROOT, "alpha"), tool: "cap0" }, { agent: agentIn(ROOT) })).rejects.toThrow(
      /不属于当前工作空间|路由一致性/,
    );
  });

  it("错误三分：未连接或未发现 / 发现失败附原因 / 已被用户禁用", async () => {
    const missing = buildDetailTool(makeEnv({ units: [] }).toolCtx);
    await expect(() => missing.execute({ server: full(ROOT, "alpha"), tool: "cap0" }, { agent: agentIn(ROOT) })).rejects.toThrow(/未连接或未发现/);

    const broken = makeUnit(ROOT, [["alpha", { discoveredAt: Date.now(), tools: new Map(), unavailable: "spawn ENOENT" }]]);
    const toolBroken = buildDetailTool(makeEnv({ units: [[ROOT, broken]] }).toolCtx);
    await expect(() => toolBroken.execute({ server: full(ROOT, "alpha"), tool: "cap0" }, { agent: agentIn(ROOT) })).rejects.toThrow(/发现失败[\s\S]*spawn ENOENT/);

    const disabled = makeUnit(ROOT, [["alpha", { discoveredAt: Date.now(), tools: new Map() }]], { userDisabled: ["alpha"] });
    const toolDisabled = buildDetailTool(makeEnv({ units: [[ROOT, disabled]] }).toolCtx);
    await expect(() => toolDisabled.execute({ server: full(ROOT, "alpha"), tool: "cap0" }, { agent: agentIn(ROOT) })).rejects.toThrow(/已被用户禁用/);
  });

  it("工具不存在报错；命中返回 schema 与 fresh 事实（TTL 边界）", async () => {
    const stale = makeUnit(ROOT, [["alpha", { discoveredAt: Date.now() - CATALOG_TTL_MS - 1000, tools: makeTools(2, "cap") }]]);
    const tool = buildDetailTool(makeEnv({ units: [[ROOT, stale]] }).toolCtx);

    await expect(() => tool.execute({ server: full(ROOT, "alpha"), tool: "nope" }, { agent: agentIn(ROOT) })).rejects.toThrow(/tool 不存在/);

    const hit = await tool.execute({ server: full(ROOT, "alpha"), tool: "cap0" }, { agent: agentIn(ROOT) });
    expect(hit.server).toBe(full(ROOT, "alpha"));
    expect(hit.tool).toBe("cap0");
    expect(hit.description).toMatch(/browser capability cap0/);
    expect(hit.inputSchema, "完整 schema 透传").toHaveProperty("properties.q");
    expect(hit.fresh, "超 TTL → stale").toBe(false);

    const freshUnit = makeUnit(ROOT, [["alpha", makeCatalog({ tools: makeTools(1, "cap") })]]);
    const toolFresh = buildDetailTool(makeEnv({ units: [[ROOT, freshUnit]] }).toolCtx);
    const freshHit = await toolFresh.execute({ server: full(ROOT, "alpha"), tool: "cap0" }, { agent: agentIn(ROOT) });
    expect(freshHit.fresh).toBe(true);
    expect(freshHit.disabled, "未禁用则不置位").toBeUndefined();
  });

  it("mcp__ 前缀工具名归一化 + 用户禁用标注 + 统计上报", async () => {
    const stats = fakeStats(true);
    const unit = makeUnit(ROOT, [["alpha", makeCatalog({ tools: makeTools(1, "cap") })]], { userDisabled: ["alpha"] });
    const tool = buildDetailTool(makeEnv({ stats, units: [[ROOT, unit]] }).toolCtx);

    const hit = await tool.execute({ server: full(ROOT, "alpha"), tool: "mcp__alpha__cap0" }, { agent: agentIn(ROOT) });
    expect(hit.tool, "去前缀后命中裸名").toBe("cap0");
    expect(hit.disabled, "目录仍可查，仅标注禁用").toBe(true);
    expect(stats.calls).toEqual([["detail", "alpha", "mcp__alpha__cap0"]]);

    const off = fakeStats(false);
    const toolOff = buildDetailTool(makeEnv({ stats: off, units: [[ROOT, healthyUnit()]] }).toolCtx);
    await toolOff.execute({ server: full(ROOT, "alpha"), tool: "cap0" }, { agent: agentIn(ROOT) });
    expect(off.calls).toEqual([]);
  });

  it("all 模式下 @global 服务器可查（路由校验放行全局）", async () => {
    const units = [[GLOBAL_ROOT, makeUnit(GLOBAL_ROOT, [["gctx", makeCatalog({ tools: makeTools(1, "g") })]])]];
    const tool = buildDetailTool(makeEnv({ mode: "all", units }).toolCtx);
    const hit = await tool.execute({ server: full(GLOBAL_ROOT, "gctx"), tool: "g0" }, { agent: agentIn(ROOT) });
    expect(hit.server).toBe(full(GLOBAL_ROOT, "gctx"));
    expect(hit.tool).toBe("g0");
  });

  it("render：fresh/stale、disabled、无描述、schema 缺省", () => {
    const tool = buildDetailTool(makeEnv({ units: [[ROOT, healthyUnit()]] }).toolCtx);
    const render = tool.output.render;

    const freshText = textOf(render(undefined, { server: "@r/s", tool: "t", description: "d", inputSchema: { type: "object" }, fresh: true }));
    expect(freshText).toContain("@r/s/t（fresh）：d");
    expect(freshText).toContain('"type": "object"');

    const staleText = textOf(render(undefined, { server: "@r/s", tool: "t", description: "", fresh: false, disabled: true }));
    expect(staleText).toContain("（stale");
    expect(staleText).toContain("[disabled]");
    expect(staleText, "无描述兜底").toContain("（无描述）");
    expect(staleText, "schema 缺省为 {}").toContain("inputSchema:\n{}");

    const nil = textOf(render(undefined, null));
    expect(nil).toContain("/（stale）：（无描述）");
  });
});

// ---------------------------------------------------------------------------
// ws_mcp_call
// ---------------------------------------------------------------------------

describe("ws_mcp_call：参数解析 / 路由校验 / 成功与失败路径 / 统计 / 渲染", () => {
  const okResult = { content: [{ type: "text", text: "ok" }] };

  function callEnv({ mode = "project", stats = fakeStats(), callTool, units = [[ROOT, makeUnit(ROOT, [["alpha", makeCatalog()]])]], host = {} } = {}) {
    const calls = [];
    const patch = {
      ensureConnected: async (root, server, opts) => calls.push(["ensureConnected", root, server, opts]),
      callTool: async (...args) => {
        calls.push(["callTool", ...args]);
        if (callTool) return callTool(...args);
        return okResult;
      },
    };
    const env = makeEnv({ mode, stats, patch, units, host });
    return { ...env, calls };
  }

  it("parseCallParams：非对象/缺字段/透传 arguments", () => {
    expect(parseCallParams(undefined)).toEqual({ server: "", tool: "", arguments: undefined });
    expect(parseCallParams(null)).toEqual({ server: "", tool: "", arguments: undefined });
    expect(parseCallParams("x")).toEqual({ server: "", tool: "", arguments: undefined });
    expect(parseCallParams({ server: 1, tool: 2 })).toEqual({ server: "", tool: "", arguments: undefined });
    expect(parseCallParams({ server: "@r/s", tool: "t", arguments: { a: 1 } })).toEqual({ server: "@r/s", tool: "t", arguments: { a: 1 } });
  });

  it("必填 / 格式 / 工作空间 / 跨 root 的逐级拒绝", async () => {
    const { toolCtx } = callEnv();
    const tool = buildCallTool(toolCtx);

    await expect(() => tool.execute({}, { agent: agentIn(ROOT) })).rejects.toThrow(/server 与 tool 均为必填/);
    await expect(() => tool.execute({ server: "@r/s" }, { agent: agentIn(ROOT) })).rejects.toThrow(/均为必填/);
    await expect(() => tool.execute({ server: "bad", tool: "t" }, { agent: agentIn(ROOT) })).rejects.toThrow(/server 参数格式非法/);
    await expect(() => tool.execute({ server: full(OTHER_ROOT, "s"), tool: "t" }, { agent: agentIn(ROOT) })).rejects.toThrow(/不属于当前工作空间|路由一致性/);
    await expect(() => tool.execute({ server: full(ROOT, "s"), tool: "t" }, { agent: agentIn(OTHER_ROOT) })).rejects.toThrow(/无法确定工作空间/);
  });

  it("unit 缺失 → 报「无项目级 MCP 配置」；project 模式调全局级 → 引导改用 mcp__ 直呼", async () => {
    const noUnit = callEnv({ units: [] });
    const toolNoUnit = buildCallTool(noUnit.toolCtx);
    await expect(() => toolNoUnit.execute({ server: full(ROOT, "s"), tool: "t" }, { agent: agentIn(ROOT) })).rejects.toThrow(/无项目级 MCP 配置/);

    const withGlobal = callEnv({ host: { isGlobalServer: (name) => name === "gctx" }, units: [] });
    const toolGlobal = buildCallTool(withGlobal.toolCtx);
    await expect(() => toolGlobal.execute({ server: full(GLOBAL_ROOT, "gctx"), tool: "t" }, { agent: agentIn(ROOT) })).rejects.toThrow(/全局级（global scope）服务器/);
    await expect(() => toolGlobal.execute({ server: full(GLOBAL_ROOT, "gctx"), tool: "t" }, { agent: agentIn(ROOT) })).rejects.toThrow(/mcp__gctx__<tool>/);
  });

  it("成功路径：先 ensureConnected 再 callTool，参数与 signal/agent 透传，统计上报 ok", async () => {
    const stats = fakeStats(true);
    const { toolCtx, calls } = callEnv({ stats });
    const tool = buildCallTool(toolCtx);
    const agent = agentIn(ROOT);
    const signal = new AbortController().signal;

    const out = await tool.execute({ server: full(ROOT, "alpha"), tool: "tool0", arguments: { a: 1 } }, { agent, signal });
    expect(out).toEqual(okResult);
    expect(calls[0]).toEqual(["ensureConnected", ROOT, "alpha", undefined]);
    expect(calls[1]).toEqual(["callTool", full(ROOT, "alpha"), "tool0", { a: 1 }, signal, agent]);
    expect(stats.calls).toHaveLength(1);
    expect(stats.calls[0].slice(0, 5)).toEqual(["call", "alpha", "tool0", true, true]);
  });

  it("失败路径：原错误上抛，统计上报 ok=false 且带消息", async () => {
    const stats = fakeStats(true);
    const { toolCtx } = callEnv({
      stats,
      callTool: async () => {
        throw new Error("remote exploded");
      },
    });
    const tool = buildCallTool(toolCtx);

    await expect(() => tool.execute({ server: full(ROOT, "alpha"), tool: "tool0" }, { agent: agentIn(ROOT) })).rejects.toThrow(/remote exploded/);
    expect(stats.calls).toHaveLength(1);
    expect(stats.calls[0].slice(0, 5)).toEqual(["call", "alpha", "tool0", true, false]);
    expect(stats.calls[0][5]).toBe("remote exploded");
  });

  it("统计关闭时不上报；arguments 缺失按 undefined 透传", async () => {
    const off = fakeStats(false);
    const { toolCtx, calls } = callEnv({ stats: off });
    const tool = buildCallTool(toolCtx);
    await tool.execute({ server: full(ROOT, "alpha"), tool: "tool0" }, { agent: agentIn(ROOT) });
    expect(off.calls).toEqual([]);
    expect(calls[1][3], "arguments 缺失即 undefined").toBeUndefined();
  });

  it("工具定义面：名称/必填参数/超时预算", () => {
    const tool = buildCallTool(callEnv().toolCtx);
    expect(tool.timeoutMs).toBeGreaterThan(0);
    expect(tool.name).toBe("ws_mcp_call");
    expect(tool.parameters.required).toEqual(["server", "tool"]);
  });

  it("render：text / resource / 未知类型 / 非对象 / 空内容", () => {
    const tool = buildCallTool(callEnv().toolCtx);
    const render = tool.output.render;

    const mixed = textOf(
      render(undefined, {
        content: [
          { type: "text", text: "hello" },
          { type: "resource", resource: {} },
          { type: "resource_link" },
          { type: "image" },
          {},
          null,
          "plain-string",
          { type: "text", text: 42 },
        ],
      }),
    );
    expect(mixed).toContain("hello");
    expect(mixed).toContain("[resource: content discarded]");
    expect(mixed).toContain("[image content]");
    expect(mixed, "type 缺失走 unknown").toContain("[unknown content]");
    expect(mixed, "text 非字符串不算命中").toContain("[text content]");
    expect(mixed, "非对象块统一兜底").toContain("[unsupported MCP content]");

    expect(textOf(render(undefined, { content: [] }))).toBe("(MCP tool returned no content)");
    expect(textOf(render(undefined, null))).toBe("(MCP tool returned no content)");
    expect(textOf(render(undefined, { content: "nope" }))).toBe("(MCP tool returned no content)");
  });
});

// ---------------------------------------------------------------------------
// middleware-shared
// ---------------------------------------------------------------------------

describe("middleware-shared：可见 root 集合 / 路由一致性校验 / 等待发现", () => {
  it("visibleMiddlewareRoots：undefined / project / all（含 @global 去重）", () => {
    expect(visibleMiddlewareRoots(undefined, "project")).toEqual([]);
    expect(visibleMiddlewareRoots(ROOT, "project")).toEqual([ROOT]);
    expect(visibleMiddlewareRoots(ROOT, "off")).toEqual([ROOT]);
    expect(visibleMiddlewareRoots(ROOT, "all")).toEqual([ROOT, GLOBAL_ROOT]);
    expect(visibleMiddlewareRoots(GLOBAL_ROOT, "all"), "root 即 @global 时不重复").toEqual([GLOBAL_ROOT]);
  });

  it("checkMiddlewareRoot：格式非法 / 跨 root / 全局级引导（双源）/ 未知 @global / 放行", async () => {
    const { mw } = makeEnv({
      host: { isGlobalServer: (name) => name === "known-global" },
      units: [[GLOBAL_ROOT, makeUnit(GLOBAL_ROOT, [["catalog-global", makeCatalog()]])]],
    });

    await expect(() => checkMiddlewareRoot("ws_mcp_call", "bad", ROOT, "project", mw)).rejects.toThrow(/server 参数格式非法/);
    await expect(() => checkMiddlewareRoot("ws_mcp_call", full(OTHER_ROOT, "s"), ROOT, "project", mw)).rejects.toThrow(/路由一致性校验失败/);

    await expect(() => checkMiddlewareRoot("ws_mcp_detail", full(GLOBAL_ROOT, "known-global"), ROOT, "project", mw)).rejects.toThrow(/全局级（global scope）服务器/);
    await expect(() => checkMiddlewareRoot("ws_mcp_detail", full(GLOBAL_ROOT, "catalog-global"), ROOT, "project", mw)).rejects.toThrow(/全局级（global scope）服务器/);
    await expect(() => checkMiddlewareRoot("ws_mcp_detail", full(GLOBAL_ROOT, "stranger"), ROOT, "project", mw)).rejects.toThrow(/路由一致性校验失败/);

    expect(await checkMiddlewareRoot("ws_mcp_call", full(ROOT, "s"), ROOT, "project", mw)).toBe(ROOT);
    expect(await checkMiddlewareRoot("ws_mcp_call", full(GLOBAL_ROOT, "stranger"), ROOT, "all", mw), "all 模式放行全局").toBe(GLOBAL_ROOT);
  });

  it("waitForDiscovery：无 in-flight 立即返回；有 in-flight 等其落定；被拒也不抛（allSettled 语义）", async () => {
    await expect(waitForDiscovery(makeUnit(ROOT, []))).resolves.toBeUndefined();

    let released;
    const pending = new Promise((resolve) => {
      released = resolve;
    });
    const waiting = waitForDiscovery(makeUnit(ROOT, [], { inFlight: new Map([["alpha", pending]]) }));
    released();
    await expect(waiting).resolves.toBeUndefined();

    const rejected = makeUnit(ROOT, [], { inFlight: new Map([["beta", Promise.reject(new Error("boom"))]]) });
    await expect(waitForDiscovery(rejected), "allSettled：失败不冒泡").resolves.toBeUndefined();

    const mixed = makeUnit(ROOT, [], {
      inFlight: new Map([
        ["ok", Promise.resolve(1)],
        ["bad", Promise.reject(new Error("x"))],
      ]),
    });
    await expect(waitForDiscovery(mixed)).resolves.toBeUndefined();
  });
});

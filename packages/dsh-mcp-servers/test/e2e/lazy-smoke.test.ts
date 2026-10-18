// @ts-nocheck
/**
 * dsh-mcp-servers — e2e：lazy 按需装载端到端（真实 stdio MCP 子进程）。
 *
 * 覆盖设计稿 §6 的 e2e 行（本文件独立于 smoke.test.ts，避免其继续膨胀）：
 * 1. connect → search 可见 → ws_mcp_load 装载 → 注册的是带真实 inputSchema 的
 *    模型面定义（且不带 deferLoading：C1）；
 * 2. 装载后的定义直呼 → 真实 MCP 子进程往返 → 结果投影为文本；
 * 3. 断连语义：单元拆毁后**定义仍在**（C2 不卸载），execute 返回可行动的
 *    「未连接 / 未激活」错误，而不是 UNKNOWN_TOOL / 静默成功。
 *
 * 手法与 unit-manager2 的真实 stdio 用例同源：临时目录里写一个最小 JSON-RPC
 * MCP server（node 直跑），经真实 transport 建连。零网络、零真实凭据。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const {
  McpMiddleware,
  registerMiddlewareTools,
  createRegistrar,
  normalizeServer,
  fullServerName,
} = await import("../../lib/index.js");

const MINI_SERVER = [
  'import { createInterface } from "node:readline";',
  'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
  'createInterface({ input: process.stdin }).on("line", (line) => {',
  "  let msg; try { msg = JSON.parse(line); } catch { return; }",
  '  if (msg.method === "initialize") {',
  '    send({ id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mini", version: "0.0.1" } } });',
  '  } else if (msg.method === "tools/list") {',
  '    send({ id: msg.id, result: { tools: [{ name: "ping", description: "ping back with the given text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] } });',
  '  } else if (msg.method === "tools/call") {',
  '    send({ id: msg.id, result: { content: [{ type: "text", text: "pong:" + String(msg.params?.arguments?.text ?? "") }] } });',
  '  } else if (msg.id !== undefined) {',
  '    send({ id: msg.id, error: { code: -32601, message: "method not found" } });',
  "  }",
  "});",
].join("\n");

let cleanups = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "dsh-mcp-servers-lazy-e2e-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup();
    } catch {
      // 清理失败不掩盖用例结论
    }
  }
  cleanups = [];
});

/** 建一套真实中间层 + 一个最小 stdio MCP server（不起 web / 不写用户目录）。 */
async function makeEnv() {
  const dir = makeTempDir();
  const script = join(dir, "mini-mcp-server.mjs");
  writeFileSync(script, MINI_SERVER, "utf8");
  const root = join(dir, "proj");
  const server = normalizeServer({
    name: "mini",
    transport: "stdio",
    command: process.execPath,
    args: [script],
    reconnect: { enabled: false },
  });
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
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  const mw = new McpMiddleware(
    {
      ctx,
      logger,
      projectServersFor: async (requestedRoot) => (requestedRoot === root ? [server] : undefined),
      globalServers: () => [],
      normalizedProjectRoot: async (cwd) => (cwd === root ? root : undefined),
      saveUserState: async () => {},
      emitStatus: () => {},
      catalogCachePath: () => join(dir, "catalog-cache.json"),
      isGlobalServer: () => false,
      isRuntimeServer: () => false,
    },
    {},
  );
  cleanups.push(async () => {
    await mw.dispose();
  });
  const registrar = createRegistrar(ctx, {});
  const resolveRoot = async (agent) => (agent?.session?.header?.cwd === root ? root : undefined);
  const dispose = registerMiddlewareTools(ctx, mw, resolveRoot, "lazy", { registrar });
  cleanups.push(() => dispose());
  return { dir, root, server, ctx, registered, listeners, mw, registrar };
}

describe("lazy 端到端：真实 MCP 子进程按需装载", () => {
  it("connect → load → 注册带真实 schema 的定义 → 直呼往返成功", async () => {
    const env = await makeEnv();
    const agent = { session: { header: { cwd: env.root } } };
    // 触达单元并完成发现（惰性连接 + waitForDiscovery 在 load 内部完成）。
    const unit = await env.mw.projectUnitFor(env.root);
    expect(unit !== undefined).toBe(true);

    const name = "mcp__mini__ping";
    // 装载前：没有 mcp__ 工具（lazy 的核心承诺）
    expect(env.registered.has(name)).toBe(false);

    const load = env.registered.get("ws_mcp_load");
    const result = await load.execute({ tools: ["mini/ping"] }, { agent });
    expect(result.activated).toHaveLength(1);
    expect(result.activated[0].name).toBe(name);
    expect(result.activated[0].server).toBe(fullServerName(env.root, "mini"));
    expect(result.activated[0].required).toEqual(["text"]);
    expect(result.activated[0].description).toContain("ping back");

    // 注册的是模型面定义：真实 inputSchema + 不带 deferLoading（C1）
    const definition = env.registered.get(name);
    expect(definition !== undefined).toBe(true);
    expect(definition.parameters.required).toEqual(["text"]);
    expect(Object.prototype.hasOwnProperty.call(definition, "deferLoading")).toBe(false);

    // 直呼：真实 stdio 往返（initialize → tools/call）
    const value = await definition.execute({ text: "hello" }, {});
    const text = value.content.map((block) => block.text).join("\n");
    expect(text).toBe("pong:hello");

    // 幂等：重复装载返回 alreadyLoaded，不重复注册（C4）
    const again = await load.execute({ tools: [name] }, { agent });
    expect(again.activated).toEqual([]);
    expect(again.alreadyLoaded).toEqual([name]);
  }, 120_000);

  it("断连语义：单元拆毁后定义保留，execute 返回可行动错误（C2）", async () => {
    const env = await makeEnv();
    const agent = { session: { header: { cwd: env.root } } };
    const load = env.registered.get("ws_mcp_load");
    await load.execute({ tools: ["mini/ping"] }, { agent });
    const definition = env.registered.get("mcp__mini__ping");
    expect(definition !== undefined).toBe(true);

    // 服务器拆除（等价于用户断开 / 服务器被移除连接）：定义不卸载
    env.mw.teardownUnit(env.root);
    expect(env.registered.has("mcp__mini__ping")).toBe(true);

    await expect(definition.execute({ text: "x" }, {})).rejects.toThrow(/ws_mcp_call/);
  }, 120_000);
});

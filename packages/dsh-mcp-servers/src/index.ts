/**
 * dsh-mcp-servers — 主机端（组合根）。
 *
 * 管理本机的 MCP（Model Context Protocol）服务器并桥接到 DSH：
 *  - 服务器配置持久化在 `~/.dsh/dsh-mcp.json`（版本化，原子写入）；
 *  - 每个服务器一个连接监督器（supervisor）：stdio / streamable-http 两种
 *    传输，指数退避重连，断开后按预算放弃；
 *  - 已连接服务器的工具以 `mcp__<serverName>__<rawName>` 注册进
 *    `ctx.tools`，模型可直接调用（与官方 dsh-mcp-client 同名契约）；
 *  - `/api/dsh-mcp-servers/*` 路由（loopback-only）供设置页「MCP 服务器」
 *    分级展示、新增/编辑/启停/删除、单次探活、粘贴 mcpServers JSON 导入；
 *  - 零运行时依赖：MCP 协议客户端（JSON-RPC over stdio / streamable-http）
 *    直接基于 node:child_process 与全局 fetch 实现（经官方 SDK 传输层）。
 *
 * 激活：安装进 profile（见 cordis.patch.yml 注释），重启一次 dsh web 后，
 * 设置左侧菜单出现「MCP 服务器」入口。
 *
 * 结构：职责按模块拆分（store / transport / protocol / supervisor /
 * routes / catalog / import / normalize / config-schema / manager / apply），
 * 本文件保留插件契约转发（apply）与全部公共符号 re-export（导出面不变）。
 */

// 类型面加载（declare module 合并）：dsh-agent 注入 agent/* 事件（含 pre-step
// waterfall）、dsh-tools 注入 ctx.tools、dsh-system-prompt 注入 ctx.systemPrompt。
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-system-prompt";
import type {} from "@deepseek-ai/dsh-tools";

/** 稳定的 cordis 插件名。 */
export const name = "mcp-servers";

/** 需要已初始化的工具注册表、web 服务器与提示词组装器。 */
export const inject = ["tools", "webServer", "systemPrompt"];

// ------------------------------------------------------------ re-export
// 导出面与拆分前 lib/index.js 完全一致（smoke 验收契约）。

// 插件契约转发（apply 主流程 + 宣告文本实现于 apply.ts）
export { apply, MCP_GUIDANCE, MCP_SECTION_ORDER } from "./bootstrap/interface.ts";
export { resolveDebugConfig, resolveMiddlewareMode } from "./bootstrap/interface.ts";
// 运行期装配工厂（组合根）：热切换为契约测试面
export { makeMiddlewareHotSwitch } from "./bootstrap/interface.ts";

// 插件 Config schema 与配置归一化（类型自 types.ts 取）
export {
  DEFAULT_ENHANCE_EMPTY_DESCRIPTIONS,
  Config,
} from "./config/model/interface.ts";

// 管理器 / 连接域（orchestrator+runtime）
export { McpServers } from "./connection/orchestrator/interface.ts";
export {
  ConnectionSupervisor,
  McpMiddleware,
  expandEnv,
  HttpTransport,
  parseSsePayload,
  StdioTransport,
  createTransport,
  MCPClient,
  DEFAULT_TOOL_CALL_TIMEOUT_MS,
  DEFAULT_RESULT_TRUNCATE_BYTES,
  publicToolName,
  truncateText,
  assertSupportedOutputSchema,
  buildToolDefinition,
  RECONNECT_DEFAULTS,
  resolveReconnect,
  CONNECT_TIMEOUT_MS,
  DISCOVERY_TIMEOUT_MS,
  CALL_TIMEOUT_MS,
  CATALOG_TTL_MS,
  CATALOG_LRU_MAX,
  MAX_TOOLS_PER_SERVER,
  MAX_BYTES_PER_TOOL,
  MAX_TOTAL_CATALOG_BYTES,
  LIST_DEFAULT_TOOLS_PER_SERVER,
  LIST_MAX_TOOLS_PER_SERVER,
} from "./connection/interface.ts";
export type { ReconnectPolicy, McpServers as McpServersType } from "./connection/interface.ts";
// 工作空间路由域（项目根发现 / 全名解析 / scope / 模式归一化）
export { findProjectRoot, normalizedProjectRoot, makeResolveRoot, MIDDLEWARE_GLOBAL_ROOT } from "./workspace/interface.ts";
export {
  fullServerName,
  parseFullServerName,
  bareServerName,
  normalizeToolName,
  normalizeMiddlewareMode,
} from "./workspace/interface.ts";
// 执行管道域（两路径同构纯函数族）
export {
  normalizeArguments,
  msgOf,
  createRedactor,
  withTimeout,
  globMatch,
  policyAllows,
  policyDenialReason,
  isToolDenied,
  toolDisabledReason,
  defaultCallResultFallbackText,
  projectCallToolResult,
} from "./pipeline/interface.ts";
export type { CallResultTextHandlers, ProjectedCallResult } from "./pipeline/interface.ts";
// 核心化 service（官方 storageDomain 模式）：ctx.mcpServers 类型面 + 声明合并。
// 仅类型导出（无副作用导入）：消费方 import 类型时 tsc 会解析 service.d.ts，
// 其内的 declare module 合并自动生效。
export type { McpServerInput, McpServersService } from "./integration/interface.ts";

// 存储与状态持久化（config/store）
export { defaultStorePath, McpStore } from "./config/store/interface.ts";
export {
  userStateFile,
  loadUserState,
  saveUserState,
  loadDisabledTools,
  saveDisabledTools,
  parseDisabledTools,
  catalogCacheFileFor,
  readCatalogServerFromDisk,
} from "./config/store/interface.ts";
// 能力目录 / 目录缓存（catalog 域）
export {
  DEFAULT_ANNOUNCE_CATALOG,
  DEFAULT_CATALOG_MAX_ENTRIES,
  catalogCacheFile,
  CATALOG_SUMMARY_MAX_CHARS,
  CATALOG_SUMMARY_PER_TOOL_CHARS,
  CATALOG_ENTRY_MAX_CHARS,
  summarizeToolDescriptions,
  composeCatalogEntries,
  digestCatalogEntries,
  renderMcpCatalogMessage,
  escapeCatalogText,
  findCatalogMessage,
  readCatalogEntries,
  isCatalogSource,
  resolveCatalogEntries,
  CATALOG_SOURCE_PLUGIN,
  CATALOG_SECTION_NAME,
  catalogHistory,
  renderMcpCatalogUpdate,
  resolveCatalogInjection,
  scoreTool,
  searchCatalog,
  isCatalogFresh,
  boundCatalogTools,
  searchCatalogMulti,
  listCatalog,
  findToolDetail,
} from "./catalog/interface.ts";
// mcpServers JSON 导入 / 归一化（config/model）
export { fromClaudeEntry, parseClaudeJson, SERVER_NAME_PATTERN, normalizeServer } from "./config/model/interface.ts";
// 统计与 Debug
export { McpStatsCollector, defaultStatsPath } from "./stats/interface.ts";
export type {
  McpStatsSnapshot,
  ServerStats,
  ToolCallMetric,
  ProgressiveDisclosureStats,
  DebugConfig,
} from "./stats/interface.ts";
// 工具注册面（inject）
export { registerMiddlewareTools, registerDirectMcpGuard } from "./inject/interface.ts";
// 共享类型面（types 域）
export type {
  MiddlewareMode,
  MiddlewarePolicy,
  ProjectUnit,
  SearchHit,
  ListToolEntry,
  ListServerEntry,
  ListCatalogResult,
  ToolDetail,
  DisabledToolsMap,
  ServerConfig,
  ServerStatus,
} from "./types/interface.ts";

// 路由
export { ROUTES, makeRoutes, makeEventsRoute, makeHealthRoute, broadcastFrame, SSE_HEARTBEAT_MS, SSE_PING_FRAME } from "./api/interface.ts";
export { SCOPE_GLOBAL, SCOPE_PROJECT, normalizeScope } from "./workspace/interface.ts";
// 仓库共享层（loopback 围栏 / writeJson / readJsonBody / sseData）
export { isLoopbackRequest } from "../../../shared/loopback.js";
export { writeJson, readJsonBody, sseData } from "../../../shared/host-utils.js";

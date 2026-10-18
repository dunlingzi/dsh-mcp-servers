/**
 * dsh-mcp-servers — 中间层共享类型（单一事实源）。
 *
 * 供 middleware 各职责文件（连接池 / 纯函数 / 检索 / 状态 / 注册）取用；
 * 类型统一自本文件取，防循环引用（type-only，编译期擦除）。
 */

import type { Context, LoggerService } from "@deepseek-ai/cordis";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { MCPClient } from "../connection/interface.ts";
import type { StdioTransport, HttpTransport } from "../connection/interface.ts";
import type { ServerConfig } from "./server.ts";
/**
 * 中间层模式：off = 直呼（默认兼容）；project = 项目级走中间层；
 * all = 全部走中间层；lazy = all 的超集 + 真实工具定义按需注册（ws_mcp_load）。
 * lazy 下全局服务器同样由中间层连接池持有（coversGlobal 同 all 口径），
 * 但启动时不注册任何 mcp__ 工具，避免每轮请求背全量工具 schema。
 */
export type MiddlewareMode = "off" | "project" | "all" | "lazy";

/** 用户已禁用的工具集合（root → server → tool 列表）。root 为 @global 时跨工作空间共享。 */
export type DisabledToolsMap = Map<string, Map<string, Set<string>>>;

/** 策略过滤模式。 */
export interface MiddlewarePolicy {
  /** server 名（裸名，不含 @root 前缀）→ 允许的工具 glob（空 = 全部允许）。 */
  allowTools?: Record<string, string[]>;
  /** server 名（裸名）→ 拒绝的工具 glob（deny 优先）。 */
  denyTools?: Record<string, string[]>;
}

/** 连接池条目（每工作空间一套）。 */
export interface ProjectUnit {
  root: string;
  /** server 名（裸名）→ 连接条目。 */
  connections: Map<string, ConnectionEntry>;
  /** 目录缓存（last-good：连接断不丢）。 */
  catalog: Map<string, CatalogServer>;
  /** 用户禁用集合（持久化）。 */
  userDisabled: Set<string>;
  /** 最近触达时间（LRU 淘汰依据）。 */
  lastTouchedAt: number;
  /** 连接/发现 in-flight 去重（server 名 → Promise）。 */
  inFlight: Map<string, Promise<unknown>>;
}

/** 单服务器连接条目。 */
export interface ConnectionEntry {
  server: ServerConfig;
  client: MCPClient | undefined;
  transport: StdioTransport | HttpTransport | undefined;
  /** 连接状态：connecting / connected / failed / disabled。 */
  status: string;
  error: unknown;
  connectedAt: number | undefined;
  /** 后台重连定时器。 */
  reconnectTimer: NodeJS.Timeout | undefined;
  /** 代际断开清理。 */
  disposed: boolean;
  /** 连续失败次数（有界指数退避依据；连接成功后清零）。 */
  failedAttempts: number;
  /** 防双进程探测命中后的重试已排（#382 F5：只重试一次；连接成功后复位）。 */
  probeRetried?: boolean;
}

/** 目录中的单服务器条目。 */
export interface CatalogServer {
  /** 发现时间戳。 */
  discoveredAt: number;
  /** 工具列表（裸名 → 描述 + schema 摘要）。 */
  tools: Map<string, CatalogTool>;
  /** 发现失败原因（unavailable 段）。 */
  unavailable?: string;
}

/** 目录中的单工具。 */
export interface CatalogTool {
  description: string;
  inputSchema: Record<string, unknown>;
}

/** ws_mcp_search 单条命中。 */
export interface SearchHit {
  server: string;
  tool: string;
  description: string;
  inputSchema: Record<string, unknown>;
  score: number;
  matchedTerms: string[];
  fresh: boolean;
}

/** ws_mcp_list 的单个工具条目（完整清单只给摘要，防上下文膨胀）。 */
export interface ListToolEntry {
  tool: string;
  description: string;
  /** 工具级被用户禁用（独立于服务器级 enabled；仅在禁用时置位）。 */
  disabled?: boolean;
}

/** ws_mcp_list 的单个服务器条目。 */
export interface ListServerEntry {
  /** @<root>/<server> 全名。 */
  server: string;
  /** 用户已禁用（工具来自 last-good 目录缓存，明示）。 */
  disabled?: boolean;
  /** 发现失败原因（unavailable 段）。 */
  unavailable?: string;
  tools: ListToolEntry[];
  /** 工具数被 perServerLimit 截断。 */
  toolsTruncated: boolean;
}

/** ws_mcp_detail 的单工具详情（完整 inputSchema）。 */
export interface ToolDetail {
  /** @<root>/<server> 全名。 */
  server: string;
  /** 远端工具裸名（已归一化）。 */
  tool: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** 目录是否新鲜（TTL 内）。 */
  fresh: boolean;
  /** 用户已禁用。 */
  disabled?: boolean;
}

/**
 * ws_mcp_load 单条装载结果（模型面精简投影：不重复完整 schema——schema 已随
 * 下一步的模型面工具定义下发，重复会白耗上下文）。
 */
export interface LoadedToolEntry {
  /** 模型可见工具名（mcp__<server>__<tool>）。 */
  name: string;
  /** @<root>/<server> 全名。 */
  server: string;
  /** 远端工具裸名。 */
  tool: string;
  /** 截断后的描述（LOAD_DESC_MAX 字符）。 */
  description: string;
  /** 必填参数名（省掉一次 ws_mcp_detail 往返）。 */
  required: string[];
}

/** ws_mcp_load 输出（装载漏斗四分类 + 给模型的下一步）。 */
export interface LoadResult {
  activated: LoadedToolEntry[];
  alreadyLoaded: string[];
  missing: string[];
  unavailable: Array<{ server: string; reason: string }>;
  message: string;
}

/**
 * lazy 注册器可选统计面（结构最小面，避免 inject 域反向依赖 stats 类）。
 * 类型收在 types 域：bootstrap / inject 两侧都只经各自门面引用，防 impl 互引。
 */
export interface LazyRegistrarStats {
  isEnabled?(): boolean;
  recordCall?(server: string, tool: string, durationMs: number, success: boolean, errorMsg?: string): void;
  /** 一次真正生效的装载（幂等命中不计数）。 */
  recordLoad?(server: string, tool: string): void;
  /** 当前已装载工具数（快照通知）。 */
  setLoadedTools?(count: number): void;
}

/** lazy 模式的单条待装载定义（定义 + 归属，供幂等判重与精确回收）。 */
export interface LazyLoadable {
  definition: ToolDefinition;
  /** 服务器裸名（与 mcp__ 工具名同源，跨 root 唯一）。 */
  server: string;
  /** 远端工具裸名。 */
  tool: string;
}

/** lazy 按需定义注册器对外面（ws_mcp_load 与 pre-execute guard 共用）。 */
export interface Registrar {
  /** 幂等装载；返回本次真正激活的名字与本已装载的名字。 */
  load(agent: unknown, definitions: readonly LazyLoadable[]): { activated: string[]; alreadyLoaded: string[] };
  /** 该 agent 是否装载过该工具（agent 作用域不可得时看全局回退槽）。 */
  isLoadedBy(agent: unknown, publicName: string): boolean;
  /** 该名字是否由本注册器注册过（guard 只拦自己的工具，不误伤其他插件的 mcp__）。 */
  isRegistered(publicName: string): boolean;
  /** 当前已装载工具数（统计快照用）。 */
  loadedCount(): number;
  disposeAgent(agent: unknown): void;
  disposeServer(server: string): void;
  disposeAll(): void;
}

/** ws_mcp_list 输出（多单元合并的完整盘点）。 */
export interface ListCatalogResult {
  /** 当前工作空间 root；all 模式无项目 cwd 时为 "@global"。 */
  workspace: string;
  /** 中间层模式（模型据此理解可见范围）。 */
  mode: string;
  servers: ListServerEntry[];
  totalServers: number;
  totalTools: number;
  /** 任一服务器截断即为 true。 */
  toolsTruncated: boolean;
  /** 空返回时给模型的明确提示。 */
  message?: string;
}

/** 中间层最小面（manager 提供）。 */


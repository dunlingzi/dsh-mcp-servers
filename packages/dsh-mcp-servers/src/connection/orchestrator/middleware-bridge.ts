/**
 * dsh-mcp-servers — connection/orchestrator/middleware-bridge.ts：双轨判定与连接池触达。
 *
 * 从 manager.ts 迁入（P3 增量 2，行为逐字保持）：中间层接管判定（start /
 * reconcileServers 单一口径）与三条池操作——@global 单元触达、当前项目单元的
 * 幂等触达、配置变更后的单台拆除。
 *
 * 宿主面以**结构类型** `MiddlewareHost` 表达（McpServers 实例直接满足，字段名与类一致）；
 * 错误脱敏与状态广播以回调注入。本文件不 import 本域门面（避免 interface → impl 回边），
 * 也不持有任何模块级可变状态。
 */
import { MIDDLEWARE_GLOBAL_ROOT, SCOPE_GLOBAL, SCOPE_PROJECT } from "../../workspace/interface.ts";
import type { McpMiddleware } from "../runtime/interface.ts";
import type { McpStore } from "../../config/store/interface.ts";
import type { MiddlewareMode } from "../../types/interface.ts";
import type { LoggerService } from "@deepseek-ai/cordis";

/** 池操作所需的最小宿主面（McpServers 实例直接满足）。 */
export interface MiddlewareHost {
  middleware: McpMiddleware | undefined;
  middlewareMode: MiddlewareMode;
  projectRoot: string | undefined;
  projectStore: McpStore | undefined;
  logger: LoggerService;
}

/** 错误脱敏（宿主注入，与日志 / HTTP body 同口径）。 */
export type RedactError = (error: unknown) => string;
/** 状态变化广播（宿主注入，coalesce 由宿主负责）。 */
export type EmitStatus = () => void;

/**
 * 中间层接管判定（start / reconcileServers 单一口径）：中间层模式的项目级，
 * 或 all 模式的全局级（**含 runtime 注入条目**，#413 消除豁免——all 模式
 * 统一无 mcp__ 前缀直呼，runtime 封装定义服务器经中间层目录投影 + callTool
 * 直呼执行；project / off 模式 runtime 照旧 supervisor 路径注册 mcp__ 工具）。
 */
export function middlewareTakes(host: MiddlewareHost, name: string, scope: string): boolean {
  if (host.middlewareMode === "off" || host.middleware === undefined) return false;
  if (scope === SCOPE_PROJECT) return true;
  return host.middlewareMode === "all" && scope === SCOPE_GLOBAL;
}

/**
 * 触达 @global 单元并确保该全局服务器连接（all 模式 start 接管路径）。
 * projectUnitFor 首次触达会连带惰性连接全部全局服务器，等价 startAll 语义；
 * userDisabled 命中不连（与浮窗断开语义一致）。
 */
export function touchGlobalUnit(host: MiddlewareHost, redact: RedactError, name: string): void {
  const mw = host.middleware;
  if (mw === undefined) return;
  void mw.projectUnitFor(MIDDLEWARE_GLOBAL_ROOT)
    .then((unit) => {
      if (unit === undefined || unit.userDisabled.has(name)) return;
      void mw.ensureConnected(MIDDLEWARE_GLOBAL_ROOT, name);
    })
    .catch((error: unknown) => {
      // #392 遗留⑥：不再静默吞错——projectUnitFor 失败时打 warn 日志，
      // 否则该服务器永不连接且无迹可查（ensureConnected 调用面仍会尝试）。
      host.logger.warn(`dsh-mcp-servers: touchGlobalUnit(${name}) failed: ${redact(error)}`);
    });
}

/**
 * 幂等触达当前项目单元并确保该服务器连接（#616：start 的中间层项目级接管路径，
 * 取代旧 touchMiddlewareUnit 的整单元拆毁语义）。
 * - 单元缺失（宿主重启 / 首次 reconcile）：projectUnitFor 创建 + 惰性连接全部；
 * - 单元已存在（配置热重载 / 误触发的 reconcile）：保留既有连接，仅对**该**服务器
 *   ensureConnected（connected/connecting 短路，幂等）；
 * - entry 已存在但 store 配置已变（手工编辑 mcp.json 热重载）：force 单台重建——
 *   旧实现的配置生效来自整单元拆毁的副作用，此处改为精确到单台，不殃及同单元
 *   其他连接。
 * userDisabled 命中不连（与浮窗断开语义一致）；无活动项目 root 静默返回
 * （与旧 touchMiddlewareUnit 同口径）。
 */
export function ensureMiddlewareServer(host: MiddlewareHost, redact: RedactError, name: string): void {
  const mw = host.middleware;
  if (mw === undefined || host.projectRoot === undefined) return;
  // 入口捕获 root（评审 P2-3）：.then 回调内不再读宿主 projectRoot——
  // setSession 切换后实例字段已变，沿用调用时快照保证 root 与 unit 配套。
  const root = host.projectRoot;
  void mw.projectUnitFor(root)
    .then(async (unit) => {
      if (unit === undefined || unit.userDisabled.has(name)) return;
      const current = host.projectStore?.find(name);
      const entry = unit.connections.get(name);
      // 配置一致性比对（同源 store 实例）：未重载时 entry.server 与 current
      // 为同一对象引用恒等；真变更必经 reloadIfChanged → load() 整组换新
      // 对象（键序由 normalizeServer 固定），内容不同则串必不同——假阴性
      // 不存在；唯一假阳性是用户手排 mcp.json 键序（值不变）触发一次性
      // force 重连，重建后自愈、不循环。
      if (entry !== undefined && current !== undefined && JSON.stringify(entry.server) !== JSON.stringify(current)) {
        await mw.ensureConnected(root, name, { force: true });
        return;
      }
      await mw.ensureConnected(root, name);
    })
    .catch((error: unknown) => {
      host.logger.warn(`dsh-mcp-servers: ensureMiddlewareServer(${name}) failed: ${redact(error)}`);
    });
}

/**
 * 拆除中间层池中该 server 的连接（update/remove 配置变更后强制重建；
 * 不写 userDisabled——与 disconnect 的禁用语义区分）。此前 update/remove 仅
 * 处理项目单元，all 模式全局池连接与目录残留导致「已删服务器仍可调用」。
 */
export function dropMiddlewareConnection(host: MiddlewareHost, emitStatus: EmitStatus, name: string): void {
  const mw = host.middleware;
  if (mw === undefined) return;
  let dropped = false;
  for (const unit of mw.units.values()) {
    const entry = unit.connections.get(name);
    if (entry !== undefined) {
      dropped = true;
      entry.disposed = true;
      if (entry.reconnectTimer !== undefined) clearTimeout(entry.reconnectTimer);
      const client = entry.client;
      entry.client = undefined;
      entry.transport = undefined;
      if (client !== undefined && client.transport !== undefined) void client.transport.close().catch(() => {});
      unit.connections.delete(name);
    }
    // #392 遗留①：目录条目随连接一并拆除——remove/update 后已删服务器不再以
    // 幽灵条目出现在 ws_mcp_list / ws_mcp_search（此前只拆连接，目录 TTL 内残留）。
    // 内存目录先行删除；磁盘 last-good 缓存异步同步（防重启后 loadCatalogCache
    // 把幽灵条目载回——persistCatalog 空采集不写盘，remove 后目录可能为空，必须
    // 显式清盘而非依赖全量覆盖写）。
    if (unit.catalog.delete(name)) {
      dropped = true;
      void mw.removeCatalogEntry(unit.root, name).catch(() => {});
    }
  }
  // 拆除即废弃同名在途建连标记：entry 被强拆后旧 attempt 仍可能 pending 至
  // CONNECT_TIMEOUT_MS，残留去重标记会吞掉 remove/update 后的同名重连（含
  // 重加配置立即重建）——详见 middleware.abandonInFlight 不变式。
  mw.abandonInFlight(name);
  if (dropped) emitStatus();
}

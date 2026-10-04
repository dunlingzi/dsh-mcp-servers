/**
 * dsh-mcp-servers — connection/orchestrator/reconcile.ts：配置驱动的连接集合收敛。
 *
 * 从 manager.ts 迁入（P3 增量 3b，行为逐字保持）：
 *   - `reconcileServers`：双轨求差集（全局 store ∪ 项目 store ∪ runtimeRegistry），
 *     该停的停、该起的起，防重入由宿主 `reconcileBusy` 承担；
 *   - `startAll`：启动全部 enabled 的全局服务器；
 *   - `startServer`：起单台 supervisor，中间层接管路径下沉在此（#382 F3 / #616）。
 *
 * 宿主面以**结构类型** `ReconcileHost` 表达（McpServers 实例直接满足，字段名与类一致）；
 * 类内 private 的三项能力以回调注入（不复制口径）。本文件不 import 本域门面，
 * 也不持有模块级可变状态。
 */
import type { LoggerService } from "@deepseek-ai/cordis";
import type { McpStore } from "../../config/store/interface.ts";
import type { ManagerLite, MiddlewareMode, ServerConfig } from "../../types/interface.ts";
import { ConnectionSupervisor } from "../runtime/interface.ts";
import { SCOPE_GLOBAL, SCOPE_PROJECT } from "../../workspace/interface.ts";

/** 收敛所需的最小宿主面（McpServers 实例直接满足）。 */
export interface ReconcileHost {
  store: McpStore;
  projectStore: McpStore | undefined;
  runtimeRegistry: Map<string, ServerConfig>;
  supervisors: Map<string, ConnectionSupervisor>;
  middlewareMode: MiddlewareMode;
  reconcileBusy: boolean;
  logger: LoggerService;
}

/**
 * 按当前配置同步 supervisor：配置中移除 / 禁用的断开，新增 / 恢复的启动。
 * 同步方法（start/stop 均为同步登记 + 异步连接）；防重入（读取路径可并发）。
 * @returns 是否有连接集合变化
 */
export function reconcileServers(
  host: ReconcileHost,
  ops: {
    middlewareTakes: (name: string, scope: string) => boolean;
    stop: (name: string) => void;
    start: (name: string, scope: string) => void;
  },
): boolean {
  if (host.reconcileBusy) return false;
  host.reconcileBusy = true;
  try {
    const desired = new Map();
    for (const server of host.store.data.servers) {
      desired.set(server.name, { server, scope: SCOPE_GLOBAL });
    }
    if (host.projectStore !== undefined) {
      for (const server of host.projectStore.data.servers) {
        // 同名项目级被全局顶掉（与 start 的跨 scope 冲突策略一致）。
        if (!desired.has(server.name)) desired.set(server.name, { server, scope: SCOPE_PROJECT });
      }
    }
    // 双轨合并：runtimeRegistry（内存态，运行时注入）并入 desired，同名 runtime 优先。
    // 中间层模式：#413 起 all 模式 runtime 归一中台（同 store 全局走 @global 单元），
    // project 模式 runtime 仍全局 supervisor 路径。
    for (const [name, server] of host.runtimeRegistry) {
      desired.set(name, { server, scope: SCOPE_GLOBAL });
    }
    let changed = false;
    for (const [name, supervisor] of [...host.supervisors]) {
      const want = desired.get(name);
      // 中间层接管（与 start 同口径单一事实源 middlewareTakes）：停掉不该以
      // supervisor 形态存在的连接（#413：all 模式 runtime 亦被接管，同样停）。
      const takes = ops.middlewareTakes(name, supervisor.scope);
      if (want === undefined || want.server.enabled === false || want.scope !== supervisor.scope || takes) {
        ops.stop(name);
        changed = true;
      }
    }
    for (const [name, want] of desired) {
      if (want.server.enabled === false) continue;
      // project 模式项目级：由中间层单元管理（ensureMiddlewareServer 幂等触达，#616），
      // 不经 start；all 模式全局照常 start——start 内部下沉接管（触达 @global）。
      if (host.middlewareMode === "project" && want.scope === SCOPE_PROJECT) continue;
      const existing = host.supervisors.get(name);
      if (existing === undefined || existing.scope !== want.scope) {
        ops.start(name, want.scope);
        // all 模式全局接管路径（start 内部触达池）不建 supervisor——池连接
        // 变化由 connectInternal emitStatus 上报，不计入 supervisor 集合变化。
        if (!ops.middlewareTakes(name, want.scope)) changed = true;
      }
    }
    return changed;
  } finally {
    host.reconcileBusy = false;
  }
}

/** 启动全部 enabled 的全局服务器（连接为异步登记）。 */
export function startAll(host: ReconcileHost, start: (name: string, scope: string) => void): void {
  for (const server of host.store.data.servers) {
    if (server.enabled !== false) start(server.name, SCOPE_GLOBAL);
  }
}

/**
 * 启动服务器监督器。
 * @param name 服务器名
 * @param scope 作用域（全局 / 项目）
 * @param directConfig 运行时 config 直传（registerServer 注入路径；缺省读 store）。
 *   修 P0（评审③）：同名 runtime 优先生效——store 已有同名时，直传 config 优先于 store 版本。
 */
export function startServer(
  host: ReconcileHost,
  ops: {
    middlewareTakes: (name: string, scope: string) => boolean;
    ensureMiddlewareServer: (name: string) => void;
    touchGlobalUnit: (name: string) => void;
  },
  name: string,
  scope: string,
  directConfig?: ServerConfig,
): void {
  let server = directConfig;
  if (server === undefined) {
    const store = scope === SCOPE_PROJECT ? host.projectStore : host.store;
    if (store === undefined) return;
    server = store.find(name);
    // F2（#382）：runtime 注入条目不落 store——global scope 查不到时回退
    // runtimeRegistry（双轨合并，与 summary/catalogServersFor 同口径），修
    // 修 runtime 注册服务器「浮窗重连断开后连不回」。仅限 global：
    // project 回退会把 runtime 条目挂错 scope，被下次 reconcile 无声停掉。
    if (server === undefined && scope === SCOPE_GLOBAL) {
      const runtime = host.runtimeRegistry.get(name);
      if (runtime !== undefined) {
        host.logger.warn(`dsh-mcp-servers: server "${name}" not in store; using runtime registry entry`);
        server = runtime;
      }
    }
  }
  if (server === undefined) return;
  // F3（#382）：中间层接管判定下沉到 start（与 reconcileServers 同口径，见
  // middlewareTakes）。all 模式全局非 runtime 不建 supervisor——杜绝「先建
  // supervisor 再被 reconcile 停掉」的竞态窗口（热更新后 mcp__ 注册残留 →
  // 中间层防双进程探测命中且无重试 → 掉线），改触达 @global 单元惰性连接；
  // 中间层模式项目级不建 supervisor，走 ensureMiddlewareServer 幂等触达。
  // startAll / add / update / reconcile 各入口自动收敛，无需逐处特判。
  //
  // #616 根因修复：项目级分支此前是 touchMiddlewareUnit()（teardownUnit 拆毁
  // 整个当前项目单元）。reconcileServers 对项目级条目（supervisors 恒无）每次
  // 都会走到 start——浮窗连接/断开任意服务器（saveUserState 写 ~/.dsh → 全局
  // fs.watch → refreshFromDisk → reconcile）就会把当前项目单元连人带连接整个
  // 拆掉，且拆后无任何 projectUnitFor 触达，项目级全部显示/实际断开，直到
  // 切换工作目录（setSession → projectUnitFor）才重建。改为与 touchGlobalUnit
  // 对称的幂等触达（确保单元存在 + 确保该服务器连接），reconcile 不再有拆毁
  // 副作用。
  if (ops.middlewareTakes(name, scope)) {
    if (scope === SCOPE_PROJECT) ops.ensureMiddlewareServer(name);
    else ops.touchGlobalUnit(name);
    return;
  }
  // ConnectionSupervisor 的宿主面就是 McpServers 实例（本函数的 host 即该实例，
  // 只是以结构子集 ReconcileHost 表达）——故此处按 ManagerLite 收窄回退。
  const supervisorHost = host as unknown as ManagerLite;
  const existing = host.supervisors.get(name);
  if (existing !== undefined && existing.client !== undefined) {
    // 已连接：若现有 config 与直传 config 不同（runtime 注入覆盖 store），重建。
    if (directConfig !== undefined && existing.server !== directConfig) {
      // B5/D2：替换分支复用 disconnect 语义（关闭旧 transport + 注销旧工具），
      // 而非只置 disposed——旧代际残留泄漏 stdio 子进程/socket 与工具注册。
      // start 保持同步：void disconnect() 的清理与新代际 syncTools 在各自
      // syncChain 上先后落定（D2：旧清理先于新注册）。
      void existing.disconnect();
      const supervisor = new ConnectionSupervisor(supervisorHost, directConfig, scope);
      host.supervisors.set(name, supervisor);
      void supervisor.connect();
    }
    return;
  }
  if (existing !== undefined && existing.scope !== scope) {
    // 同名服务器跨 scope 冲突：工具名会重复，拒绝启动
    host.logger.warn(`dsh-mcp-servers: server "${name}" already registered in scope "${existing.scope}" — skipping "${scope}"`);
    return;
  }
  // B5：未连接旧代际同样走 disconnect 语义（清 reconnectTimer + 注销残留工具）。
  if (existing !== undefined) void existing.disconnect();
  const supervisor = new ConnectionSupervisor(supervisorHost, server, scope);
  host.supervisors.set(name, supervisor);
  void supervisor.connect();
}

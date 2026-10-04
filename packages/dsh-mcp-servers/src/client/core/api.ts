/**
 * dsh-mcp-servers — 客户端 HTTP API 请求与请求参数拼装（core 层）。
 *
 * 仅 export 纯函数，不依赖任何组件状态；cwd / projectRoot 由调用方显式传入
 * （设置页组件经共享会话状态取值）。
 */

/**
 * tool-disable 的服务器全名形态（C6/C-DTO-4）：`@@global/<name>` 或
 * `@<绝对路径>/<name>`，与宿主 parseFullServerName 归一化一致；projectRoot
 * 缺失（宿主重启）时返回 undefined——调用方必须跳过提交，不得拼非法
 * `@/name`（宿主 parseFullServerName slash<=1 会 400 拒绝）。
 */
export function toolDisableServerKey(server: any, projectRoot: string | undefined): string | undefined {
  if (server.scope === "global") return `@@global/${server.name}`;
  if (typeof projectRoot !== "string" || projectRoot === "") return undefined;
  return `@${projectRoot}/${server.name}`;
}

/**
 * 会话 cwd 查询参数（C7/#412 自愈）：connect/reconnect/probe 等操作携带
 * 当前会话 cwd，宿主 maybeSession 据此恢复会话（middleware project 级连接
 * 需要；宿主 setSession 幂等短路，正常时零副作用）。空 cwd 返回空串。
 *
 * ⚠️ 返回值以 `&` 开头，只能接在**已有 `?`** 的路径后。目标路径尚无 query 时
 * 一律用 `withCwd()`——手拼会把 `&cwd=` 拼进 pathname，宿主 exact 路由不命中，
 * 请求落到前端静态 fallback 并返回 405。
 */
export function cwdQueryOf(cwd: string | undefined): string {
  return typeof cwd === "string" && cwd !== "" ? `&cwd=${encodeURIComponent(cwd)}` : "";
}

/**
 * 给路径追加会话 cwd 查询参数，自动选择 `?` / `&` 分隔符。
 * 无 query 的路径（如 tool-disable）必须走本函数，不要手拼 `cwdQueryOf`。
 */
export function withCwd(path: string, cwd: string | undefined): string {
  if (typeof cwd !== "string" || cwd === "") return path;
  return `${path}${path.includes("?") ? "&" : "?"}cwd=${encodeURIComponent(cwd)}`;
}

/**
 * HTTP API 请求。
 * 返回 JSON 解析后的 body；非 2xx 抛 Error（body.error 优先）。
 * 带默认超时（10s，AbortSignal），防挂起请求占用连接。
 * 调用方自带 signal 时：超时兜底不启用（调用方 signal 优先，避免双取消竞争）。
 */
export async function api(path: any, options: any = {}): Promise<any> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const hasCallerSignal = options.signal !== undefined;
  const controller = new AbortController();
  const timer = hasCallerSignal ? undefined : setTimeout(() => controller.abort(new Error(`request timed out (${timeoutMs}ms)`)), timeoutMs);
  const merged = { ...options, signal: options.signal ?? controller.signal };
  try {
    const response = await fetch(path, merged);
    let body: any;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    if (!response.ok) {
      throw new Error(body?.error ?? `HTTP ${response.status}`);
    }
    return body;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

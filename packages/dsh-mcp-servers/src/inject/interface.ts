/**
 * dsh-mcp-servers — inject/interface.ts：模型面+目录域（inject）门面（D10，#664 阶段 6）。
 *
 * 工具注册面：ws_mcp_* 原子（lazy 模式追加 ws_mcp_load）+ pre-execute guard
 * （registerMiddlewareTools / registerDirectMcpGuard）+ lazy 按需定义注册器
 * （createRegistrar / buildLazyDefinition）。目录外模块**只能**从这里引用
 * （verify-dir-imports 静态强制）。
 */
export { registerMiddlewareTools, registerDirectMcpGuard } from "./middleware-register.ts";
export { createRegistrar, buildLazyDefinition } from "./lazy-registrar.ts";
// 类型面单一事实源在 types 域（DTO 集中）；此处转发供目录外消费者经门面取用。
export type { Registrar, LazyLoadable, LazyRegistrarStats } from "../types/interface.ts";

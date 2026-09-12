/**
 * mcp-servers 核心化 service 类型（官方 storageDomain 模式）。
 *
 * 类型面唯一事实源在 shared/mcp-servers-service.d.ts（本包 re-export 之）；
 * 本文件只做类型 re-export + cordis Context 声明合并。消费方插件
 * **从本包引类型**（`import type { McpServersService } from "@wingsky-1/dsh-mcp-servers"`），
 * 依赖经 package.json workspace:* 声明 + inject。
 *
 * 提供方：apply.ts 中 ctx.provide("mcpServers", service)。
 * 消费方：其他插件经 `ctx.mcpServers` 调用，inject 声明 "mcpServers"（cordis
 * 内核自动处理未启用/启用：服务缺失 → 插件停用，提供后自动激活）。
 */

// 类型 re-export（公共类型面，供消费方 import）。
export type {
  McpServerInput,
  McpServersService,
  McpScope,
  McpServerStatus,
  McpServerSummary,
  McpToolInfo,
} from "../../../../shared/mcp-servers-service.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** mcp-servers 核心服务：其他插件运行时注入/控制/查询 MCP 服务器（官方 storageDomain 模式）。 */
    mcpServers: import("../../../../shared/mcp-servers-service.js").McpServersService;
  }
}
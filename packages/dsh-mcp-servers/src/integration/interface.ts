/**
 * dsh-mcp-servers — integration/interface.ts：服务/统计域（integration）门面（D10，#664 阶段 6）。
 *
 * 核心化 service 类型面（官方 storageDomain 模式）：类型唯一事实源在
 * shared/mcp-servers-service.d.ts，本目录只做 re-export + Context 声明合并。
 * 目录外模块**只能**从这里引用（verify-dir-imports 静态强制）。
 */
export type {
  McpServerInput,
  McpServersService,
  McpScope,
  McpServerStatus,
  McpServerSummary,
  McpToolInfo,
} from "./service.ts";

/**
 * dsh-mcp-servers — 插件 Config schema 与配置归一化（纯函数，单一事实源）。
 *
 * 插件自身 Config（cordis 配置注入入口）：中间层模式/策略、能力目录、
 * 调试统计等；浮窗 UI 配置已随浮窗形态退役（本插件 UI 是设置页「MCP 服务器」）。
 */

import z from "schemastery";
import { DEFAULT_ANNOUNCE_CATALOG, DEFAULT_CATALOG_MAX_ENTRIES } from "../../catalog/interface.ts";
import { DEFAULT_RESULT_TRUNCATE_BYTES } from "../../connection/interface.ts";

/** 空 description 工具的条件拼接默认开启。 */
export const DEFAULT_ENHANCE_EMPTY_DESCRIPTIONS = true;

const DebugConfigSchema = z.object({
  callStats: z.boolean().default(false).description("是否开启 MCP 工具调用统计调试与落盘（默认关闭，仅可通过配置文件开启）"),
  statsFile: z.string().default("").description("统计落盘路径，留空使用默认 <DSH_HOME>/mcp-stats.json"),
}).default({ callStats: false, statsFile: "" });

/**
 * 插件 Config schema（标准 cordis 配置注入入口）。
 * middleware / middlewarePolicy 可在设置页「MCP 服务器」热切换（保存即生效并持久化），
 * 也可在配置文件中设置（插件启动时读取）。
 */
export const Config: z<{
  enabled: boolean;
  announceToAgent: boolean;
  storePath: string;
  announceCatalog: boolean;
  catalogMaxEntries: number;
  enhanceEmptyDescriptions: boolean;
  resultTruncateBytes: number;
  middleware: "off" | "project" | "all";
  middlewarePolicy: Record<string, unknown>;
  debug: {
    callStats: boolean;
    statsFile: string;
  };
}> = z.object({
  enabled: z.boolean().default(true).description("是否启用本插件"),
  announceToAgent: z.boolean().default(true).description("是否向 Agent 宣告插件（能力清单由 <available_mcp_servers> 承担）"),
  storePath: z.string().description("全局服务器配置路径，留空用默认 <DSH_HOME>/dsh-mcp.json").disabled(true),
  announceCatalog: z.boolean().default(DEFAULT_ANNOUNCE_CATALOG).description("是否注入 MCP 能力目录（<available_mcp_servers>）"),
  catalogMaxEntries: z.number().default(DEFAULT_CATALOG_MAX_ENTRIES).description("目录注入条目上限").disabled(true),
  enhanceEmptyDescriptions: z.boolean().default(DEFAULT_ENHANCE_EMPTY_DESCRIPTIONS).description("空描述工具条件拼接自定义描述"),
  resultTruncateBytes: z.number().default(DEFAULT_RESULT_TRUNCATE_BYTES).description("工具结果截断字节数").disabled(true),
  middleware: z.union([z.const("off"), z.const("project"), z.const("all")]).default("project")
    .description("MCP 中间层模式：off=直接注册 mcp__ 工具（默认兼容）；project=项目级走 ws_mcp_search/ws_mcp_call（推荐）；all=全部走中间层"),
  middlewarePolicy: z.dict(z.any()).default({})
    .description("中间层策略：{ allowTools: {<server>: [glob]}, denyTools: {<server>: [glob]} }，server 为裸名"),
  debug: DebugConfigSchema.disabled(true),
});

# @dunlingzi/dsh-mcp-servers
[![npm](https://img.shields.io/npm/v/@dunlingzi/dsh-mcp-servers)](https://www.npmjs.com/package/@dunlingzi/dsh-mcp-servers)

DSH（DeepSeek Harness）的 **MCP 服务器管理插件**：设置左侧菜单「MCP 服务器」独立页面，
分级展示全部 MCP 服务器（运行中 / 连接中 / 重连中 / 未连接 / 已停用 / 失败），
支持新增、编辑、启停、删除与单次探活（stdio / streamable-http 表单 + 粘贴
mcpServers JSON 导入）。已连接服务器的工具以 `mcp__<server>__<tool>` 注册给
模型直接调用；项目级服务器默认经中间层 `ws_mcp_*` 四原子工具收敛模型面。
MCP 协议客户端基于官方 SDK 传输层（stdio 子进程 + streamable-http），构建期内联，零运行时依赖。

> 本插件自 dsh-plugin-hub 的 dsh-mcp-manager 拆出独立维护：去掉会话右上角浮窗与
> 插件配置卡，管理面统一收进设置页。**与 `@wingsky-1/dsh-mcp-manager` 互斥安装**
> （二选一；配置文件 `<DSH_HOME>/dsh-mcp.json` 双方共用，可直接迁移）。

## 核心优势

- **上下文成本可控**：项目级 MCP 默认经中间层收敛，模型面只占 `ws_mcp_list` /
  `ws_mcp_detail` / `ws_mcp_search` / `ws_mcp_call` 四个原子工具位——当前工作空间
  的项目级接多少台服务器、多少个工具都不膨胀系统提示词；`middleware: all` 可把
  全局服务器也收进中间层，实现全量收敛（两级发现：`ws_mcp_list` 完整盘点 →
  `ws_mcp_detail` 按需拉完整 schema）
- **分工作目录维护**：项目级配置 `<项目根>/.dsh/mcp.json` 随仓库走、可提交 git 团队共享；
  全局配置 `<DSH_HOME>/dsh-mcp.json` 常连；切换会话自动加载当前目录的 MCP 集
- **工作空间隔离**：中间层以会话 cwd 路由到对应连接池，server 全名一致性校验防跨空间
  串台；不同目录注入同名 server 也互不冲突
- **安全的默认值**：配置只存 `${ENV}` 引用、不落盘密钥本身（0600 权限 + 原子写入）；
  stdio 子进程环境净化，宿主凭据形状变量不透传；目录摘要与错误路径经 redactor 脱敏
- **运维省心**：运行中/连接中/失败等分级状态一目了然；断线有界指数退避自动重连；
  每台服务器可独立「测试」探活（连接一次即断，报告延迟与工具数，不改连接状态）；
  直连模式下工具结果按 8KB 截断、调用超时可按 server 覆盖（`toolCallTimeoutMs`）

## 安装

前提：已安装 DeepSeek Harness 且 `dsh web` 可正常启动（未全局安装 dsh 见下方「未全局安装 dsh」）。

### 安装插件（add）

```sh
dsh plugin --profile web add @dunlingzi/dsh-mcp-servers
```

### 卸载插件（remove）

```sh
dsh plugin --profile web remove @dunlingzi/dsh-mcp-servers
```

### 更新插件（update）

```sh
dsh plugin --profile web update @dunlingzi/dsh-mcp-servers
```

> 安装 / 卸载 / 更新后都需**重启一次** `dsh web`（bundle 层只在启动时组合）生效。
> 装完打开 **设置 → MCP 服务器** 即见管理页。

### 未全局安装 dsh

若本机没有全局 `dsh` 命令，用 `npx` 临时拉起（底层调用 `pnpm`，仍需本机装好 `pnpm` 与 `Node.js`）：

```sh
npx @deepseek-ai/dsh plugin --profile web add @dunlingzi/dsh-mcp-servers
npx @deepseek-ai/dsh plugin --profile web remove @dunlingzi/dsh-mcp-servers
npx @deepseek-ai/dsh plugin --profile web update @dunlingzi/dsh-mcp-servers
```

## 使用（设置 → MCP 服务器）

- **列表页**：作用域筛选（全部 / 用户 / 项目）+ 搜索 + 刷新 + 「新建」；卡片按
  「用户（全局）/ 项目级」分组，显示状态点、传输与端点摘要、工具数、启停开关；
  点卡片进入编辑页
- **编辑页**：面包屑返回，表单 / JSON 双模式；字段：名称（编辑时只读）、作用域、
  类型、超时 MS、命令 / 参数 / 环境变量 / 工作目录（stdio）或 URL / 请求头（http）；
  底部左「删除」（带确认）、右「测试 / 取消 / 保存」
- **启停开关**：开启 = 保存配置并连接（热生效）；关闭 = 断开并停用，配置保留
- **测试**：对目标服务器做一次性 MCP 连接（initialize + tools/list），报告延迟与
  工具数；不改连接状态、不注册工具，用于诊断「连没连得上」
- **中间层模式**：页头下拉 `off / project / all`，保存即热生效并持久化，无需重启
  dsh web；保存后配置热加载即时生效，页面状态经 SSE 推送自动刷新

## 配置（中间层）

项目级 MCP 经中间层访问（`middleware: project`，默认）：项目级服务器不再注册
`mcp__` 工具，改经模型面四个原子工具访问——`ws_mcp_list`（完整盘点当前工作空间全部
服务器 + 每台完整工具清单）/ `ws_mcp_detail`（按 `@<root>/<server>` + tool 裸名精确
查询单工具完整 `inputSchema`）/ `ws_mcp_search`（关键词检索，先搜后调）/
`ws_mcp_call`（按 `@<root>/<server>` 全名调用），执行时按调用方会话当前 cwd 路由到
对应工作空间连接池；全局服务器仍直呼 `mcp__<server>__<tool>`。切换 `middleware: off`
回到旧行为（全部直接注册 `mcp__` 工具）；`middleware: all` 则全局服务器也走中间层
（cwd 无项目时回落全局虚拟 root `@global`），模型面完全收敛为四个原子工具。

**中间层模式可在设置页热切换**（设置 → MCP 服务器 → 中间层模式下拉），保存即生效
并持久化，无需重启 dsh web。

| 键 | 值域 | 默认 |
| --- | --- | --- |
| `middleware` | `off` / `project`（推荐）/ `all` | `project` |
| `middlewarePolicy` | `{ allowTools: {<serverKey>: [glob]}, denyTools: {<serverKey>: [glob]} }`（serverKey 为 `@<root>/<server>` 全名（工作空间隔离）或裸名（跨空间共用），全名优先；deny 优先） | `{}` |

## 路由（全部 loopback 围栏）

| 路由 | 说明 |
| --- | --- |
| `/api/dsh-mcp-servers/health` | 健康检查 |
| `/api/dsh-mcp-servers/servers` | 服务器 CRUD（GET 快照 / POST 新增 / PATCH 更新 / DELETE 删除） |
| `/api/dsh-mcp-servers/servers/connect|disconnect|reconnect` | 连接控制 |
| `/api/dsh-mcp-servers/servers/probe` | 单次探活（连接一次即断，报延迟与工具数） |
| `/api/dsh-mcp-servers/config` | 中间层模式读取（GET）/ 热切换（POST） |
| `/api/dsh-mcp-servers/import/json` | 粘贴 mcpServers JSON 导入 |
| `/api/dsh-mcp-servers/session` | 会话切换（跟随会话的项目级 MCP） |
| `/api/dsh-mcp-servers/resume` | 回前台受控重建当前工作空间连接 |
| `/api/dsh-mcp-servers/tool-disable` | 工具级禁用开关（PATCH） |
| `/api/dsh-mcp-servers/events` | SSE 状态推送（30s 心跳 + watchdog 自愈） |

## 运行时注入（ctx.mcpServers.registerServer）

其他插件可经 `ctx.mcpServers.registerServer` 运行时注册 MCP 服务器（内存态不落盘，
同名幂等）。注册入参支持可选 `toolDefinitions`（调用方封装工具定义，`ToolDefinition[]`，
工具名用**裸名**）：提供时该服务器工具全部用封装定义注册（execute 来自调用方，底层
真实实现不外泄）；缺省维持现状（远端 schema + 通用 callTool）。模型可见名仍由
manager 命名机制决定（`mcp__<server>__<tool>`，64 字符 / 哈希后缀）；工具级禁用 /
可见性 / 能力目录对封装工具照常生效。仅运行时注入面消费，不随 store 落盘。

```ts
await ctx.mcpServers.registerServer({
  name: "my-mcp",
  transport: "stdio",
  command: "my-mcp-server",
  args: ["serve", "--mcp"],
  toolDefinitions: [
    {
      name: "my_tool",                    // 裸名
      description: "调用方自定义的封装工具",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      output: { schema: { ... }, render(args, value) { ... } },
      execute: async (args) => { await prepare(); return forwarded; }, // 内部转发，不外泄
    },
  ],
});
```

## 数据与安全

- 服务器配置：`<DSH_HOME>/dsh-mcp.json`（仅存 `${ENV}` 引用，**不落盘密钥本身**）；
  落盘 0600 权限 + 原子写入
- 所有 `/api/dsh-mcp-servers/*` 路由仅限 loopback 访问（非回环 403 / 方法错 405）
- **stdio 子进程环境净化**：父环境去除凭据形状（KEY/TOKEN/SECRET/PASSWORD…）
  与陈旧 `DSH_*` 变量后再合并显式 env——避免把宿主机密透传给 MCP 子进程
- **stdio 子进程继承宿主权限**：MCP 服务器命令在宿主进程权限下执行，
  仅配置可信的服务器
- **MCP 工具在真实服务器上执行，先确认再操作**；工具结果原样返回，
  可能含敏感信息；工具描述/结果按不可信输入对待
- **工作空间隔离（中间层）**：路由以调用方会话当前 cwd 为唯一输入；server
  全名一致性校验（参数声明的 root ≠ 路由 root → 拒绝）防跨空间串台；
  策略 guard（allowTools/denyTools，deny 优先）按 `@<root>/<server>` 全名或裸名配置
- **中间层工具只读边界**：`ws_mcp_list` / `ws_mcp_detail` / `ws_mcp_search` 纯读
  本地目录缓存（不触达远端服务器、不执行工具），不经过策略 guard；`ws_mcp_call`
  是唯一执行远端工具并受策略约束（deny 优先）的入口
- **工具级禁用（三入口一致）**：`ws_mcp_call`（callTool 先查禁用表再查策略）、
  pre-execute guard（`mcp__` 前缀直呼工具）、插件侧声明的纪律裸名工具
  统一走 `isToolDenied` 裁决；禁用记录 `<DSH_HOME>/dsh-mcp-user-state.json` 的
  `disabledTools`（`@global` key 跨工作空间共享，合并写盘不整表覆盖）
- **凭据脱敏**：目录摘要与错误路径经 redactor 把 env/headers/URL 用户信息等凭据
  形状替换为 `[REDACTED]`；supervisor/manager 错误日志与 HTTP body 同口径脱敏
- **调用统计与 Debug 模式（Metadata-Only）**：默认关闭；若在 `~/.dsh/settings.yaml`
  中配置 `dsh-mcp-servers.debug.callStats: true`，将把 MCP 调用指标防抖原子持久化至
  `<DSH_HOME>/mcp-stats.json`；严格不持久化用户 arguments 与返回 content
- **能力目录注入的消息来源形态**：`source` 用宿主已登记的通用形态
  `{ kind: "plugin", plugin: "@dunlingzi/dsh-mcp-servers", form: "snapshot", ... }`，
  自造 `source.kind` 会被 dsh 的 session format v2→v3 迁移闸门拒绝（#723 同类问题，
  本插件写入侧已按宿主词表实现，不引入该缺陷）

## 测试

测试单份维护、变异自动覆盖：单元测试只维护 `test/*.test.ts`（`import "../../lib/index.js"` 或直连 src）；
stryker 经 lib→src hook 复用同一份断言，无需手工同步副本。

```sh
# 健康检查（回环）
curl -s http://127.0.0.1:3080/api/dsh-mcp-servers/health

# 源码在 src/，改后必须 build
pnpm --filter @dunlingzi/dsh-mcp-servers build
pnpm --filter @dunlingzi/dsh-mcp-servers test
```

## 已知限制

- 不订阅 MCP 的 `tools/list_changed` 通知（无 SSE 长连接到远端）；工具列表变化在
  重连 / 手动刷新时重新同步
- 中间层目录是「采集边界内的 last-good 快照」（单服务器 ≤512 工具 / ≤256KB 总量），
  发现失败时 list 透出 `unavailable` 原因
- 仅桥接工具能力；MCP 的 resources 与 prompts 尚无 harness 消费接口
- 依赖 Node ≥ 20

## 类型依赖

宿主端类型来自官方 `@deepseek-ai/*` 包（`cordis` / `dsh-host-webserver` / `dsh-agent` /
`dsh-tools` / `dsh-system-prompt` / `dsh-llm`，版本统一锁在仓库 `pnpm-workspace.yaml`
catalog，随 DSH 发布节奏升级）：**仅 `import type` 编译期使用**，编译产物零官方运行时导入。
包以 optional peerDependencies 声明这一宿主耦合；对插件做类型检查的消费者需可解析
这些官方包（跳过类型检查则无影响）。

## License

MIT

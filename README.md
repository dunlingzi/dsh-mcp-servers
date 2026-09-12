# dsh-mcp-servers

DeepSeek Harness（DSH）的 **MCP 服务器管理插件**：在 `dsh web` 设置左侧菜单提供
「MCP 服务器」独立页面——分级展示全部 MCP 服务器，支持新增、编辑、启停、删除与
单次探活；已连接服务器的工具注册给模型直接调用，项目级服务器默认经中间层收敛模型面。

插件包见 [packages/dsh-mcp-servers](packages/dsh-mcp-servers/README.md)
（[English](packages/dsh-mcp-servers/README.en.md)）。

## 一句话

- 装：`dsh plugin --profile web add @wingsky-1/dsh-mcp-servers`，重启一次 `dsh web`
- 用：打开 **设置 → MCP 服务器**——列表 / 新建 / 编辑 / 启停 / 删除 / 测试 / 中间层切换
- 省上下文：项目级 MCP 经 `ws_mcp_list / detail / search / call` 四原子工具访问，
  接多少台服务器都不膨胀系统提示词

## 与 @wingsky-1/dsh-mcp-manager 的关系

本插件自 dsh-plugin-hub 的 `dsh-mcp-manager` 拆出独立维护：

- 去掉会话右上角浮窗与「设置 → 插件」配置卡，管理面统一收进设置页
- 新增单次探活（probe：连接一次即断，报告延迟与工具数）与编辑页表单 / JSON 双模式
- **与 `@wingsky-1/dsh-mcp-manager` 互斥安装**（二选一）；配置文件
  `<DSH_HOME>/dsh-mcp.json` 双方共用，从旧插件迁移无需重新录入

## 仓库结构

```
packages/dsh-mcp-servers/   插件包（唯一包；宿主端 src/ + 浏览器端 src/client/）
shared/                     宿主与客户端共享模块（loopback 围栏 / sse-hub / host-utils）
scripts/build/              构建链（tsc + esbuild 内联 + 客户端契约外壳）
scripts/gate/               门禁（contract / pack-check / verify-npm-layout / lint / …）
scripts/data/               单一事实源（plugins-manifest / 变异拓扑 / gauntlet 阈值）
tools/lint/                 ESLint 复杂度门禁
test/                       跨包契约夹具
.dsh/skills/                项目级 skill（开发 / 评审 / 发版 / 升级规程）
```

## 开发

```sh
pnpm install
pnpm build           # 构建插件包（tsc + bundle-host + client）
pnpm test            # vitest：unit / integration / e2e
pnpm typecheck
pnpm gate:pr         # 提交前最小集（增量切片 + 静态闸）
pnpm gate:full       # 发版前全量口径
```

规则与门禁矩阵见 [AGENTS.md](AGENTS.md)，开发规范见
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)，贡献流程见
[CONTRIBUTING.md](CONTRIBUTING.md)。

## 版本适配（只适配 rc）

只适配 dsh rc、不承诺 alpha。适配基线唯一事实源是 `pnpm-workspace.yaml` 的
`catalog`（peer 与其锁步）；升级须跑全量门禁并核验会话结构。

## License

MIT

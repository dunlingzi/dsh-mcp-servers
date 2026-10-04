# dsh-mcp-servers 设计文档

> 本目录存放 `@dunlingzi/dsh-mcp-servers` 客户端 UI 的设计文档与样式规范，
> 是设置页「MCP 服务器」这一界面的**设计与实现对齐基线**。

## 事实源与快照

两份文档描述的是**同一个固定快照**，而不是「当前 checkout」：

| 项 | 值 |
|---|---|
| 分支 | `feat/settings-page-ux-a11y` |
| 提交 | `6a66f75` |
| 关键文件 | `packages/dsh-mcp-servers/src/client/style.css`（851 行） |

**本文档全部行号锚点以该提交为准。** 主 checkout 可能不在这个分支上——本目录的
产出过程中它就被并发切换过（从 `feat/settings-page-ux-a11y` 切到
`task/p0-peer-range-gate`），于是同一份文档在切换前后会读到两套完全不同的
`style.css`（851 行 vs 454 行）。因此**校对本文档时不要直接读工作区源码**，
先确认分支，或按下面的方法取只读副本：

```sh
git archive --format=zip -o feat.zip feat/settings-page-ux-a11y packages/dsh-mcp-servers/src shared/client docs
```

两份文档各自带「事实源与快照」节与形态差异附录，用于判断某条断言属于哪一份代码。

## 文档分工

| 文档 | 管什么 | 不管什么 |
|---|---|---|
| [ui-design.md](./ui-design.md) | 信息架构、页面与组件结构、交互流程、状态呈现、边界与异常态、可访问性与键盘、i18n 文案面 | token 与样式落地细则 |
| [style-spec.md](./style-spec.md) | token 层与配对纪律、命名与分层约定、刻度与尺度、组件样式规格、主题策略、响应式与触控、动效、禁止清单 | 交互流程与信息架构 |

## 维护约定

- 改动客户端 UI 后**必须同步回写本目录**：新增组件先落
  `packages/dsh-mcp-servers/src/client/style.css`，新增文案先落
  `packages/dsh-mcp-servers/src/client/locales.ts`，再更新对应文档；
- 文档里「建议」与「现状」是两种口径，不得混写——规范条款要么有代码锚点，
  要么明确标注为建议；
- 本目录的变更与仓库 README 变更同属文档一致性门禁面。

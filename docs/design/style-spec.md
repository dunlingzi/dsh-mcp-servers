# dsh-mcp-servers 前端样式规范

> 对象：`@dunlingzi/dsh-mcp-servers` 浏览器端客户端 —— DSH（DeepSeek Harness）设置页顶级
> section「MCP 服务器」（列表视图 + 编辑视图）。
> 事实源：`packages/dsh-mcp-servers/src/client/style.css`（feat 形态，851 行，逐条读完）
> 与 `src/client/page/*.tsx`、`src/client/core/constants.ts`、`src/client/locales.ts`。
> 交互流程与信息架构不在本文范围，见 [UI/UX 设计文档](./ui-design.md)。
>
> 本文是**规范文档，不是重构**：所有对现状的偏离都写作「建议」，**不代表代码已修改**。

## 目录

- [0. 事实源与快照](#fact-source)
- [1. Token 层与官方配对纪律](#tokens)
- [2. 命名与分层约定](#naming)
- [3. 刻度与尺度](#scale)
- [4. 组件规格表](#components)
- [5. 主题与响应式](#theme)
- [6. 动效](#motion)
- [7. 可访问性](#a11y)
- [8. 禁止清单](#forbidden)
- [9. 新增组件扩展规则与自查清单](#extend)
- [附录 A：事实源形态差异（main 与 feat）](#appendix-a)
- [附录 B：本文断言的核对方法](#appendix-b)

<a id="fact-source"></a>
## 0. 事实源与快照

### 0.1 本文描述的形态

| 项 | 值 |
|---|---|
| 分支 / 提交 | `feat/settings-page-ux-a11y @ 6a66f75` |
| 文件 | `packages/dsh-mcp-servers/src/client/style.css` |
| 行数 | **851** |
| 字节数 | **18649** |
| SHA256 | `D576470536A4C17482BCDC27077EE8771072607FBA03B0140A3575D0296C7718` |
| 行尾 | CRLF（851 个 CR + 851 个 LF） |

读取方式：该提交已由主控用 `git archive` **只读导出**到仓库外暂存目录
（仓库外暂存目录），本文全部行号、计数与哈希均取自该导出副本，
未读取仓库主 checkout 下的任何源码。

> **仓库主 checkout 可能不在该分支，行号锚点以该 SHA 为准。**
> 主 checkout 在本次会话进行中被切换到 `task/p0-peer-range-gate`；若磁盘上的
> `style.css` 行数 / 哈希与上表不符，说明形态已再次变化，**本文行号需按
> [附录 B](#appendix-b) 的方法重新核对**，不得直接沿用。

### 0.2 装配链（样式如何进入浏览器）

| 环节 | 事实 | 锚点 |
|---|---|---|
| 界面形态 | 设置页 `settings.section` 槽位，section id `mcp-servers`，order 18 | `src/client/index.ts` L71-L83 |
| 视图切换 | `view === null` 渲染列表，否则渲染编辑（新建与编辑共用编辑视图） | `src/client/page/McpServersPage.tsx` L224-L256 |
| 样式文件 | 独立 `src/client/style.css`（干净模块，样式不写进 TS） | `src/client/index.ts` L15 |
| 注入方式 | `ensureStyle({ id: "dsh-mcp-servers-style", cssText: STYLE })` | `src/client/index.ts` L59 |
| 注入实现 | 按 id 幂等、`document.head` 缺失静默 no-op、返回 disposer；`version` 变化时 remove 后重建 | `shared/client/ensure-style.js` L34-L63 |
| 构建期内联 | `.css` 经 build-client 的 text-loader **原样内联**成字符串打进 `lib/client.js`（无压缩、注释保留、无独立网络请求） | `docs/DEVELOPMENT.md` §3（L380-L381） |

一处与文档表述的差异（**建议**补齐）：`docs/DEVELOPMENT.md` §3（L377）给出的调用形态是
`ensureStyle({ id, cssText, version: CSS_VERSION })`，而当前调用**未传 `version`**
（`src/client/index.ts` L59），因此 `dataset.version` 驱动的「热更新重建 `<style>`」路径在本插件
未启用——重复 apply 时走「同 id 已存在且未传 version 则不动作」分支
（`shared/client/ensure-style.js` L51-L53）。**建议**补一个 `CSS_VERSION` 常量并透传，
否则样式热更新只能靠整页刷新。

### 0.3 术语

| 术语 | 本文含义 |
|---|---|
| 明暗双主题 | DSH 宿主注入的 light / dark 两套主题变量，客户端不自行切换 |
| 浅色回退 | `var(--dsw-alias-x, 浅色值)` 里 `,` 之后的内置值，仅用于宿主缺项时可读 |
| 官方 pairing | `style.css` 文件头注释（L6-L17）声明的 token 配对纪律，取自 `@deepseek-ai/dsh-client-ui-theme` |
| 焦点环 | 键盘聚焦时的可见指示，本仓库纪律用 `state-business-primary` |
| 触控目标 | 可点击 / 可操作元素的命中区尺寸 |
| 拉伸按钮 | stretched button，`inset: 0` 铺满父容器的 `<button>`，见 `.ms-card-hit` |
| 类名前缀 | 本插件统一 `ms-`（mcp-servers），见 `style.css` L4 |
| 分层注释 | `/* ---- N 名称 ---- */` 形式的段落分隔，本文件共 13 段 |

### 0.4 适用边界（不写什么）

- **不含**信息架构、交互流程、文案与状态机 —— 归 [UI/UX 设计文档](./ui-design.md)。
- **不含**宿主端 / 构建契约全文 —— 只保留「样式如何进入浏览器」的结论（§0.2）。
- **不含**浮窗（会话胶囊）形态 —— 该形态已退役：`docs/DEVELOPMENT.md` §7 的断点档位 /
  z-index 基准 / 视口 clamp / offsetY 避让等跨包约定以「带浮窗胶囊的插件」为前提
  （L621-L648），而本插件的 UI 形态是设置页 section（`src/client/index.ts` L71-L83）。
  新样式**不得**引入 `z-index` 基准、`data-*-bp` 断点属性、`offsetY` 避让等浮窗机制。
  其中 §7 第 5 条「触控目标分层 / 悬停态包 `@media(hover:hover)`」是 WCAG 口径而非浮窗专属，
  仍然适用（见 [§5.3](#theme)、[§7.2](#a11y)）。

<a id="tokens"></a>
## 1. Token 层与官方配对纪律

### 1.1 实际使用的 token 清单（穷举）

穷举口径：`style.css` 内 `var(--dsw-alias-*)` 共 **88 处引用**，去重后 **20 个变量名**。
另有 **5 个变量名**只出现在 TS 内联样式中（`src/client/core/constants.ts` L35-L40 的
`STATUS_ORDER.dot`），其中 3 个与 CSS 侧重合、2 个为本形态独有的新名字。

| # | 变量名 | 语义 | 用法示例（类 · 行号） | 回退值 | 明暗差异 |
|---|---|---|---|---|---|
| 1 | `--dsw-alias-label-primary` | 正文 / 标题主前景 | `.ms-page` L30、`.ms-ok-banner` L70、`.ms-chip-active` L104、`.ms-probe-ok` L434、`.ms-confirm` L682 | `#0f1115` | 回退值仅覆盖浅色；深色由宿主同名 token 覆盖（未实测，见 §7.3） |
| 2 | `--dsw-alias-label-secondary` | 次级前景（副标题、chip、分段按钮、组标题、卡片副行 / 图标、探活 pending、徽章、面包屑当前项、复选框、工具摘要） | `.ms-subtitle` L43、`.ms-chip` L92、`.ms-seg-btn` L146、`.ms-mode-label` L172、`.ms-group-title` L267、`.ms-card-glyph` L329、`.ms-card-sub` L350、`.ms-badge` L406、`.ms-probe-pending` L444、`.ms-breadcrumb-current` L536、`.ms-check` L719 | `#61666b` | 同上 |
| 3 | `--dsw-alias-label-tertiary` | 三级前景（提示、chip 计数、组计数、工具数、空态、字段提示、工具摘要 / 空态 / 名称禁用、面包屑分隔与禁用、**兼作开关关闭态轨道底**） | `.ms-hint` L47、`.ms-chip-count` L109、`.ms-group-count` L272、`.ms-card-tools` L369、`.ms-empty` L388、`.ms-field-hint` L630、`.ms-tools-summary` L740、`.ms-tools-empty` L745、`.ms-tool-name-off` L779、`.ms-breadcrumb-sep` L532、`.ms-breadcrumb-root:disabled` L527、`.ms-switch-slider` L472 | `#81858c` | 同上；L472 把「前景 token」当**底色**用，属语义挪用（见 [§8.2](#forbidden)） |
| 4 | `--dsw-alias-label-primary-foreground` | 主填充面上的前景字（明暗互为反色） | `.ms-seg-active` L163、`.ms-btn-primary` L229、`.ms-btn-danger-solid` L255、`.ms-mode-switch button.ms-mode-active` L570 | `#fff` | 回退值 `#fff` 只在浅色语义下成立；文件头注释（L11-L12）明确「写死 `#fff` 会在深色主题变成白底白字」 |
| 5 | `--dsw-alias-border-l1` | 最弱分隔线（列表内行间、面板顶部分隔） | `.ms-tools` L729、`.ms-tool-row + .ms-tool-row` L769 | `rgba(0, 0, 0, 0.04)` | 同上 |
| 6 | `--dsw-alias-border-l2` | 容器描边（卡片、空态、表单卡、分段控件、模式切换、工具列表、chip、幽灵按钮） | `.ms-chip` L89、`.ms-seg` L138、`.ms-seg-btn + .ms-seg-btn` L154、`.ms-btn-ghost` L237、`.ms-card` L288、`.ms-empty` L384、`.ms-mode-switch` L549、`.ms-form-card` L574、`.ms-tools-list` L756 | `rgba(0, 0, 0, 0.1)` | 同上 |
| 7 | `--dsw-alias-border-l4` | 控件描边（输入 / 选择框 / 搜索 / 文本域 / JSON）与**悬停强调描边** | `.ms-search` L180、`.ms-select` L190、`.ms-chip-active` L102、`.ms-card:hover` L294、`.ms-input/.ms-textarea` L609、`.ms-json` L644 | `rgba(0, 0, 0, 0.16)` | 同上 |
| 8 | `--dsw-alias-bg-layer-1` | 控件底色（与 `border-l4` 配对） | `.ms-search` L182、`.ms-select` L192、`.ms-input/.ms-textarea` L611、`.ms-json` L646 | `transparent` | 同上 |
| 9 | `--dsw-alias-interactive-bg-hover` | 悬停 / 弱填充底 | `.ms-chip:hover` L98、`.ms-seg-btn:hover` L158、`.ms-btn-ghost:hover` L241、`.ms-card-glyph` L328、`.ms-badge` L405、`.ms-probe-pending` L443、`.ms-mode-switch button:hover` L565 | `rgba(38, 49, 72, 0.06)` | 同上 |
| 10 | `--dsw-alias-interactive-bg-hover-accent` | 选中 / 强调底 | `.ms-chip-active` L103 | `rgba(38, 49, 72, 0.14)` | 同上 |
| 11 | `--dsw-alias-interactive-bg-hover-danger` | 危险语义淡底（错误横幅、危险按钮悬停、危险徽章、探活失败） | `.ms-error-banner` L64、`.ms-btn-danger:hover` L250、`.ms-badge-danger` L418、`.ms-probe-fail` L438 | `rgba(236, 19, 19, 0.08)`（3 处）/ `rgba(236, 19, 19, 0.06)`（L250） | 同上；同一 token 两套 alpha 属漂移（§1.4） |
| 12 | `--dsw-alias-button-primary-fill` | 主填充底（主按钮、分段激活、模式激活） | `.ms-seg-active` L162 / L168、`.ms-btn-primary` L228、`.ms-mode-switch button.ms-mode-active` L569 | `#0f1115` | 同上 |
| 13 | `--dsw-alias-button-primary-hover` | 主填充悬停底 | `.ms-btn-primary:hover:not(:disabled)` L233 | `#43454a` | 同上 |
| 14 | `--dsw-alias-link` | 链接式控件前景 | `.ms-breadcrumb-root` L520 | `#4176e6` | 同上 |
| 15 | `--dsw-alias-state-business-primary` | 业务 / 进行中语义色，**兼作焦点环与聚焦描边** | `.ms-search:focus` / `.ms-select:focus` L198、`.ms-card-hit:focus-visible` L311、`.ms-switch input:focus-visible + .ms-switch-slider` L498、`.ms-input:focus` 等 L626、`.ms-page :focus-visible` L786 | `#4176e6` | 同上 |
| 16 | `--dsw-alias-state-error-primary` | 错误语义色（横幅文字、危险按钮文字与描边、实心危险底、危险徽章文字、卡片错误行、探活失败文字） | `.ms-error-banner` L65、`.ms-btn-danger` L245-L246、`.ms-btn-danger-solid` L254、`.ms-card-error` L358、`.ms-badge-danger` L419、`.ms-probe-fail` L439 | `#ec1313` | 同上；当正文色用时对比度不足（[§8.2](#forbidden)） |
| 17 | `--dsw-alias-state-success-primary` | 成功语义色（开关开启态轨道；色点走 TS 内联） | `.ms-switch input:checked + .ms-switch-slider` L490 | `#22c55e` | 同上；文件头注释 L14-L15 明确其当正文色只有 ~2:1 |
| 18 | `--dsw-alias-state-success-tertiary` | 成功语义淡底 | `.ms-ok-banner` L69、`.ms-probe-ok` L433 | `#e6faed` | 同上 |
| 19 | `--dsw-alias-state-warn-secondary` | 警告语义描边（页内确认条边框） | `.ms-confirm` L680 | `#f7ad31` | 同上 |
| 20 | `--dsw-alias-state-warn-tertiary` | 警告语义淡底（页内确认条底） | `.ms-confirm` L681 | `#fef5e7` | 同上 |

**只在 TS 内联样式中出现的 3 个名字**（`src/client/core/constants.ts` L35-L40，
经 `statusDot()` 注入 `.ms-dot` 的 `background`，是当前客户端**唯一**的内联样式，
全仓 `style={{` 仅 1 处：`src/client/page/ListView.tsx` L108）：

| 变量名 | 语义 | 回退值（TS 侧） | 备注 |
|---|---|---|---|
| `--dsw-alias-state-business-primary` | `connecting` 色点 | `#2f7bf6` | 与 CSS 侧同名 token **回退值不同**（CSS 用 `#4176e6`），见 §1.4 |
| `--dsw-alias-state-warn-primary` | `reconnecting` 色点 | `#e08b1e` | 本形态 CSS 层未使用 |
| `--dsw-alias-state-error-primary` | `failed` 色点 | `#e0483e` | 与 CSS 侧同名 token 回退值不同（CSS 用 `#ec1313`） |
| `--dsw-alias-state-success-primary` | `connected` 色点 | `#0f9d6e` | 与 CSS 侧同名 token 回退值不同（CSS 用 `#22c55e`） |
| `--dsw-alias-label-tertiary` | `stopped` / `disabled` / 未知态色点 | `#9aa1ad` | 与 CSS 侧同名 token 回退值不同（CSS 用 `#81858c`） |

### 1.2 官方配对纪律（展开为可执行条款）

`style.css` 文件头注释 L6-L17 声明了取自 `@deepseek-ai/dsh-client-ui-theme` 的官方 pairing。
以下逐条**展开为规范条款并给出核实结论**——文件头注释只是声明，本列是逐条核对 CSS 实际用法的结果。

| # | 条款（文件头声明） | 核实结论 | 代码锚点 |
|---|---|---|---|
| T1 | 输入 / 选择框 = `border-l4` 边框 + `bg-layer-1` 底（对照官方 `._wrap_1g6ru_1`） | **成立**，5 个控件一致 | `.ms-search` L180/L182、`.ms-select` L190/L192、`.ms-input/.ms-textarea` L609/L611、`.ms-json` L644/L646 |
| T2 | 卡片 / 容器 = `border-l2` 边框 | **成立**，6 处容器一致 | `.ms-card` L288、`.ms-empty` L384（`dashed`）、`.ms-form-card` L574、`.ms-tools-list` L756、`.ms-seg` L138、`.ms-mode-switch` L549 |
| T3 | 列表内分隔线 = 更弱的 `border-l1` | **成立**，2 处一致 | `.ms-tools` L729（`border-top`）、`.ms-tool-row + .ms-tool-row` L769（`border-top`） |
| T4 | 悬停底 = `interactive-bg-hover` | **成立**，7 处一致，回退值统一 `rgba(38, 49, 72, 0.06)` | `.ms-chip:hover` L98、`.ms-seg-btn:hover` L158、`.ms-btn-ghost:hover` L241、`.ms-card-glyph` L328、`.ms-badge` L405、`.ms-probe-pending` L443、`.ms-mode-switch button:hover` L565 |
| T5 | 选中 / 强调底 = `interactive-bg-hover-accent` | **成立**，1 处 | `.ms-chip-active` L103（回退 `rgba(38, 49, 72, 0.14)`） |
| T6 | 主按钮 = `button-primary-fill` 底 + `label-primary-foreground` 字 | **成立**，3 个主填充面全部走 token、无硬编码白字 | `.ms-btn-primary` L228/L229、`.ms-seg-active` L162/L163、`.ms-mode-switch button.ms-mode-active` L569/L570 |
| T7 | 状态色只用 `state-*-primary`（色点 / 语义）与 `state-*-tertiary`（淡底） | **部分成立**：淡底侧 `state-success-tertiary`（L69/L433）与 `state-warn-tertiary`（L681）合规；**但危险淡底三处走 `interactive-bg-hover-danger` 而非 `state-error-tertiary`**（L64/L418/L438），且 `.ms-confirm` 描边用 `state-warn-secondary` 而非 `state-*-primary` | 见 [§8.2](#forbidden) |
| T8 | 状态色文字用 `label-primary` / `label-secondary` 保证对比度 | **部分成立**：`.ms-ok-banner` L70 与 `.ms-probe-ok` L434 用 `label-primary`（合规）；**`.ms-error-banner` L65、`.ms-probe-fail` L439、`.ms-badge-danger` L419 仍用 `state-error-primary` 当正文色** | 见 [§8.2](#forbidden) |
| T9 | 焦点环 = `state-business-primary` | **成立**，5 处一致，回退值统一 `#4176e6` | `.ms-page :focus-visible` L786、`.ms-card-hit:focus-visible` L311、`.ms-switch input:focus-visible + .ms-switch-slider` L498、`.ms-search:focus` / `.ms-select:focus` L198、`.ms-input:focus` 等 L626 |
| T10 | 链接 = `link` | **成立**，1 处 | `.ms-breadcrumb-root` L520（回退 `#4176e6`） |
| T11 | 「变量仍带浅色回退，防止主题缺项时整块不可读」 | **成立**：全文 88 处 `var()` 全部带回退，无一处裸 `var(--dsw-alias-x)` | 全文件 |

### 1.3 结构性 / 状态性分层（本形态实际口径）

| 分层 | token | 用途 | 纪律 |
|---|---|---|---|
| 结构性 · 前景 | `label-primary` / `label-secondary` / `label-tertiary` | 正文 / 次级 / 三级文字 | **不得**当底色用（`.ms-switch-slider` L472 是唯一反例，见 §8.2） |
| 结构性 · 填充面 | `label-primary-foreground` | 主填充面上的字 | 与 `button-primary-fill` 成对；**禁止**用字面量 `#fff` 替代 |
| 结构性 · 描边 | `border-l1` / `border-l2` / `border-l4` | 分隔线 / 容器 / 控件 | 三级强度，按 §1.2 T1-T3 配对 |
| 结构性 · 底 | `bg-layer-1` | 控件底 | 与 `border-l4` 成对 |
| 结构性 · 交互底 | `interactive-bg-hover` / `interactive-bg-hover-accent` / `interactive-bg-hover-danger` | 悬停 / 选中 / 危险悬停 | 不与状态语义混用（危险淡底应走 `state-error-tertiary`，见 §8.2） |
| 结构性 · 主填充 | `button-primary-fill` / `button-primary-hover` | 主按钮底与其悬停 | 悬停只用 `button-primary-hover`，不用 `filter` |
| 结构性 · 链接 | `link` | 链接式控件前景 | 与 `state-business-primary` 区分：前者是文本语义，后者是焦点 / 状态语义（两者回退值同为 `#4176e6`，但**不是**同一 token） |
| 状态性 | `state-*-primary` | 色点、描边、图标等语义点缀 | **只做点缀**，不做正文色 |
| 状态性 | `state-*-tertiary` / `state-*-secondary` | 语义淡底 / 语义描边 | 淡底配 `label-primary` 文字 |
| 状态性 | `state-business-primary` | 焦点环、聚焦描边、`connecting` 色点 | 官方 focus 用色 |

### 1.4 回退值纪律与现状漂移

纪律（沿用 `docs/DEVELOPMENT.md` §6 第 3 条，L612-L614）：颜色统一走
`var(--dsw-alias-*, 浅色回退)`，明暗自适应；**不得**在 CSS / TS 里写死 `#fff` / `rgb(...)` 固定色。
回退值只服务「宿主未注入该 token」的可读性兜底。

现状漂移清单（同一语义出现多种取值，**建议**收敛为单一回退表）：

| 语义 | 取值 A | 取值 B | 位置 |
|---|---|---|---|
| `interactive-bg-hover-danger` alpha | `0.08`（3 处：L64、L418、L438） | `0.06`（1 处：L250） | 危险淡底 / 危险按钮悬停 |
| `state-error-primary` 回退 | CSS `#ec1313`（L65、L245、L246、L254、L358、L419、L439） | TS `#e0483e`（`constants.ts` L40） | 横幅文字 / `failed` 色点 |
| `state-success-primary` 回退 | CSS `#22c55e`（L490） | TS `#0f9d6e`（`constants.ts` L35） | 开关开启轨道 / `connected` 色点 |
| `state-business-primary` 回退 | CSS `#4176e6`（L198、L311、L498、L626、L786） | TS `#2f7bf6`（`constants.ts` L36） | 焦点环 / `connecting` 色点 |
| `label-tertiary` 回退 | CSS `#81858c`（12 处） | TS `#9aa1ad`（`constants.ts` L38-L39、L56） | 三级文字 / 灰态色点 |

**建议**：以 CSS 侧的一套回退值为准（`#ec1313` / `#22c55e` / `#4176e6` / `#81858c`），
把 `constants.ts` 的色点回退同步过来，或在 `style.css` 头部维护一张「回退值表」作为单一事实源。

<a id="naming"></a>
## 2. 命名与分层约定

### 2.1 前缀纪律

- 所有类名 `ms-` 前缀（`style.css` L4 明示「类名统一 ms- 前缀（mcp-servers）」）。实测：
  `style.css` 共 **122 个规则块**（含 2 个 `@media` 内部规则），选择器**全部**以 `.ms-` 开头；
  无 ID 选择器、无裸元素选择器、无 `!important`（0 命中）。
- 含组合符（后代 / 相邻兄弟）的选择器共 **13 处**，均为「组件内部结构」而非全局泄漏：
  `.ms-chip-active .ms-chip-count` L113、`.ms-seg-btn + .ms-seg-btn` L153、
  `.ms-badge .ms-dot` L410、`.ms-switch input` L458、
  `.ms-switch input:checked + .ms-switch-slider` L489、
  `.ms-switch input:checked + .ms-switch-slider::before` L493、
  `.ms-switch input:focus-visible + .ms-switch-slider` L497、
  `.ms-mode-switch button` L554、`.ms-mode-switch button:hover` L564、
  `.ms-mode-switch button.ms-mode-active` L568、
  `.ms-field-row .ms-field` L592、`.ms-tool-row + .ms-tool-row` L768、
  `.ms-field-row .ms-field`（窄屏块内）L844。
- 唯一「带前缀的全局后代选择器」是 `.ms-page :focus-visible`（L785）——它把焦点环
  一次性覆盖到页内所有可聚焦元素，属**有意设计**（见 [§7.1](#a11y)），不是泄漏：
  作用域被 `.ms-page` 限定，出不了本插件页面。
- TSX 侧 `className` 与 CSS 类名对应关系见 §4；两处例外登记在 §2.4。

### 2.2 修饰符后缀语义（现状）

| 后缀 | 语义 | 实例 |
|---|---|---|
| `-primary` | 主操作 / 主语义 | `.ms-btn-primary` L227 |
| `-ghost` | 次级 / 描边操作 | `.ms-btn-ghost` L236 |
| `-danger` | 破坏性操作（描边变体） | `.ms-btn-danger` L244 |
| `-danger-solid` | 破坏性操作（实心变体） | `.ms-btn-danger-solid` L253 |
| `-solid` | 实心填充变体 | 同上 |
| `-icon` | 图标按钮（收窄内边距） | `.ms-btn-icon` L223 |
| `-active` | 选中态 | `.ms-chip-active` L101、`.ms-seg-active` L161 |
| `-busy` | 进行中（禁用交互） | `.ms-switch-busy` L502 |
| `-ok` / `-fail` / `-pending` | 结果三态 | `.ms-probe-ok` L432 / `.ms-probe-fail` L437 / `.ms-probe-pending` L442 |
| `-off` | 已关闭（名称划掉） | `.ms-tool-name-off` L778 |
| `-count` | 计数 | `.ms-chip-count` L108、`.ms-group-count` L271 |
| `-summary` / `-empty` / `-head` | 面板内的从属块 | `.ms-tools-summary` L739、`.ms-tools-empty` L744、`.ms-tools-head` L732 |
| `-left` / `-right` | 容器左右分区 | `.ms-toolbar-left` / `.ms-toolbar-right` L128-L129、`.ms-form-footer-right` L662 |
| `-hit` | 拉伸命中区 | `.ms-card-hit` L299 |

**遗留命名破口（两处，**建议**收敛）**：

1. `.ms-mode-active`（L568）**脱离 `.ms-mode-switch` 家族**——它的兄弟是
   `.ms-seg-active`（L161），两者语义完全相同（都是分段控件选中态）却用了两套命名。
   **建议**统一为 `<块>-active`（`.ms-mode-switch-active` 或 `.ms-seg-active`），
   并把 `.ms-mode-switch` / `.ms-seg` 合并为一个分段控件族（见 §4.7 备注）。
2. `.ms-tool-name-off`（L778）是 `.ms-tool-name` 的**同级追加类**而非后代，
   语义上是「关闭态」而非「某个 off 元素」。**建议**改为 `.ms-tool-name-disabled` 或
   改用 `[data-off]` 属性选择器，与 `-busy` / `-active` 的状态后缀体例对齐。

### 2.3 分层注释（本形态 13 段）

`style.css` 文件头注释 L19-L21 声明 13 层，实测**全部落地**，注释与实现一致：

| 段 | 名称 | 注释行 | 覆盖的规则区间 |
|---|---|---|---|
| 1 | 骨架 | L24 | L26-L50 |
| 2 | 横幅 | L52 | L54-L71 |
| 3 | 筛选条 | L73 | L75-L115 |
| 4 | 工具行 | L117 | L119-L199 |
| 5 | 按钮 | L201 | L203-L260 |
| 6 | 分组与卡片 | L262 | L264-L390 |
| 7 | 徽章与探活 | L392 | L394-L445 |
| 8 | 开关 | L447 | L449-L505 |
| 9 | 编辑页 | L507 | L509-L697 |
| 10 | 导入面板 | L699 | L701-L722 |
| 11 | 工具面板 | L724 | L726-L781 |
| 12 | 可访问性 | L783 | L785-L795 |
| 13 | 响应式 | L797 | L799-L851 |

### 2.4 无规则类与未接线项

| 现象 | 证据 | 影响与建议 |
|---|---|---|
| `.ms-group` / `.ms-groups` 只有 DOM、无 CSS 规则 | `ListView.tsx` L318、L488；`style.css` 无对应选择器 | 分组容器纯语义，间距全部来自 `.ms-group-title`（L266）与 `.ms-cards`（L280）。**建议**补一条显式注释或去掉类名，避免读者误以为有样式 |
| `.ms-dot` 无独立规则 | `style.css` 只有 `.ms-badge .ms-dot`（L410，7x7） | 色点尺寸完全由徽章上下文决定；**建议**若将来要在徽章外使用色点，必须先补 `.ms-dot` 基础规则，否则会渲染成 0 尺寸 inline 元素 |
| `.ms-badge-success` / `-info` / `-warn` / `-neutral` 无 CSS 规则 | 类名由模板拼出（`ListView.tsx` L107 `ms-badge-${statusTone(...)}`），tone 取值见 `constants.ts` L31；CSS 只有 `.ms-badge-danger`（L417） | **现状即有意**：四档 tone 回落基础 `.ms-badge` 的中性样式，只有 `danger` 需要差异。**建议**在 §4.12 的徽章规格里显式登记这条「只实现 danger」的约定，避免后人误以为是漏写 |
| `.ms-seg` 与 `.ms-mode-switch` 两套分段控件 | `.ms-seg` L136-L169（列表工具行）+ `.ms-mode-switch` L547-L571（编辑页头部） | 两者视觉与行为同构、命名不同。**建议**合并为一族（保留 `role="group"` + `aria-pressed` 语义，两侧都已具备） |
| 非 ASCII 字符出现在 4 处 | `style.css` L361-L363 的 `-webkit-line-clamp`（CSS 属性名本身，非文本）；TSX 侧面包屑分隔符 `U+203A`（`EditView.tsx` L348） | 图标已全部改为内联 SVG（`ListView.tsx` L60-L102 的 4 个 glyph，均带 `aria-hidden="true"` + `focusable="false"`），**不再有文本字符当图标**。分隔符 `U+203A` 是排版字符而非图标，保留合理 |

<a id="scale"></a>
## 3. 刻度与尺度

### 3.1 字号台阶

| 字号 | 用途 | 锚点 | 定性 |
|---|---|---|---|
| 22px | 页面标题 `.ms-title` | L36 | 既定（唯一标题级） |
| 14px | 页面基准 `.ms-page`（body 基准，`line-height: 1.5`） | L31-L32 | 既定（基准） |
| 13px | 横幅、chip、chip 计数（继承）、分段按钮、模式标签、按钮、组标题、面包屑、模式切换按钮、标签、输入 / 文本域、确认条、复选框、工具空态 | L59、L93、L148、L173、L212、L268、L514、L523、L560、L599、L613、L683、L718、L746 | 既定（控件级） |
| 12.5px | 等宽场景：JSON 文本域、工具名 | L649、L774 | 既定（等宽级） |
| 12px | 提示、chip 计数、卡片副行 / 工具数 / 错误行、徽章、探活条、字段提示、工具摘要 | L48、L110、L351、L359、L370、L403、L425、L631、L741 | 既定（辅助级） |

**规则**：新增组件只取 **12 / 12.5 / 13 / 14 / 22** 五档；12.5px **仅限等宽字族**
（`.ms-json`、`.ms-tool-name`）使用，普通文本不得引入 12.5px。
需要区分层级时优先改字重（600）或字色，而不是加 0.5px 字号。

### 3.2 圆角台阶

| 圆角 | 用途 | 锚点 |
|---|---|---|
| 6px | 探活结果条 | L428 |
| 8px | 横幅、chip 之外的控件与容器：分段控件、模式切换、搜索、下拉、按钮、卡片图标、空态之外的列表、输入 / 文本域 / JSON、表单卡之外的确认条、工具列表 | L56、L139、L181、L191、L209、L327、L550、L610、L645、L679、L757 |
| 10px | 卡片、卡片拉伸按钮、空态 | L289、L305、L385 |
| 12px | 徽章（pill 的近圆）、表单卡 | L402、L575 |
| 999px | 开关轨道、chip（胶囊） | L471、L90 |
| 50% | 开关滑块、徽章内色点 | L484、L413 |

**规则**：新增组件从 **6 / 8 / 10 / 12 / 999** 取值。
`.ms-card-hit` 的圆角必须与 `.ms-card` 保持同值（现为 10px，L289 与 L305）——
两者不同值会在卡片四角露出错位的焦点环 / 命中区边界。**建议**把这条约束写成注释放在 `.ms-card-hit` 旁。

### 3.3 间距与 gap

| 项 | 取值 | 锚点 |
|---|---|---|
| 页面 | `max-width: 920px`、居中、`padding: 8px 0 48px`（无左右内边距，窄屏降为 `32px` 底距） | L27-L29、L801 |
| 纵向节奏 | 标题下 6px、副标题下 14px、提示 6/8px、横幅下 12px、筛选条 4/10px、工具行 10/2px、组标题 16/8px、卡片组间 8px、表单卡上 12px、表单底栏上 20px、确认条上 16px、工具面板上 20px + 内 16px | L38、L42、L49、L58、L80、L125、L266、L280、L577、L658、L677、L727-L728 |
| 横向 gap | 工具行 10px、工具行内 8px、筛选条 8px、chip 内 6px、分段按钮内 0、卡片 12px、卡片头部 8px、卡片操作区 10px、面包屑 8px、编辑头 12px、字段行 16px、表单 14px、表单底栏 12px、底栏右组 8px、确认条 12px、确认条动作 8px、工具行 12px、工具头部 8px、复选框 6px | L78、L123、L132、L86、L287、L341、L379、L512、L543、L588、L583、L657、L665、L675、L695、L764、L735、L717 |
| 控件内边距 | chip `4px 12px`、分段按钮 `6px 12px`、搜索 `6px 10px`、下拉 `6px 8px`、按钮 `6px 12px`、图标按钮 `6px 9px`、模式按钮 `6px 14px`、横幅 `8px 12px`、卡片 `12px 14px`、空态 `32px`、表单卡 `20px`（窄屏 `14px`）、输入 / 文本域 `8px 10px`、JSON `12px`、确认条 `10px 12px`、工具行 `6px 12px`、工具空态 `10px 0`、徽章 `1px 8px 1px 6px`、探活条 `6px 10px` | L88、L147、L179、L189、L211、L224、L558、L57、L290、L386、L576、L849、L608、L643、L678、L765、L747、L401、L427 |

### 3.4 最小高度（触控目标）

| 类 | `min-height` | 锚点 |
|---|---|---|
| `.ms-chip` | 30px | L87 |
| `.ms-seg-btn` / `.ms-search` / `.ms-select` / `.ms-btn` / `.ms-mode-switch button` / `.ms-check` | 32px | L150、L178、L188、L210、L561、L721 |
| `.ms-btn` / `.ms-chip` / `.ms-seg-btn`（**窄屏 <720px**） | 36px | L820-L824 |
| 其余（`.ms-input` / `.ms-textarea` / `.ms-json` / `.ms-card` / `.ms-card-hit` / `.ms-breadcrumb-root` / `.ms-tool-row` / `.ms-switch`） | **无 `min-height`** | — |

### 3.5 卡片内边距与容器宽度

| 项 | 取值 | 锚点 |
|---|---|---|
| 卡片内边距 | `12px 14px` | L290 |
| 卡片图标 | 36x36（窄屏 32x32），圆角 8px | L325-L327、L830-L833 |
| 卡片拉伸按钮内边距 | `0`（`inset: 0` 铺满） | L301、L306 |
| 容器最大宽度 | 全页只有一层居中容器 `.ms-page`，`max-width: 920px`；导入作用域块 `max-width: 520px`；工具列表 `max-height: 320px` | L27、L711、L754 |
| 固定最小 / 最大宽度 | 搜索框 `min-width: 200px`（窄屏 `0` + `flex: 1`）；字段行内字段 `min-width: 220px`（窄屏 `0`）；确认条文本 `flex: 1 1 260px` + `min-width: 0` | L177、L816-L817、L594、L845、L687-L688 |

### 3.6 新增组件的选用规则

| 维度 | 选用 | 说明 |
|---|---|---|
| 字号 | 12 / 12.5（仅等宽）/ 13 / 14 / 22 | 与 §3.1 一致 |
| 圆角 | 6（贴条）/ 8（控件与容器）/ 10（卡片）/ 12（大容器与 pill 近圆）/ 999（胶囊） | 与 §3.2 一致 |
| 间距 / gap | 优先 2 / 4 / 6 / 8 / 10 / 12 / 14 / 16 / 20；新增值先登记进 §3.3 | 8 与 12 是主力档 |
| 最小高度 | 常态 ≥32px（与按钮 / 控件齐平）；窄屏主操作 36px；**任何可点元素不得低于 24px** | 与 §5.3 一致 |
| 容器宽度 | 不超过 `.ms-page` 的 920px | 全页只有一层居中容器 |
| 卡片内边距 | 与 `.ms-card` 同值（`12px 14px`） | 保证卡片族纵向对齐 |

<a id="components"></a>
## 4. 组件规格表

行号锚点：`CSS` = `src/client/style.css`（feat 形态），`LV` = `src/client/page/ListView.tsx`，
`EV` = `src/client/page/EditView.tsx`，`K` = `src/client/core/constants.ts`。

### 4.1 页面骨架：`.ms-page` / `.ms-title` / `.ms-subtitle` / `.ms-hint`

```html
<div class="ms-page">
  <h1 class="ms-title">MCP 服务器</h1>
  <p class="ms-subtitle">管理 DeepSeek Harness 的 MCP 服务器：…</p>
  <div class="ms-hint">project：项目级服务器收敛为 ws_mcp_* 四个原子工具；…</div>
</div>
```

| 项 | 规格 |
|---|---|
| DOM | `.ms-page` 是两视图共用根（`LV` L349、`EV` L343） |
| 尺寸 | 容器 `max-width: 920px`、`margin: 0 auto`、`padding: 8px 0 48px`、字号 14px、行高 1.5（`CSS` L26-L33）；标题 22px / 700 / 下距 6px（L35-L39）；副标题下距 14px（L41-L44）；提示 12px / 上下距 6px 8px（L46-L50） |
| 颜色 | 正文 `label-primary`（L30）；副标题 `label-secondary`（L43）；提示 `label-tertiary`（L47） |
| 状态 | 无状态变体；窄屏仅底距由 48px 降为 32px（L801） |
| 可访问性 | `h1` 为唯一一级标题（`LV` L350、`EV` L353）；提示为纯文本块；`.ms-hint` 的 12px + `label-tertiary` 在浅色回退下 3.71:1（§7.3） |

### 4.2 横幅：`.ms-error-banner` / `.ms-ok-banner`

```html
<div class="ms-error-banner" role="alert">{error}</div>
<div class="ms-ok-banner" role="status">{notice}</div>
```

| 项 | 规格 |
|---|---|
| DOM | 纯文本块，无子元素 |
| 尺寸 | 共用：`border-radius: 8px`、`padding: 8px 12px`、`margin: 0 0 12px`、13px、`word-break: break-word`（`CSS` L54-L61） |
| 颜色 | 错误：底 `interactive-bg-hover-danger`（回退 `rgba(236,19,19,0.08)`）+ 字 `state-error-primary`（L63-L66）；成功：底 `state-success-tertiary` + 字 `label-primary`（L68-L71） |
| 状态 | 二选一，出现条件：`error !== ""` / `actionError !== ""`（`LV` L376-L377）、`notice !== ""`（`LV` L378）、`errorText !== ""`（`EV` L361） |
| 可访问性 | 错误横幅已带 `role="alert"`（3 处：`LV` L376、L377、`EV` L361），成功横幅带 `role="status"`（`LV` L378）——**播报语义已齐备**。**建议**错误横幅文字改 `label-primary`（现为 `state-error-primary`，浅色回退下 3.94:1，见 §7.3），语义由淡底 + 左侧色点承担 |

### 4.3 筛选条：`.ms-filters` / `.ms-chip` / `.ms-chip-active` / `.ms-chip-count`

```html
<div class="ms-filters" role="group" aria-label="按状态筛选">
  <button type="button" class="ms-chip ms-chip-active" aria-pressed="true">
    全部 <span class="ms-chip-count">12</span>
  </button>
  <button type="button" class="ms-chip" aria-pressed="false">运行中 <span class="ms-chip-count">3</span></button>
</div>
```

| 项 | 规格 |
|---|---|
| DOM | `flex` + `align-items: center` + `gap: 8px` + `flex-wrap: wrap` + `margin: 4px 0 10px`（`CSS` L75-L81）；chip 为 `inline-flex` + `gap: 6px`（L83-L95） |
| 尺寸 | chip `min-height: 30px`、`padding: 4px 12px`、`border-radius: 999px`、13px（L87-L93）；窄屏 `min-height: 36px`（L821-L823） |
| 颜色 | 默认：`border-l2` 描边 + 透明底 + `label-secondary` 字（L89-L92）；计数 `label-tertiary` + `tabular-nums`（L108-L110） |
| 状态 | `.ms-chip:hover` 底 `interactive-bg-hover`（L97-L99）；`.ms-chip-active` 描边 `border-l4` + 底 `interactive-bg-hover-accent` + 字 `label-primary` + 600（L101-L106）；激活态计数 `color: inherit`（L113-L115） |
| 触发 | 由 `statusFilter` state 驱动（`LV` L356、L366），点已激活的 chip 会切回 `all`（`LV` L368） |
| 可访问性 | 容器 `role="group"` + `aria-label`（`LV` L353）；每个 chip 原生 `<button>` + `aria-pressed`（`LV` L357、L367）——选中态有语义，不只靠颜色。**建议** `:hover` 包 `@media (hover: hover)`（§5.3） |

### 4.4 工具行：`.ms-toolbar` / `.ms-toolbar-left` / `.ms-toolbar-right` / `.ms-mode-label`

```html
<div class="ms-toolbar">
  <div class="ms-toolbar-left"><div class="ms-seg">…</div><input class="ms-search" type="search" /></div>
  <div class="ms-toolbar-right">
    <label class="ms-mode-label" htmlFor="ms-middleware">中间层模式</label>
    <select id="ms-middleware" class="ms-select">…</select>
    <button class="ms-btn ms-btn-ghost ms-btn-icon" aria-label="刷新">…</button>
    <button class="ms-btn ms-btn-ghost">导入</button>
    <button class="ms-btn ms-btn-primary">新建</button>
  </div>
</div>
```

| 项 | 规格 |
|---|---|
| DOM | 外层 `flex` + `space-between` + `gap: 10px` + `flex-wrap: wrap` + `margin: 10px 0 2px`（`CSS` L119-L126）；左右组 `flex` + `gap: 8px` + wrap（L128-L134） |
| 尺寸 | 无固定高度；窄屏左右组各占整行、`justify-content: flex-start`（L804-L813） |
| 颜色 | `.ms-mode-label` 用 `label-secondary` + 13px（L171-L174）；容器本身无颜色 |
| 状态 | 无状态类；换行由 `flex-wrap` 与 720px 断点共同处理 |
| 可访问性 | 中间层下拉的 `<label>` 带 `htmlFor="ms-middleware"` 且 select 带同值 `id`（`LV` L405-L408）——**标签关联已做对**，可作为其余字段的范式 |

### 4.5 搜索框：`.ms-search`

| 项 | 规格 |
|---|---|
| DOM | `<input type="search">`（`LV` L395-L402） |
| 尺寸 | `min-width: 200px`、`min-height: 32px`、`padding: 6px 10px`、`border-radius: 8px`（`CSS` L177-L181）；**未声明 `box-sizing`**（与 `.ms-input` 不一致，**建议**统一为 `border-box`） |
| 颜色 | 描边 `border-l4` + 底 `bg-layer-1`（回退 `transparent`）+ 字 `inherit`（L180-L183） |
| 状态 | `:focus` → 描边改 `state-business-primary`（L196-L199）；`outline: none`（L184）；**无 `:disabled` 规则** |
| 触发 | 受控输入，`placeholder` 与 `aria-label` 同为 `searchPlaceholder`（`LV` L398-L399） |
| 可访问性 | `type="search"` + `aria-label`（`LV` L399）——**可读名已具备**；键盘聚焦时由 `.ms-page :focus-visible`（L785）补 2px 焦点环，叠加自身 1px 描边变色 |

### 4.6 下拉：`.ms-select`

| 项 | 规格 |
|---|---|
| DOM | 原生 `<select>`，5 处使用（`LV` L406、L457；`EV` L373、L383） |
| 尺寸 | `min-height: 32px`、`padding: 6px 8px`、`border-radius: 8px`（`CSS` L187-L191） |
| 颜色 | 描边 `border-l4` + 底 `bg-layer-1` + 字 `inherit`（L190-L193） |
| 状态 | `:focus` → 描边 `state-business-primary`（L196-L199）；`:disabled` → `opacity: 0.6`（L617-L620，与 `.ms-input` 共用规则） |
| 触发 | 中间层模式（`LV` L406-L415）、导入作用域（`LV` L457-L465）、编辑页作用域（`EV` L373-L376，编辑态 `disabled`）、类型（`EV` L383-L386） |
| 可访问性 | 编辑页两处与导入页一处均带 `htmlFor` + `id` 配对（`EV` L372-L373、L382-L383；`LV` L456-L458）；**导入页的项目级选项在无活动项目会话时 `disabled`**（`LV` L464），属正确做法 |

### 4.7 分段控件族：`.ms-seg` / `.ms-seg-btn` / `.ms-seg-active` 与 `.ms-mode-switch` / `.ms-mode-active`

```html
<div class="ms-seg" role="group" aria-label="作用域">
  <button type="button" class="ms-seg-btn ms-seg-active" aria-pressed="true">全部</button>
  <button type="button" class="ms-seg-btn" aria-pressed="false">用户</button>
</div>
<div class="ms-mode-switch" role="group" aria-label="类型">
  <button type="button" class="ms-mode-active" aria-pressed="true">表单</button>
  <button type="button" aria-pressed="false">JSON</button>
</div>
```

| 项 | 规格 |
|---|---|
| DOM | 两者同为 `inline-flex` + 1px 描边 + `border-radius: 8px` + `overflow: hidden`（`CSS` L136-L141、L547-L552）；子按钮 `border: none` + 透明底 |
| 尺寸 | `.ms-seg-btn` `padding: 6px 12px` + `min-height: 32px`（L147-L150）；`.ms-mode-switch button` `padding: 6px 14px` + `min-height: 32px`（L558-L561）；窄屏前者 36px（L822-L823），后者**未纳入窄屏放大** |
| 颜色 | 容器描边 `border-l2`；默认字 `.ms-seg-btn` 用 `label-secondary`（L146）、`.ms-mode-switch button` 用 `inherit`（L557）——**两族默认字色不一致**；激活态两者同为 `button-primary-fill` 底 + `label-primary-foreground` 字（L162-L163、L569-L570） |
| 状态 | `:hover` 底 `interactive-bg-hover`（L157-L159、L564-L566）；`.ms-seg-active:hover` 显式保持主填充底、**不回退到悬停灰**（L167-L169）——`.ms-mode-switch button.ms-mode-active:hover` **没有这条覆盖**，因选择器特异性（`button:hover` 0,2,1 vs `button.ms-mode-active` 0,2,1，后者在后）实际仍由激活态胜出，但属**依赖源码顺序**的脆弱实现。**建议**为模式切换补一条显式 `:hover` 覆盖，与 `.ms-seg-active:hover` 对称 |
| 分隔线 | `.ms-seg-btn + .ms-seg-btn` 有 1px 左分隔线（L153-L155）；`.ms-mode-switch button` **没有**，靠 `overflow: hidden` 与描边区分——**建议**补齐以对齐两族视觉 |
| 可访问性 | 两者都是原生 `<button type="button">` + `aria-pressed`（`LV` L388、`EV` L357-L358）+ 容器 `role="group"` + `aria-label`（`LV` L382、`EV` L356）——**选中态语义已具备** |

### 4.8 按钮族：`.ms-btn` + `-primary` / `-ghost` / `-danger` / `-danger-solid` / `-icon`

```html
<button type="button" class="ms-btn ms-btn-ghost">测试</button>
<button type="button" class="ms-btn ms-btn-primary">保存</button>
<button type="button" class="ms-btn ms-btn-danger">删除</button>
<button type="button" class="ms-btn ms-btn-danger-solid">确认删除</button>
<button type="button" class="ms-btn ms-btn-ghost ms-btn-icon" aria-label="刷新">（SVG）</button>
```

| 项 | 规格 |
|---|---|
| DOM | `inline-flex` + `align-items: center` + `justify-content: center` + `gap: 6px`（`CSS` L203-L216）；图标按钮内含内联 SVG（`LV` L423、L431、L434） |
| 尺寸 | 基类 `border: 1px solid transparent` + `border-radius: 8px` + `min-height: 32px` + `padding: 6px 12px` + 13px（L207-L212）；`.ms-btn-icon` `padding: 6px 9px`（L223-L225）；窄屏 `min-height: 36px`（L820-L823） |
| 颜色 | 基类 `color: inherit` + `background: transparent`（L214-L215）；主按钮 `button-primary-fill` 底 + `label-primary-foreground` 字（L227-L230）；幽灵 `border-l2` 描边（L236-L238）；危险 `state-error-primary` 字与描边（L244-L247）；实心危险 `state-error-primary` 底 + `label-primary-foreground` 字（L253-L256） |
| 状态 | `:disabled` → `opacity: 0.55` + `cursor: not-allowed`（L218-L221）；主按钮悬停 `button-primary-hover`（L232-L234）；幽灵悬停 `interactive-bg-hover`（L240-L242）；危险悬停 `interactive-bg-hover-danger`（L249-L251）；实心危险悬停 `filter: brightness(1.06)`（L258-L260） |
| 触发 | 幽灵：测试（`LV` L189-L197、`EV` L485）、导入开关（`LV` L425-L432）、取消（`LV` L476、`EV` L487）、确认条取消（`EV` L466）；主：新建（`LV` L433-L435）、导入执行（`LV` L479-L481）、保存（`EV` L488-L490）；危险：删除入口（`EV` L481）；实心危险：确认删除 / 放弃改动（`EV` L469-L475） |
| 可访问性 | 全部原生 `<button type="button">`，键盘可达；`disabled` 为原生属性（`EV` L481、L485-L490；`LV` L192、L476、L479）；焦点环由 `.ms-page :focus-visible` 统一提供（L785）。**建议**：①实心危险的悬停改走专用 token（如 `state-error-secondary` 或 `button-danger-hover`）而不是 `filter: brightness()`，与主按钮的 token 化做法一致；②`.ms-btn` 无 `:focus-visible` 显式规则，当前依赖全局后代选择器，若将来页面根类改名会静默失去焦点环 |

### 4.9 分组与卡片：`.ms-group-title` / `.ms-group-count` / `.ms-cards` / `.ms-card*`

```html
<div class="ms-group">
  <div class="ms-group-title">用户（全局） <span class="ms-group-count">3</span></div>
  <div class="ms-cards">
    <div class="ms-card" title="（失败态时挂完整错误）">
      <button type="button" class="ms-card-hit" aria-label="编辑 xxx"></button>
      <span class="ms-card-glyph" aria-hidden="true">（内联 SVG）</span>
      <div class="ms-card-body">
        <div class="ms-card-head">
          <span class="ms-card-name">名字</span>
          <span class="ms-badge ms-badge-danger"><span class="ms-dot" aria-hidden="true"></span>失败</span>
        </div>
        <div class="ms-card-sub">stdio · npx -y xxx</div>
        <div class="ms-card-error">错误 · 连接超时</div>
        <div class="ms-card-tools">12 个工具 · 2 个已禁用</div>
        <div class="ms-probe-ok" role="status" aria-live="polite">连接正常 · 45ms · 12 个工具</div>
      </div>
      <div class="ms-card-actions"><button class="ms-btn ms-btn-ghost">测试</button><label class="ms-switch">…</label></div>
    </div>
  </div>
</div>
```

| 项 | 规格 |
|---|---|
| DOM | 组标题 `margin: 16px 0 8px` + 600 + 13px（`CSS` L264-L269）；计数 `label-tertiary` + 400 + `margin-left: 4px`（L271-L275）；卡片列表 `flex column` + `gap: 8px`（L277-L281）；卡片 `position: relative` + `flex` + `align-items: center` + `gap: 12px` + `padding: 12px 14px` + `border-radius: 10px`（L283-L291） |
| 尺寸 | 卡片图标 36x36 / 圆角 8px / `flex: none`（L321-L331），窄屏 32x32（L830-L833）；拉伸按钮 `inset: 0` + `z-index: 1` + `border-radius: 10px` + `padding: 0`（L299-L308）；正文 `flex: 1` + `min-width: 0`（L333-L336，防长端点撑破）；操作区 `z-index: 2` + `flex: none` + `gap: 10px`（L374-L381），窄屏整行右对齐（L835-L838） |
| 颜色 | 卡片描边 `border-l2`（L288）；悬停描边 `border-l4`（L293-L295）；图标底座 `interactive-bg-hover` + 图标 `label-secondary`（L328-L329）；名称继承正文（L345-L347）；副行 `label-secondary` + 12px（L349-L355）；错误行 `state-error-primary` + 12px + 两行截断（L357-L366）；工具数 `label-tertiary` + 12px（L368-L372） |
| 状态 | `.ms-card:hover` → 描边转 `border-l4`（L293-L295）；`.ms-card-hit:focus-visible` → 2px `state-business-primary` 焦点环 + `outline-offset: 2px`（L310-L313）；副行单行省略（L352-L354）；错误行 `-webkit-line-clamp: 2`（L361-L364）；失败态卡片 `title` 挂完整错误（`LV` L151） |
| 触发 | 整卡点击进编辑由拉伸按钮承载（`LV` L152-L157）；卡片级 `title` 仅在 `status === "failed"` 时挂 `server.error`（`LV` L151）；错误行仅在失败且 `error !== undefined` 时渲染（`LV` L167-L171）；工具行仅在 `showTools` 为真时渲染（`LV` L149、L172-L177） |
| 可访问性 | **拉伸按钮设计**（`CSS` L297-L298 注释原文：「拉伸按钮：卡片主操作（进编辑），覆盖整张卡片但位于操作区之下。键盘可达 + 有可读名；卡片内不再嵌套可交互元素。」）：`.ms-card-hit` 是原生 `<button type="button">`，带 `aria-label={t("editAria", {name})}`（`LV` L152-L157），键盘 Tab 可达、Enter / Space 触发。**层级设计**：`.ms-card-hit` `z-index: 1`、`.ms-card-glyph` / `.ms-card-body` `z-index: 0`（L315-L319）、`.ms-card-actions` `z-index: 2`（L376）——操作区在命中区**之上**，因此卡片内的测试按钮与开关仍可独立点击，且**卡片内确实不再嵌套其它可点元素**（唯一交互元素都在操作区内，且都在 `z-index: 2` 层） |

### 4.10 空态：`.ms-empty`

| 项 | 规格 |
|---|---|
| DOM | 纯文本块（`LV` L492-L498） |
| 尺寸 | `padding: 32px` + `border-radius: 10px` + `margin-top: 16px` + `text-align: center`（`CSS` L383-L390） |
| 颜色 | `border: 1px dashed border-l2` + 字 `label-tertiary`（L384-L388） |
| 状态 | 出现条件 = 过滤后为空（`LV` L491）；文案三选一：无服务器 `emptyList` / 有搜索词 `emptyFilter` / 仅筛选 `emptyFilterStatus`（`LV` L493-L497） |
| 可访问性 | 纯文本块，无需角色；字色 `label-tertiary` 在浅色回退下 3.71:1（§7.3）。**建议**升为 `label-secondary`（5.8:1） |

### 4.11 徽章与状态点：`.ms-badge` / `.ms-badge-danger` / `.ms-dot`

```html
<span class="ms-badge ms-badge-danger">
  <span class="ms-dot" style="background: var(--dsw-alias-state-error-primary,#e0483e)" aria-hidden="true"></span>
  失败
</span>
```

| 项 | 规格 |
|---|---|
| DOM | `inline-flex` + `align-items: center` + `gap: 5px` + 内嵌色点（`CSS` L397-L408、L410-L415） |
| 尺寸 | `padding: 1px 8px 1px 6px` + `border-radius: 12px` + 12px + `line-height: 18px` + `white-space: nowrap`（L401-L407）；色点 7x7 + `border-radius: 50%` + `flex: none`（L411-L414） |
| 颜色 | 基础：底 `interactive-bg-hover` + 字 `label-secondary`（L405-L406）；`.ms-badge-danger`：底 `interactive-bg-hover-danger` + 字 `state-error-primary`（L417-L420） |
| 状态 | tone 由 `statusTone(status)` 决定（`K` L31、L60-L63；`LV` L107），取 `success` / `info` / `warn` / `neutral` / `danger`；**只有 `danger` 有差异样式**，其余四档回落基础中性样式（§2.4） |
| 触发 | 每张卡片头部一个（`LV` L164），文案由 `statusLabel()` 给出（`LV` L35-L38、L109） |
| 可访问性 | **双通道已成立**：色点 `aria-hidden="true"`（`LV` L108）不参与朗读，状态文字由徽章文本承担——颜色不再是唯一线索。**建议**：①`.ms-badge-danger` 的文字改 `label-primary`（现为 `state-error-primary`，3.94:1，见 §7.3）；②其底色改用 `state-error-tertiary` 以对齐 T7（§1.2） |

### 4.12 探活结果：`.ms-probe-ok` / `.ms-probe-fail` / `.ms-probe-pending`

| 项 | 规格 |
|---|---|
| DOM | 三态共用一个 `<div>`，类名由 `probe.ok` 三分支决定（`LV` L179-L185、`EV` L452-L458） |
| 尺寸 | 共用：12px + `margin-top: 8px` + `padding: 6px 10px` + `border-radius: 6px` + `word-break: break-word`（`CSS` L422-L430） |
| 颜色 | ok：底 `state-success-tertiary` + 字 `label-primary`（L432-L435）；fail：底 `interactive-bg-hover-danger` + 字 `state-error-primary`（L437-L440）；pending：底 `interactive-bg-hover` + 字 `label-secondary`（L442-L445） |
| 状态 | 三态齐全：`ok === true` / `ok === false` / 其余（pending）（`LV` L180、`EV` L453）；pending 时文案走 `testing`（`LV` L184、`EV` L457） |
| 可访问性 | 已带 `role="status"` + `aria-live="polite"`（`LV` L181-L182、`EV` L454-L455）——**播报已做对**，且 pending 有独立中性样式（不再把「进行中」渲染成失败）。**建议** fail 态文字改 `label-primary`（3.94:1，见 §7.3） |

### 4.13 启停开关：`.ms-switch` / `.ms-switch-slider` / `.ms-switch-busy`

```html
<label class="ms-switch" aria-busy="false">
  <input type="checkbox" role="switch" aria-checked="true" aria-label="启用或停用 xxx" checked />
  <span class="ms-switch-slider" aria-hidden="true"></span>
</label>
```

| 项 | 规格 |
|---|---|
| DOM | `<label>` 包裹隐藏 `<input type="checkbox">` + `<span class="ms-switch-slider">`（`LV` L198-L208；工具面板同构 `EV` L99-L110） |
| 尺寸 | 轨道 **40x24** + `flex: none`（`CSS` L449-L456）；input `opacity: 0` + `position: absolute` + `inset: 0` + 100% 宽高（L458-L466）——**命中区等于轨道尺寸 40x24**；滑块 18x18 + `left/top: 3px`（L477-L484）；开启位移 `translateX(16px)`（L493-L495，3+18+3=24，余 16px 正好到位） |
| 颜色 | 关闭态轨道 `label-tertiary`（L472）；开启态轨道 `state-success-primary`（L489-L491）；滑块 **`background: #fff` 硬编码**（L485，见 §8.1） |
| 状态 | `input:checked + .ms-switch-slider` 变色（L489-L491）+ 滑块位移（L493-L495）；`.ms-switch-busy` → `opacity: 0.6` + `pointer-events: none`（L502-L505）；`input:focus-visible + .ms-switch-slider` → 2px `state-business-primary` 焦点环 + `outline-offset: 2px`（L497-L500） |
| 触发 | 列表卡片：`busy` 类由 `busy[key] === true` 切换、`aria-busy` 同步（`LV` L198）；`checked` 受控（`LV` L204）；工具面板：`disabled={serverKey === undefined}`（`EV` L105） |
| 可访问性 | 原生 checkbox 保留键盘与读屏语义，**并显式补了 `role="switch"` + `aria-checked` + `aria-label`**（`LV` L201-L203、`EV` L102-L104）；焦点可见由 `input:focus-visible + .ms-switch-slider` 提供（L497-L500）。轨道 40x24 **达 WCAG 2.2 AA 2.5.8 的 24px 底线**（24px 恰好在边界，**建议**用伪元素外扩到 ≥24px 并留余量）。**建议**：busy 时同时给 `input` 加 `disabled`——`pointer-events: none` 只挡指针，键盘仍可切换（`LV` L198-L206 未设 `disabled`） |

### 4.14 面包屑：`.ms-breadcrumb` / `-root` / `-sep` / `-current`

| 项 | 规格 |
|---|---|
| DOM | `flex` + `align-items: center` + `gap: 8px` + `margin-bottom: 12px` + 13px（`CSS` L509-L515） |
| 尺寸 | 根按钮 `padding: 0` + `border: none` + `background: none` + 13px（L517-L524）——**命中区高度仅约 19.5px，低于 24px 底线** |
| 颜色 | 根按钮 `link`（L520）；禁用 `label-tertiary` + `cursor: not-allowed`（L526-L529）；分隔符 `label-tertiary`（L531-L533）；当前项 `label-secondary`（L535-L537） |
| 状态 | 根按钮 `disabled={busy}`（`EV` L345）——保存中禁止返回，防挂起请求落在已卸载页面（`EV` L314-L322 注释） |
| 可访问性 | 原生 `<button type="button">` + `aria-label={t("backAria")}`（`EV` L345）；分隔符 `aria-hidden="true"`（`EV` L348）；焦点环由 `.ms-page :focus-visible` 提供。**建议**给根按钮补 `padding: 4px 6px`（或伪元素外扩热区）使其达 ≥24px，同时保持行内对齐 |

### 4.15 编辑头与模式切换：`.ms-edit-head` / `.ms-mode-switch` / `.ms-mode-active`

| 项 | 规格 |
|---|---|
| DOM | 头部 `flex` + `align-items: flex-start` + `space-between` + `gap: 12px` + wrap（`CSS` L539-L545），左侧为标题 + 副标题的匿名 `<div>`（`EV` L352-L355），右侧为 `.ms-mode-switch`（`EV` L356-L359） |
| 尺寸 / 颜色 / 状态 | 见 §4.7（两族合并说明） |
| 可访问性 | 见 §4.7；`.ms-mode-active` 的命名破口见 §2.2 |

### 4.16 表单容器与字段布局：`.ms-form-card` / `.ms-form` / `.ms-field-row` / `.ms-field` / `.ms-label`

| 项 | 规格 |
|---|---|
| DOM | 表单卡 `border-radius: 12px` + `padding: 20px`（窄屏 14px）+ `margin-top: 12px` + 描边 `border-l2`（`CSS` L573-L578、L848-L850）；表单 `flex column` + `gap: 14px`（L580-L584）；字段行 `flex` + `gap: 16px` + wrap（L586-L590）；行内字段 `flex: 1` + `min-width: 220px`（L592-L595，窄屏 `min-width: 0` + 纵向堆叠 L840-L846）；标签 `display: block` + 13px + 600 + `margin-bottom: 6px`（L597-L602） |
| 颜色 | 表单卡描边 `border-l2`；**无底色声明**（继承宿主容器）；标签继承正文 |
| 状态 | 无状态类；结构随 `mode` 二选一：表单渲染 `.ms-form`，JSON 渲染单个 `.ms-json`（`EV` L363-L438） |
| 可访问性 | 每个 `<label>` 都带 `htmlFor` 且对应控件带同值 `id`：`ms-name` L367-L368、`ms-scope` L372-L373、`ms-transport` L382-L383、`ms-timeout` L389-L390、`ms-command` L397-L398、`ms-args` L401-L402、`ms-env` L405-L406、`ms-cwd` L409-L410、`ms-url` L416-L417、`ms-headers` L420-L421——**10 处字段标签关联全部完成**，是本形态相对旧形态的实质性改进 |

### 4.17 输入控件：`.ms-input` / `.ms-textarea` / `.ms-json`

| 项 | 规格 |
|---|---|
| DOM | `.ms-input` 用于单行文本（名称 / 超时 / 命令 / 参数 / 工作目录 / URL）；`.ms-textarea` 用于 `rows={3}` 的键值多行（环境变量 / 请求头）；`.ms-json` 用于 JSON 模式（`rows={16}`）与导入（`rows={6}`） |
| 尺寸 | 输入 / 文本域：`width: 100%` + `box-sizing: border-box` + `padding: 8px 10px` + `border-radius: 8px` + 13px（`CSS` L604-L615）；JSON：同宽度与圆角、`padding: 12px` + **12.5px**（L640-L651）；文本域与 JSON 均 `resize: vertical`（L636、L650） |
| 颜色 | 描边 `border-l4` + 底 `bg-layer-1` + 字 `inherit`（L609-L612、L644-L647）；文本域 / JSON / 工具名用等宽字族 `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`（L637、L648、L773）——**覆盖三 OS** |
| 状态 | `:focus` → `outline: none` + 描边改 `state-business-primary`（L622-L627）；`:disabled` → `opacity: 0.6`（L617-L620，**仅覆盖 `.ms-input` 与 `.ms-select`**；`.ms-textarea:disabled` / `.ms-json:disabled` 无规则，**建议**补齐） |
| 可访问性 | 全部有关联标签（§4.16）；JSON 文本域另有 `aria-label`（`EV` L434 用 `modeJson`、`LV` L451 用 `importTitle`）；`spellCheck={false}` 关闭拼写检查（`EV` L433、`LV` L450）；焦点可见性由 `.ms-page :focus-visible`（L785）补 2px 焦点环 + 自身描边变色——**`outline: none` 与焦点环成对，未出现「只去 outline」的半套做法** |

### 4.18 字段提示：`.ms-field-hint`

| 项 | 规格 |
|---|---|
| DOM | 纯文本块，紧跟在字段或字段行之后（`EV` L369、L377、L391；`LV` L445、L466、L501） |
| 尺寸 | 12px + `margin-top: 4px`（`CSS` L629-L633） |
| 颜色 | `label-tertiary`（L630） |
| 状态 | 无；名称字段的提示仅在新建态渲染（`EV` L369）；工具面板的 `toolsUnavailable` 也复用它（`EV` L89） |
| 可访问性 | 提示与字段无 `aria-describedby` 关联（**建议**补）；字色 3.71:1（§7.3） |

### 4.19 表单底栏：`.ms-form-footer` / `.ms-form-footer-right`

| 项 | 规格 |
|---|---|
| DOM | `flex` + `align-items: center` + `space-between` + `gap: 12px` + `margin-top: 20px` + wrap（`CSS` L653-L660）；右侧组 `gap: 8px` + `margin-left: auto` + wrap（L662-L668） |
| 尺寸 | 无固定高度；窄屏不切换方向（保持 wrap，**建议**在 <720px 下改纵向堆叠、主操作在下） |
| 颜色 | 无（仅布局） |
| 状态 | 左侧删除按钮仅编辑态渲染（`EV` L480-L482）；右侧测试按钮仅编辑态渲染且 `probe.pending` 时禁用（`EV` L484-L486）；导入面板复用同一底栏（`LV` L470-L483） |
| 可访问性 | 布局无语义；按钮均为原生元素与原生 `disabled` |

### 4.20 页内确认条：`.ms-confirm` / `.ms-confirm-text` / `.ms-confirm-actions`

```html
<div class="ms-confirm" role="alertdialog" aria-live="assertive">
  <span class="ms-confirm-text">确认删除 MCP 服务器「xxx」？该操作不可撤销。</span>
  <div class="ms-confirm-actions">
    <button class="ms-btn ms-btn-ghost">取消</button>
    <button class="ms-btn ms-btn-danger-solid">确认删除</button>
  </div>
</div>
```

| 项 | 规格 |
|---|---|
| DOM | `flex` + `align-items: center` + `space-between` + `gap: 12px` + wrap + `margin-top: 16px` + `padding: 10px 12px` + `border-radius: 8px`（`CSS` L671-L684）；文本块 `flex: 1 1 260px` + `min-width: 0` + `word-break: break-word`（L686-L690）；动作组 `gap: 8px` + `margin-left: auto`（L692-L697） |
| 颜色 | 描边 `state-warn-secondary`（回退 `#f7ad31`）+ 底 `state-warn-tertiary`（回退 `#fef5e7`）+ 字 `label-primary` + 13px（L680-L683） |
| 状态 | 由 `confirming` state 三态驱动：`""` 不渲染 / `"delete"` / `"discard"`（`EV` L146、L460-L478） |
| 触发 | 点「删除」进入 `delete`（`EV` L481）；有未保存改动时点取消或面包屑根进入 `discard`（`EV` L318-L322） |
| 可访问性 | 已带 `role="alertdialog"` + `aria-live="assertive"`（`EV` L461）——**替代 `window.confirm` 的页内确认条，可样式化、随主题**。**建议**：①`role="alertdialog"` 需要可访问名，补 `aria-label` 或 `aria-labelledby`；②描边色 `#f7ad31` 对白底仅 1.91:1、对其自身淡底 1.77:1，**低于非文本 3:1 底线**（§7.3），**建议**改用更深的警告色做描边 |

### 4.21 导入面板：`.ms-import` / `.ms-import-head` / `.ms-import-scope` / `.ms-check`

```html
<div class="ms-form-card ms-import">
  <div class="ms-import-head"><strong>导入 mcpServers JSON</strong></div>
  <p class="ms-field-hint">粘贴 mcpServers JSON：…</p>
  <textarea class="ms-json" rows="6" aria-label="导入 mcpServers JSON"></textarea>
  <div class="ms-import-scope">
    <label class="ms-label" htmlFor="ms-import-scope">作用域</label>
    <select id="ms-import-scope" class="ms-select">…</select>
    <div class="ms-field-hint">…</div>
  </div>
  <div class="ms-form-footer">
    <label class="ms-check"><input type="checkbox" />覆盖同名服务器</label>
    <div class="ms-form-footer-right">…</div>
  </div>
</div>
```

| 项 | 规格 |
|---|---|
| DOM | 面板复用 `.ms-form-card`（`LV` L441），仅追加 `margin-top: 8px`（`CSS` L701-L703）；头部 `margin-bottom: 4px`（L705-L707）；作用域块 `margin: 12px 0 0` + `max-width: 520px`（L709-L712） |
| 尺寸 | `.ms-check` `inline-flex` + `gap: 6px` + 13px + `min-height: 32px`（L714-L722） |
| 颜色 | `.ms-check` 字 `label-secondary`（L719）；其余继承表单卡与输入控件 |
| 状态 | 由 `importOpen` 控制整体显隐（`LV` L440）；`importBusy` 禁用取消与执行按钮（`LV` L476、L479）；JSON 为空时禁用执行按钮（`LV` L479） |
| 可访问性 | JSON 文本域 `aria-label`（`LV` L451）；作用域标签 `htmlFor` + `id` 配对（`LV` L456-L458）；无活动项目会话时项目级选项 `disabled`（`LV` L464）；触发按钮带 `aria-expanded={importOpen}`（`LV` L428）。`.ms-check` 的复选框**无 `aria-label` 但被 `<label>` 包裹且 label 有文本**（`LV` L471-L474）——可读名成立 |

### 4.22 工具面板：`.ms-tools` / `-head` / `-summary` / `-empty` / `-list` / `.ms-tool-row` / `.ms-tool-name` / `.ms-tool-name-off`

```html
<div class="ms-tools">
  <div class="ms-tools-head"><strong>工具</strong><span class="ms-tools-summary">共 12 个，已禁用 2 个</span></div>
  <ul class="ms-tools-list">
    <li class="ms-tool-row">
      <span class="ms-tool-name">read_file</span>
      <label class="ms-switch"><input type="checkbox" role="switch" aria-checked="true" aria-label="启用或禁用工具 read_file" /><span class="ms-switch-slider" aria-hidden="true"></span></label>
    </li>
    <li class="ms-tool-row"><span class="ms-tool-name ms-tool-name-off">write_file</span>…</li>
  </ul>
  <div class="ms-field-hint">禁用后该工具对模型不可见…</div>
</div>
```

| 项 | 规格 |
|---|---|
| DOM | 面板 `margin-top: 20px` + `padding-top: 16px` + `border-top: 1px solid border-l1`（`CSS` L726-L730）；头部 `flex` + `align-items: baseline` + `gap: 8px` + `margin-bottom: 8px`（L732-L737）；列表 `list-style: none` + `margin: 0 0 8px` + `padding: 0` + `max-height: 320px` + `overflow-y: auto` + 描边 `border-l2` + 圆角 8px（L750-L758） |
| 尺寸 | 工具行 `flex` + `space-between` + `gap: 12px` + `padding: 6px 12px`（L760-L766）；行间分隔线 `border-top: 1px solid border-l1`（L768-L770）；工具名 12.5px + 等宽 + `word-break: break-all`（L772-L776） |
| 颜色 | 摘要 `label-tertiary` + 12px（L739-L742）；空态 `label-tertiary` + 13px + `padding: 10px 0`（L744-L748）；关闭态工具名 `label-tertiary` + `text-decoration: line-through`（L778-L781） |
| 状态 | 面板仅在编辑态渲染（`EV` L439-L450）；`serverKey === undefined` 时显示 `toolsUnavailable` 提示且开关 `disabled`（`EV` L89、L105）；工具为空显示 `toolsEmpty`（`EV` L90-L91）；每个工具的开关 `pending` 期间加 `.ms-switch-busy`（`EV` L99） |
| 可访问性 | 开关带 `role="switch"` + `aria-checked` + 工具级 `aria-label`（`EV` L100-L104）；列表用语义化 `<ul>` / `<li>`（`EV` L93、L97）；`line-through` 之外还有色变，关闭态**不单靠删除线**。**建议**：`max-height: 320px` 的滚动容器在键盘 Tab 到列表外时可能不自动滚动，可加 `scroll-margin` 或 `tabindex` 兜底 |

### 4.23 双语排版影响（文案长度）

字典为 zh 源 + en 全量覆盖（`src/client/locales.ts`：`zh` 段 L10-L124、`en: typeof zh` 段
L127-L233，**各 101 个键**，编译期锁平衡；分组顺序为状态 → 状态筛选簇 → 页面骨架 → 工具栏 →
导入 → 分组 → 列表卡片 → 编辑页 → 编辑页·工具级禁用 → 编辑页·动作 → 校验 → 提示，
分组注释见 L11、L18、L23、L27、L42、L51、L56、L66、L92、L100、L113、L118）。
对排版有直接影响的超长单行文案：

| key | zh 长度 | en 长度 | 承载类 | 影响 |
|---|---|---|---|---|
| `subtitle` | 41 字 | 106 字符 | `.ms-subtitle`（14px） | 窄屏 2-3 行 |
| `middlewareEffectOff` / `-Project` / `-All` | 34 / 40 / 32 字 | 110+ 字符 | `.ms-hint`（12px） | 工具行下的最长单段，决定视觉重量 |
| `importHint` | 62 字 | 160+ 字符 | `.ms-field-hint`（12px） | 导入面板首段 |
| `fieldEnv` / `fieldHeaders` | 30 / 27 字 | 63 / 61 字符 | `.ms-label`（13px / 600） | 标签变长后与 `min-width: 220px` 的字段可能挤行 |
| `searchPlaceholder` | 9 字 | 20 字符 | `.ms-search`（`min-width: 200px`） | 英文占位有被裁切风险 |
| `toolsHint` | 47 字 | 150+ 字符 | `.ms-field-hint`（12px） | 工具面板尾部说明 |

**建议**：新增文案按「标签 ≤ 12 字 / 提示 ≤ 60 字」自检；超长文案优先放 `.ms-field-hint`
而不是标签位；`.ms-search` 的 `min-width: 200px` 在英文界面下建议实测占位是否被裁切。

<a id="theme"></a>
## 5. 主题与响应式

### 5.1 明暗自适应与浅色回退

1. **不自行切主题**：客户端不读主题模式、不写 `data-theme`，全部颜色来自宿主注入的
   `--dsw-alias-*`（`docs/DEVELOPMENT.md` §6 第 3 条，L612-L614：禁止硬编码单一配色）。
2. **回退写法**：统一 `var(--dsw-alias-x, 浅色值)`。**实测：全文 88 处 `var()` 全部带回退，
   0 处裸 `var(--dsw-alias-x)`**（见 §1.2 T11）。
3. **回退值是浅色口径**，只在宿主缺项时生效；深色主题下若宿主缺项会落回浅色值（可能不可读）——
   因此**新增颜色必须先确认宿主有该 token**，再写回退。
4. **不得覆盖宿主 token**：不在插件样式里重定义 `--dsw-alias-*`。**实测：全文 0 处自定义属性
   声明**（无 `--` 开头的属性定义），符合纪律。
5. **回退值漂移**见 §1.4，**建议**在 `style.css` 头部维护一张「回退值表」作为单一事实源。
6. **明暗差异的判定方法**：本文**不提供任何深色主题下的实测色值**——深色值由宿主 token 决定。
   判定口径：在明暗双主题下用 DevTools 读取 computed color，再按 WCAG 相对亮度公式计算对比度
   （`docs/DEVELOPMENT.md` §6 L617-L619 要求客户端交互改动在**双主题 + 窄屏**下实测）。
   本文 §7.3 的数值全部标注了「按浅色回退值计算」，**不是**主题实测值。

### 5.2 唯一断点 720px 的逐条行为变化表

断点：`@media (max-width: 720px)`（`CSS` L799-L851）。**这是本文件唯一的宽度断点**，
也是唯一一条把「pad / phone 经局域网访问」写进注释的段落（L797）。

| # | 选择器 | ≥720px（默认） | <720px（断点内） | 锚点 |
|---|---|---|---|---|
| 1 | `.ms-page` | `padding: 8px 0 48px` | `padding-bottom: 32px`（左右仍为 0） | L29 / L800-L802 |
| 2 | `.ms-toolbar` | `space-between` + wrap，左右组并排 | `width: 100%` | L119-L126 / L804-L808 |
| 3 | `.ms-toolbar-left` / `.ms-toolbar-right` | 内容宽度自适应 | `width: 100%` + `justify-content: flex-start` | L128-L134 / L804-L813 |
| 4 | `.ms-search` | `min-width: 200px` | `flex: 1` + `min-width: 0`（搜索框独占剩余宽度，不再强制 200px） | L177 / L815-L818 |
| 5 | `.ms-btn` / `.ms-chip` / `.ms-seg-btn` | `min-height: 32px`（chip 30px） | `min-height: 36px` | L210/L87/L150 / L820-L824 |
| 6 | `.ms-card` | `align-items: center`，不换行 | `flex-wrap: wrap`（操作区可整行下移） | L283-L291 / L826-L828 |
| 7 | `.ms-card-glyph` | 36x36 | 32x32 | L325-L326 / L830-L833 |
| 8 | `.ms-card-actions` | `flex: none`，跟在正文右侧 | `width: 100%` + `justify-content: flex-end` | L374-L381 / L835-L838 |
| 9 | `.ms-field-row` | `flex` + `gap: 16px` + wrap（可两列） | `flex-direction: column`（单列） | L586-L590 / L840-L842 |
| 10 | `.ms-field-row .ms-field` | `min-width: 220px` | `min-width: 0`（解除 220px 下限） | L592-L595 / L844-L846 |
| 11 | `.ms-form-card` | `padding: 20px` | `padding: 14px` | L576 / L848-L850 |

**未纳入断点、但窄屏会受影响的三处（**建议**补齐）**：

| 元素 | 现状 | 建议 |
|---|---|---|
| `.ms-mode-switch button` | 窄屏**不在 36px 放大清单内**（L820-L823 只列了 `.ms-btn` / `.ms-chip` / `.ms-seg-btn`） | 补进放大清单，与同族 `.ms-seg-btn` 对齐 |
| `.ms-breadcrumb-root` | `padding: 0`，命中区约 19.5px，窄屏无补偿 | 补 `padding: 4px 6px` 或伪元素外扩热区 |
| `.ms-form-footer` | 窄屏保持 `space-between` + wrap，未改纵向 | 改纵向堆叠 + 主操作在下（`flex-direction: column-reverse` 或调序） |

### 5.3 触控目标与悬停态

**触控目标**（按声明值推算，**未在浏览器实测**；口径 = `font-size × line-height(1.5，继承自 .ms-page) + padding×2 + border×2`）：

| 元素 | 声明尺寸 / 推算高度 | 24px 底线 | 窄屏 36px |
|---|---|---|---|
| `.ms-btn` | `min-height: 32px` | 通过 | 通过（断点内 36px） |
| `.ms-search` / `.ms-select` | `min-height: 32px` | 通过 | 通过（搜索随 `.ms-search` 的 `flex: 1` 撑高；下拉未显式放大，但 32px 已 ≥24px） |
| `.ms-seg-btn` | `min-height: 32px` | 通过 | 通过（断点内 36px） |
| `.ms-chip` | `min-height: 30px` | 通过 | 通过（断点内 36px） |
| `.ms-mode-switch button` | `min-height: 32px` | 通过 | **未放大**（建议补齐） |
| `.ms-check` | `min-height: 32px` | 通过 | 未放大 |
| `.ms-input` / `.ms-textarea` | 推算 ≈37.5px（13×1.5 + 16 + 2） | 通过 | 未显式放大 |
| `.ms-json` | 推算 ≈44.8px（12.5×1.5 + 24 + 2） | 通过 | 未显式放大 |
| `.ms-switch` | **40x24**（恰在底线） | **边界通过** | 未放大；**建议**伪元素外扩 |
| `.ms-card-hit` | 铺满卡片（`inset: 0`），远大于 24px | 通过 | 通过 |
| `.ms-breadcrumb-root` | **推算 ≈19.5px**（`padding: 0` + 13px×1.5） | **不通过** | 不通过；**建议**补内边距或外扩热区 |
| `.ms-tool-row` | `padding: 6px 12px` + 内容行高，推算 ≥ 24px | 通过 | 未显式放大 |

**悬停态是否包 `@media (hover: hover)`——核实结论：未包。**

| 检查项 | 结果 |
|---|---|
| `@media (hover: hover)` | **0 处**（全文 `@media` 仅 2 处：`prefers-reduced-motion` L790、`max-width: 720px` L799） |
| 裸写 `:hover` 的规则 | **10 处**：`.ms-chip:hover` L97、`.ms-seg-btn:hover` L157、`.ms-seg-active:hover` L167、`.ms-btn-primary:hover` L232、`.ms-btn-ghost:hover` L240、`.ms-btn-danger:hover` L249、`.ms-btn-danger-solid:hover` L258、`.ms-card:hover` L293、`.ms-mode-switch button:hover` L564（另 `.ms-switch` 的 `cursor: pointer` 不属 hover 规则） |
| 与 `docs/DEVELOPMENT.md` §7 第 5 条的差距 | 该条要求「悬停态一律包 `@media(hover:hover)`」（L642）。**现状未落地**——触屏设备上 `:hover` 会在点按后残留，形成「粘住的悬停态」 |

**建议**（统一包装，不改任何现有声明值）：

```css
@media (hover: hover) {
  .ms-chip:hover,
  .ms-seg-btn:hover,
  .ms-btn-primary:hover:not(:disabled),
  .ms-btn-ghost:hover:not(:disabled),
  .ms-btn-danger:hover:not(:disabled),
  .ms-btn-danger-solid:hover:not(:disabled),
  .ms-card:hover,
  .ms-mode-switch button:hover {
    /* 原声明搬入 */
  }
}
```

注意 `.ms-seg-active:hover`（L167）是**反向覆盖**（保持主填充底），应与 `.ms-seg-btn:hover`
放进同一能力查询内成对处理，否则触屏上激活态会被悬停灰覆盖。

<a id="motion"></a>
## 6. 动效

### 6.1 现状（实测）

`transition` 全文 **3 处**，其中 2 处是真实动效、1 处是降级关闭：

| 位置 | 声明 | 用途 | 锚点 |
|---|---|---|---|
| `.ms-switch-slider` | `transition: background 0.15s ease` | 开 / 关轨道变色 | L473 |
| `.ms-switch-slider::before` | `transition: transform 0.15s ease` | 滑块位移 | L486 |
| `@media (prefers-reduced-motion: reduce)` 内 | `transition: none` | 关闭上述两条 | L790-L795 |

其余交互态（按钮悬停、卡片悬停描边、chip 悬停、输入聚焦描边）**均为瞬时切换，无过渡**。

### 6.2 `prefers-reduced-motion` 处理

**已处理**（`CSS` L790-L795）：

```css
@media (prefers-reduced-motion: reduce) {
  .ms-switch-slider,
  .ms-switch-slider::before {
    transition: none;
  }
}
```

覆盖范围与现有动效面**完全一致**——因为当前只有开关两处有过渡，所以该块是完备的。
**建议**：把该块保留在文件末尾的「12 可访问性」分层内（现状位置正确），
并在将来新增任何 `transition` / `animation` 时同步扩充选择器列表。

### 6.3 新增动效的时长 / 缓动刻度

| 维度 | 刻度 | 依据 |
|---|---|---|
| 颜色 / 描边过渡 | `0.15s ease` | 与既有两处一致 |
| 位移 / 透明度过渡 | `0.15s ease` | 与既有两处一致 |
| 缓动 | 只用 `ease`，不引入弹簧 / 回弹 / cubic-bezier 自定义曲线 | 与既有两处一致 |
| 上限 | 单次过渡不超过 `0.2s` | 设置页是高频操作面，长动效拖慢操作节奏 |
| 降级 | 每个新增 `transition` / `animation` 必须同步进 L790 的 `prefers-reduced-motion` 选择器列表 | §6.2 |
| 位移类动效 | 是 reduced-motion 的重点对象（如 `translateX`）；纯颜色渐变可保留 | 无障碍惯例 |

<a id="a11y"></a>
## 7. 可访问性

### 7.1 焦点环：用色与实现

| 项 | 事实 | 锚点 |
|---|---|---|
| 用色 | `--dsw-alias-state-business-primary`，回退 `#4176e6`（与文件头 L16 声明的「官方 focus 用色」一致） | L311、L498、L786 |
| 宽度 / 偏移 | `outline: 2px solid` + `outline-offset: 2px`，3 处写法完全一致 | 同上 |
| 覆盖范围 | `.ms-page :focus-visible`（L785-L788）是**全局后代选择器**，一次覆盖页内所有可聚焦元素（按钮、链接、输入、下拉、文本域、拉伸按钮、分段按钮） | L785 |
| 显式重复的三处 | `.ms-card-hit:focus-visible`（L310-L313）、`.ms-switch input:focus-visible + .ms-switch-slider`（L497-L500）——前者与全局规则同效，后者是**必需的**（`.ms-switch input` 尺寸 100% 但 `opacity: 0`，必须把焦点环画到可见的轨道上） | L310、L497 |
| `outline: none` 的两处 | `.ms-search` L184、`.ms-input/.ms-textarea/.ms-json:focus` L625——**两处都与焦点环成对出现**：前者由 L785 的全局 `:focus-visible` 兜底，后者由同一全局规则兜底 + 自身 1px 描边变色 | L184、L625 |
| 聚焦描边（非焦点环） | `.ms-search:focus` / `.ms-select:focus`（L196-L199）、`.ms-input:focus` 等（L622-L627）改 1px 描边为 `state-business-primary` | L196、L622 |

**核实结论**：本形态**不存在**「只去 outline、不给替代焦点指示」的半套做法——全文 2 处
`outline: none` 都在 `.ms-page` 的 `:focus-visible` 覆盖面内。这是相对旧形态（无任何
`:focus-visible`）的实质性修复。

**建议**：①`outline: none` 后**必须**保留 `.ms-page :focus-visible` 的覆盖——若将来页面根类改名，
这两处会静默变成「无焦点指示」，建议在该全局规则旁加注释声明这条依赖；②`.ms-btn` /
`.ms-seg-btn` / `.ms-mode-switch button` / `.ms-breadcrumb-root` 均无**自身**的 `:focus-visible`
规则，当前完全依赖全局后代选择器，属单点依赖。

### 7.2 `.ms-card-hit` 的键盘可达设计

`CSS` L297-L298 的注释原文（**设计契约，逐条核实**）：

| 注释声明 | 核实结论 | 锚点 |
|---|---|---|
| 「拉伸按钮：卡片主操作（进编辑），覆盖整张卡片但位于操作区之下」 | **成立**：`inset: 0` 铺满卡片，`z-index: 1`；`.ms-card-glyph` / `.ms-card-body` 为 `z-index: 0`（在其下），`.ms-card-actions` 为 `z-index: 2`（在其上） | L299-L308、L315-L319、L374-L381 |
| 「键盘可达」 | **成立**：`.ms-card-hit` 是原生 `<button type="button">`（`LV` L152-L157），Tab 可聚焦、Enter / Space 触发；并带 `:focus-visible` 焦点环（L310-L313） | L310、`LV` L152 |
| 「有可读名」 | **成立**：`aria-label={t("editAria", { name: server.name })}`，字典值「编辑 {name}」/「Edit {name}」 | `LV` L155；`locales.ts` L63、L173 |
| 「卡片内不再嵌套可交互元素」 | **成立**：卡片内的可点元素只有 `.ms-card-hit`（拉伸层）与 `.ms-card-actions` 里的测试按钮 + 开关；操作区 `z-index: 2` 高于命中区，两者命中区不重叠（按钮在上） | `LV` L151-L210 |

**结论**：卡片键盘可达性由「拉伸按钮 + `z-index` 分层 + `aria-label`」三件套完整实现，
是相对旧形态（可点击 `div`、无 `role` / `tabIndex` / 键盘处理）的实质性修复。
**建议**：①`.ms-card-hit` 缺 `:hover` 规则，卡片悬停的视觉反馈只来自 `.ms-card:hover`
的描边变化（L293-L295）——若希望命中区本身也有反馈，补一条与其 `z-index` 层级一致的悬停态；
②`.ms-card-hit` 的 `border-radius: 10px`（L305）必须与 `.ms-card` 的 10px（L289）保持同值（§3.2）。

### 7.3 对比度（按**浅色回退值**计算，非主题实测值）

计算口径：WCAG 2.x 相对亮度公式；`rgba` 淡底按 alpha 与白底合成后取整
（`rgba(236,19,19,0.08)` 合成得 `#fdecec`，`0.06` 得 `#fef1f1`）。
**未在浏览器实测**；**实际主题下的色值由宿主 token 决定，必须以 DevTools 实测为准**。
本表用于识别「回退路径下的风险点」，复算方法见 [附录 B](#appendix-b)。

| 组合 | 计算值 | 口径 | 结论 | 对应类 |
|---|---|---|---|---|
| `label-primary` `#0f1115` / 白底 | 18.90:1 | 正文 4.5:1 | 通过 | `.ms-page` 等 |
| `label-secondary` `#61666b` / 白底 | 5.80:1 | 正文 4.5:1 | 通过 | `.ms-subtitle`、`.ms-chip`、`.ms-card-sub`、`.ms-badge`、`.ms-probe-pending` |
| `label-tertiary` `#81858c` / 白底 | 3.71:1 | 正文 4.5:1 | **不通过** | `.ms-hint`、`.ms-chip-count`、`.ms-group-count`、`.ms-card-tools`、`.ms-empty`、`.ms-field-hint`、`.ms-tools-summary`、`.ms-tools-empty`（均为 12-13px 正文） |
| `label-tertiary` `#81858c` / 白底 | 3.71:1 | 非文本 3:1 | 通过 | `.ms-switch-slider` 关闭态轨道（L472） |
| `state-error-primary` `#ec1313` / 白底 | **4.4976:1**（精确值，四舍五入显示为 4.50） | 正文 4.5:1 | **不通过**（差 0.0024，属临界不达标） | `.ms-btn-danger` 文字与描边 |
| `state-error-primary` `#ec1313` / `#fdecec` 淡底 | **3.94:1** | 正文 4.5:1 | **不通过** | `.ms-error-banner`（13px）、`.ms-probe-fail`（12px）、`.ms-badge-danger`（12px）、`.ms-card-error`（12px） |
| `state-error-primary` `#ec1313` / `#fef1f1` 淡底（0.06） | 4.08:1 | 正文 4.5:1 | **不通过** | `.ms-btn-danger:hover` 文字（13px） |
| `label-primary` `#0f1115` / `state-success-tertiary` `#e6faed` | 17.33:1 | 正文 4.5:1 | 通过 | `.ms-ok-banner`、`.ms-probe-ok` |
| `label-primary` `#0f1115` / `state-warn-tertiary` `#fef5e7` | 17.48:1 | 正文 4.5:1 | 通过 | `.ms-confirm` 文字 |
| `state-business-primary` `#4176e6` / 白底 | 4.23:1 | 非文本 3:1 | 通过 | 焦点环、聚焦描边 |
| `link` `#4176e6` / 白底 | 4.23:1 | 正文 4.5:1 | **不通过**（13px 链接文字，差 0.27） | `.ms-breadcrumb-root` |
| `state-success-primary` `#22c55e` / 白底 | 2.28:1 | 非文本 3:1 | **不通过** | 开关开启态轨道（与白色滑块之间同样只有 2.28:1） |
| `state-warn-secondary` `#f7ad31` / 白底 | 1.91:1 | 非文本 3:1 | **不通过** | `.ms-confirm` 描边 |
| `state-warn-secondary` `#f7ad31` / 自身淡底 `#fef5e7` | 1.77:1 | 非文本 3:1 | **不通过** | 同上 |

**为什么状态色只做色点、正文用 `label-*` 系列**：状态色（`state-*-primary`）是为「语义点缀」
设计的中间明度色，直接当正文色时在上表口径下只有 2.28-4.08:1；而 `label-primary` /
`label-secondary` 达 18.90:1 / 5.80:1。因此规范口径是：**语义靠 `state-*` 的色点 / 描边 / 淡底
表达，文字一律回落到 `label-*` 系列**（文件头注释 L13-L15 已声明该纪律）。当前
`.ms-error-banner`（L65）、`.ms-probe-fail`（L439）、`.ms-badge-danger`（L419）、
`.ms-card-error`（L358）、`.ms-btn-danger`（L245）是反例，**建议**改为「淡底 + `label-primary`
文字 + 状态色描边 / 色点」形态。

**本文数值的边界**：以上全部为**浅色回退值**下的计算，不是主题实测值。
深色主题下这些组合的实际比值需按 §5.1 第 6 条的方法实测，**本文不提供任何深色数值**。

### 7.4 其余可访问性要点（逐条核实）

| 项 | 事实 | 锚点 |
|---|---|---|
| 图标 | 一律内联 SVG（4 个 glyph：ServerGlyph / RefreshGlyph / PlusGlyph / ImportGlyph），均带 `aria-hidden="true"` + `focusable="false"`，跟随 `currentColor`；**无 emoji、无字形符号** | `LV` L60-L102 |
| 状态双通道 | 色点 `aria-hidden="true"` 不参与朗读，状态文字由徽章文本承担 | `LV` L107-L110 |
| 异步播报 | 错误横幅 `role="alert"`（`LV` L376-L377、`EV` L361）；成功横幅 `role="status"`（`LV` L378）；探活结果 `role="status"` + `aria-live="polite"`（`LV` L181-L182、`EV` L454-L455）；确认条 `role="alertdialog"` + `aria-live="assertive"`（`EV` L461） | 同左 |
| 开关语义 | `role="switch"` + `aria-checked` + `aria-label`（服务器级与工具级各一处）；busy 时 `aria-busy` | `LV` L198-L205、`EV` L99-L107 |
| 表单标签 | 编辑视图 10 处、导入面板 1 处、工具行下拉 1 处，**全部** `htmlFor` + `id` 配对 | `EV` L367-L421、`LV` L456-L458、`LV` L405-L408 |
| 选中态语义 | chip 与分段按钮均带 `aria-pressed`；容器带 `role="group"` + `aria-label` | `LV` L353-L371、`LV` L382-L393、`EV` L356-L358 |
| 图标按钮可读名 | 刷新按钮 `aria-label` + `title`（`LV` L420-L421）；拉伸按钮 `aria-label`（`LV` L155）；面包屑根 `aria-label`（`EV` L345） | 同左 |
| 遮罩装饰 | `.ms-switch-slider` `aria-hidden="true"`；面包屑分隔符 `aria-hidden="true"` | `LV` L207、`EV` L348 |
| 待补 | `.ms-textarea:disabled` / `.ms-json:disabled` 无样式；busy 开关未设 `disabled`（键盘仍可切换）；`.ms-field-hint` 无 `aria-describedby`；`.ms-breadcrumb-root` 命中区 <24px；`.ms-confirm` 的 `role="alertdialog"` 无 `aria-label` / `aria-labelledby` | §4.17、§4.13、§4.18、§4.14、§4.20 |

<a id="forbidden"></a>
## 8. 禁止清单

每条给出：禁令 → 当前实例（含位置）→ 风险 → 建议。**所有建议均未落地。**

### 8.1 禁止硬编码颜色（`var()` 之外的颜色字面量）

- **禁令**：颜色只能出现在 `var(--dsw-alias-*, 回退)` 的回退位；`var()` 之外不得出现颜色字面量
  （`docs/DEVELOPMENT.md` §6 第 3 条，L614）。
- **当前实例（1 处）**：`style.css` **L485** `.ms-switch-slider::before { background: #fff; }`
  ——开关滑块填充，是**全文唯一**的 `var()` 之外颜色字面量。
- **核实方法**：全文 `#` 色值共 55 行，其中 54 行位于 `var()` 的回退位或注释内；
  仅 L485 独立成值。`rgb(` / `hsl(` 独立字面量 **0 处**（全部出现在 `var()` 回退位内）。
- **风险**：滑块填充不受主题控制。深色主题下若宿主把前景体系翻转为浅色，
  白色滑块与开启态轨道（`state-success-primary`）之间仅 2.28:1（§7.3），
  在深色主题下可能进一步失去辨识；主题换色时这一处会与整体脱节。
- **建议**：滑块改用与主题同源的前景 token。方向：`label-primary-foreground`
  （已在 4 处使用、语义就是「主填充面上的前景」，与滑块的角色一致）或宿主定义的
  `bg-layer-1`。**落地前须在明暗双主题下实测确认该 token 在滑块位置的可读性**。

### 8.2 禁止把 `state-*-primary` 当正文色（对比度不足）

- **禁令**：`state-*-primary` 只做色点 / 描边 / 图标等语义点缀；文字一律用
  `label-primary` / `label-secondary`（文件头注释 L13-L15；§1.2 T8）。
- **当前实例（5 处）**：

| 类 | 位置 | 字号 | 回退口径对比度 | 风险 |
|---|---|---|---|---|
| `.ms-error-banner` | L65 | 13px | 3.94:1 | 低于正文 4.5:1 |
| `.ms-probe-fail` | L439 | 12px | 3.94:1 | 同上 |
| `.ms-badge-danger` | L419 | 12px | 3.94:1 | 同上 |
| `.ms-card-error` | L358 | 12px | 3.94:1 | 同上 |
| `.ms-btn-danger` | L245 | 13px | 4.4976:1（白底，临界不达标）；悬停态 4.08:1（L250 淡底） | 低于正文 4.5:1 |

- **建议**：文字改 `label-primary`（18.90:1）或 `label-secondary`（5.80:1），
  把状态色留在**淡底、描边、色点**上。若必须保留彩色文字，则只用于 ≥18.66px 粗体 /
  ≥24px 的大字场景（本插件当前无此字号）。
- **附带（纪律不一致，非对比度问题）**：危险**淡底**三处走
  `interactive-bg-hover-danger`（L64、L418、L438）而非 `state-error-tertiary`，
  与成功 / 警告侧（`state-success-tertiary` L69/L433、`state-warn-tertiary` L681）不一致；
  `.ms-confirm` 描边走 `state-warn-secondary`（L680）而非 `state-*-primary`。
  **建议**统一到 `state-*-tertiary`（淡底）/ `state-*-primary`（描边）体系。

### 8.3 禁止用写死的 `#fff` 做不受主题控制的填充

- **禁令**：不得用字面量 `#fff` 作为填充 / 前景；主填充面上的字一律用
  `label-primary-foreground`（文件头注释 L11-L12：「写死 `#fff` 会在深色主题变成白底白字」）。
- **当前实例（1 处真违规 + 4 处合规回退）**：

| 位置 | 写法 | 判定 |
|---|---|---|
| **L485** `.ms-switch-slider::before` | `background: #fff;` | **违规**（同 §8.1，唯一独立字面量） |
| L163 / L229 / L255 / L570 | `color: var(--dsw-alias-label-primary-foreground, #fff);` | **合规**——`#fff` 是 `var()` 回退位，且主按钮 / 分段激活 / 模式激活三处都已 token 化，**未出现**旧形态那种「主按钮底 token 化、字仍写死 `#fff`」的半迁移 |

- **建议**：仅需处理 L485 一处（方案见 §8.1）。这四处回退值 `#fff` 保留，
  因为 `label-primary-foreground` 在浅色语义下就是白色。

### 8.4 禁止删除焦点指示或只做「去 outline」的一半

- **禁令**：任何 `outline: none` 必须与可见的替代焦点指示成对出现。
- **当前实例**：全文 `outline: none` **2 处**——`.ms-search` L184、`.ms-input/.ms-textarea/.ms-json:focus`
  L625。**两处均已由 `.ms-page :focus-visible`（L785）覆盖**，不构成违规（§7.1）。
- **风险**：这层保护是**单点依赖**——若 `.ms-page` 类名变更或该规则被移动 / 删除，
  两处 `outline: none` 会静默退化为「无任何焦点指示」，且不会有任何测试报警。
- **建议**：①在该全局规则旁加注释，声明它承担了 L184 / L625 两处 `outline: none` 的兜底；
  ②新增组件若自带 `outline: none`，必须同时给出自身或父级的 `:focus-visible` 规则，
  不得依赖「碰巧被全局规则覆盖」。

### 8.5 禁止新增无 `ms-` 前缀的类名或全局选择器

- **现状**：122 个规则块全部 `.ms-` 前缀，符合纪律（`style.css` L4）。
- **命名破口**：`.ms-mode-active`（L568）脱离 `.ms-mode-switch` 家族；
  `.ms-tool-name-off`（L778）用 `-off` 后缀而非状态后缀体例（§2.2）。
- **建议**：新组件一律 `<块>-<元素/修饰符>` 且以 `ms-` 开头；不要出现 `body` / `*` / `#id` /
  `!important`（当前均为 0 处，保持）。唯一的全局后代选择器 `.ms-page :focus-visible`（L785）
  属有意设计，新增时需同样以页面根类收窄作用域。

### 8.6 禁止把颜色写进 TSX 内联样式

- **现状**：`ListView.tsx` L108 用 `style={{ background: statusDot(props.status) }}` 注入色点颜色，
  是全仓唯一内联样式（`style={{` 仅 1 命中）。
- **判定**：颜色值本身来自 `var()`（`constants.ts` L35-L40 的 `dot` 字段），**合规**；
  但**注入方式**绕过了样式层，且这套回退值与 CSS 侧不同源（§1.4）。
- **建议**：改为 `data-status={server.status}` + CSS 属性选择器（`.ms-dot[data-status="connected"]`），
  让颜色与尺寸同层管理，顺带消除回退值双源问题；**落地前须先补 `.ms-dot` 的基础规则**
  （当前它只在 `.ms-badge .ms-dot` 上下文里有尺寸，§2.4）。

### 8.7 禁止覆盖宿主主题变量或改动宿主 viewport 约定

- **现状**：0 处自定义属性声明（无 `--` 属性定义）、0 处 `env(safe-area-inset-*)` 依赖。
- **依据**：`docs/DEVELOPMENT.md` §7 第 3 条（L638）「禁止改宿主 viewport meta」。
- **建议**：需要新色时先向宿主 token 表要，不在插件内定义 `--dsw-alias-*`；
  确需自定义变量时用插件私有前缀（如 `--ms-*`），不得占用 `--dsw-` 命名空间。

### 8.8 禁止把浮窗时代的跨包约定写进新样式

- **现状**：本形态已无浮窗实现——`style.css` 中 `z-index` 仅用于卡片内的三层堆叠
  （`.ms-card-hit` 1 / `.ms-card-glyph`·`.ms-card-body` 0 / `.ms-card-actions` 2），
  是**卡片内局部层级**而非跨包基准；无 `data-*-bp`、无 `offsetY`、无 `visualViewport` 监听。
- **依据**：`docs/DEVELOPMENT.md` §7（L621-L648）整段以「带浮窗胶囊的插件」为前提。
- **建议**：新样式不得引入 z-index 基准值、`data-*-bp` 断点属性、`offsetY` 避让等机制；
  卡片内的 `z-index` 只服务局部堆叠，数值不对外构成契约。§7 第 5 条（触控目标 / `@media(hover:hover)`）
  跨形态仍然适用，按 §5.3 落地。

### 8.9 禁止用文本字符当图标

- **现状**：**已修复**——4 个图标全部改为内联 SVG，跟随 `currentColor` 与主题变量
  （`LV` L60-L102，均带 `aria-hidden="true"` + `focusable="false"`）；文件头注释 L11 明确
  「图标一律内联 SVG（不用 emoji / 字形符号）」。
- **保留项**：面包屑分隔符 `U+203A`（`EV` L348）是排版字符而非图标，已 `aria-hidden="true"`，保留合理。
- **建议**：新增图标继续走内联 SVG（16 / 18 / 24px 网格），保持 `currentColor` + `aria-hidden="true"`
  + `focusable="false"` 三件套；**不得**退回 emoji 或字形符号（`docs/DEVELOPMENT.md` §6 第 1 条
  的三 OS 兼容面要求，L599-L605）。

### 8.10 禁止绕过刻度引入一次性值

- **现状**：本形态的取值已基本收敛到台阶内（§3），但仍有个别一次性值：
  `.ms-confirm-text` 的 `flex: 1 1 260px`（L687）、`.ms-import-scope` 的 `max-width: 520px`（L711）、
  `.ms-tools-list` 的 `max-height: 320px`（L754）、`.ms-empty` 的 `padding: 32px`（L386）。
- **判定**：这四处均为**局部约束值**（布局 flex 基数 / 面板最大宽 / 滚动区最大高 / 大内边距），
  不属字号 / 圆角 / 间距刻度范畴，**可接受**，但应集中登记以免继续扩散。
- **建议**：新增值先登记进 §3 的台阶表或本节清单；字号 / 圆角 / 间距不得引入表外值。

<a id="extend"></a>
## 9. 新增组件扩展规则与自查清单

### 9.1 落地位置（写进 `style.css` 哪一段）

按现有 13 段结构（§2.3）就近归位：

| 新增内容类型 | 归位段 | 说明 |
|---|---|---|
| 页面级容器 / 标题 / 说明 | 1 骨架 | 若引入新的页面根类，必须同时评估 `.ms-page :focus-visible`（L785）的覆盖面 |
| 全局提示 / 通知 | 2 横幅 | 语义色只走淡底 + `label-*` 文字 |
| 过滤器 / 图例 | 3 筛选条 | 用 `.ms-chip` 族，勿新建平行族 |
| 工具行内的控件 | 4 工具行 | 分段控件用 `.ms-seg` 族（勿再起 `.ms-mode-switch` 式的平行族） |
| 可点击动作 | 5 按钮 | 优先复用 `.ms-btn` + 变体；确需新变体时后缀语义见 §2.2 |
| 列表项 / 容器 | 6 分组与卡片 | 卡片内可点元素必须走拉伸按钮模式（§7.2） |
| 语义标签 / 状态呈现 | 7 徽章与探活 | 三态齐全（成功 / 失败 / 中性进行中） |
| 二值开关 | 8 开关 | 复用 `.ms-switch`，勿新建开关 |
| 编辑页布局 | 9 编辑页 | 字段必须 `htmlFor` + `id` 配对 |
| 批量输入面板 | 10 导入面板 | 复用 `.ms-form-card` 作容器 |
| 列表型面板 | 11 工具面板 | 分隔线用 `border-l1` |
| 焦点 / 动效降级 | 12 可访问性 | 所有 `outline` 与 `prefers-reduced-motion` 规则集中在此段 |
| 窄屏适配 | 13 响应式 | 新增断点行为只加进现有的 `@media (max-width: 720px)` 块，**不新开断点** |

### 9.2 需要哪些 token（选择顺序）

1. **结构性前景**：`label-primary` → `label-secondary` → `label-tertiary`（三级，按信息层级取）。
2. **结构性描边**：容器 `border-l2`；控件 `border-l4`；列表内分隔线 `border-l1`。
3. **结构性底**：控件底 `bg-layer-1`（配 `border-l4`）；悬停 `interactive-bg-hover`；
   选中 / 强调 `interactive-bg-hover-accent`；主填充 `button-primary-fill` + 其悬停 `button-primary-hover`。
4. **主填充面上的字**：`label-primary-foreground`（**禁止**用 `#fff` 字面量）。
5. **状态**：`state-{success,error,warn,business}-primary` 做色点 / 描边；
   `state-{success,error,warn}-tertiary` 做淡底；焦点环 `state-business-primary`；链接 `link`。
6. **回退值**：从 §1.4 的统一回退表取值；同一 token 不得出现第二套回退。
7. **需要新 token 时**：先确认宿主存在（DevTools 读取 computed value），再写入 §1.1 表；
   **不得**在插件内定义 `--dsw-*`（§8.7）。

### 9.3 必须补齐的状态与窄屏规则

- **交互态**：默认 / `:hover`（**包 `@media (hover: hover)`**，§5.3）/ `:focus-visible`（或确认被
  `.ms-page :focus-visible` 覆盖）/ `:disabled`。
- **语义态**：成功 / 失败 / **进行中（中性）** 三态齐全——`.ms-probe-*` 已是范式。
- **窄屏**：按 §5.2 的 720px 清单逐条确认；可点元素 ≥24px；窄屏主操作 ≥36px。
- **动效**：新动效走 §6.3 时长刻度，并**同步扩充** L790 的 `prefers-reduced-motion` 选择器列表。
- **可访问名**：图标按钮 / 拉伸按钮 / 开关必须有 `aria-label`；表单控件必须有 `htmlFor` + `id`
  或 `aria-label`；异步结果必须有 `role="status"` / `role="alert"`。

### 9.4 门禁命令

改动 `src/client/style.css` 或 `src/client/page/*.tsx` 属「手写源码」，按下表取层
（口径见仓库 `AGENTS.md` 的「门禁」段，命令均已核实存在于根 `package.json`）：

| 层 | 命令 | 何时用 |
|---|---|---|
| 快线 | `pnpm gate:changed` | 迭代中反复跑：只跑 diff 命中包的 build + test + typecheck |
| 最小集 | `pnpm gate:pr` | 开 PR 前：快线 + 命中包的产物闸 + 廉价全仓一致性闸（含 `lint`、`docs:check`） |
| 收尾 | `pnpm gate:full` | 改过构建链 / 包结构 / 发版前跑一遍 |
| 文档 | `pnpm docs:check` | 只改文档（如本文）时至少跑这条：锚点可解析、无 emoji、反引号内 `pnpm <script>` 真实存在 |
| 提交钩子 | `lefthook`（`pre-commit` / `commit-msg`） | 提交瞬间对 staged 源文件跑 `lint` + 校验 Conventional Commits；**不替代上面任何一层** |

样式改动**额外**要求（`docs/DEVELOPMENT.md` §6 L617-L619）：客户端交互改动须在
**明暗双主题 + 窄屏（pad / phone）**下实测 DOM（DevTools 或浏览器自动化 MCP）。

### 9.5 自查清单（提交前逐条打勾）

- [ ] 类名 `ms-` 前缀，无全局选择器 / 无 `!important` / 无 ID 选择器。
- [ ] 颜色全部来自 `var(--dsw-alias-*, 回退)`，**无裸色值**（本文 §8.1 登记的唯一残留 L485 不得扩散）。
- [ ] 回退值与 §1.4 的统一表一致；同一 token 只有一套回退。
- [ ] 配对纪律符合 §1.2 T1-T11（输入框 `border-l4` + `bg-layer-1`、卡片 `border-l2`、分隔线 `border-l1`、悬停 `interactive-bg-hover`、主按钮 `button-primary-fill` + `label-primary-foreground`）。
- [ ] 状态色只出现在色点 / 描边 / 淡底，正文用 `label-*`（§8.2）。
- [ ] 有焦点指示：自带 `:focus-visible` 或确认被 `.ms-page :focus-visible` 覆盖；**没有**只做 `outline: none` 的半套写法。
- [ ] 键盘可达：原生控件优先；自定义可点元素必须走拉伸按钮模式（`role` + 可读名 + `z-index` 分层）。
- [ ] 可访问名齐备：图标按钮 / 开关 / 拉伸按钮有 `aria-label`；表单控件有 `htmlFor` + `id`。
- [ ] 异步结果有播报：`role="alert"` / `role="status"`（+ `aria-live`）。
- [ ] 触控目标 ≥24px（窄屏主操作 ≥36px），或伪元素外扩热区。
- [ ] `:hover` 已包 `@media (hover: hover)`（§5.3）。
- [ ] 窄屏（<720px）下不溢出、关键操作可达，行为已登记进 §5.2 清单。
- [ ] 新动效有 `prefers-reduced-motion` 覆盖（§6.2）。
- [ ] 明暗双主题 + 窄屏实测（`docs/DEVELOPMENT.md` §6 L617-L619）。
- [ ] 文档锚点 / 链接有效（改了文档跑 `pnpm docs:check`）。
- [ ] 门禁：`pnpm gate:pr`（含 `lint` / `docs:check`）；单包迭代可先用 `pnpm gate:changed`。

<a id="appendix-a"></a>
## 附录 A：事实源形态差异（main 与 feat）

**背景**：仓库主 checkout 在本次会话进行中被另一位会话切换了分支——reflog 记录
**14:43 从 `feat/settings-page-ux-a11y` 切到 `task/p0-peer-range-gate`**。
因此「读仓库 checkout 得到的形态」与「用户请求时眼前的形态」可能不是同一份。
本附录把两种形态在**样式层面**的关键差异列成一张表，供任何文档 / 评审对照使用。

| 维度 | main 形态（旧 checkout） | feat 形态（本文事实源，`feat/settings-page-ux-a11y @ 6a66f75`） |
|---|---|---|
| `style.css` 行数 | 454 行 / 9006 字节 | **851 行 / 18649 字节** |
| `@media` 媒体查询 | **0 处** | **2 处**：`prefers-reduced-motion: reduce`（L790）、`max-width: 720px`（L799） |
| `prefers-reduced-motion` | 无 | 有（L790-L795，覆盖开关两处过渡） |
| `:focus-visible` | **0 处** | **3 处**：`.ms-card-hit:focus-visible` L310、`.ms-switch input:focus-visible + .ms-switch-slider` L497、`.ms-page :focus-visible` L785 |
| 卡片拉伸按钮 `.ms-card-hit` | **不存在**（整卡是可点击 `div`，无 `role` / `tabIndex`） | **存在**（L299-L313，原生 `<button>` + `aria-label` + `z-index` 分层 + `:focus-visible`） |
| 开关尺寸 | **36x20**（滑块 16x16，`left/top: 2px`，位移 16px） | **40x24**（滑块 18x18，`left/top: 3px`，位移 16px） |
| `min-height` 声明 | **0 处** | **8 处**（chip 30px；控件 32px ×6；窄屏 36px） |
| 分层注释 | 6 段（工具行 / 按钮 / 分组与卡片 / 探活结果 / 启停开关 / 编辑视图） | **13 段**（骨架 / 横幅 / 筛选条 / 工具行 / 按钮 / 分组与卡片 / 徽章与探活 / 开关 / 编辑页 / 导入面板 / 工具面板 / 可访问性 / 响应式） |
| 页面容器宽度 | `max-width: 860px` | **`max-width: 920px`** |
| 组件族 | 无筛选条 / 徽章 / 导入面板 / 工具面板 | **新增**：`.ms-filters` + `.ms-chip*`、`.ms-seg*`、`.ms-badge*` + `.ms-dot`、`.ms-probe-pending`、`.ms-confirm*`、`.ms-import*` + `.ms-check`、`.ms-tools*` + `.ms-tool-row` / `.ms-tool-name*`、`.ms-btn-icon` / `.ms-btn-danger-solid`、`.ms-card-hit` / `.ms-card-glyph` / `.ms-card-head` / `.ms-card-error`、`.ms-ok-banner`、`.ms-mode-label` |
| `role` / `aria-live` 播报 | 客户端源码中 `role=` **0 命中**（错误横幅与探活结果对读屏静默） | `role="alert"` ×3、`role="status"` ×2（含 `aria-live="polite"`）、`role="switch"` ×2（+ `aria-checked`）、`role="group"` ×2、`role="alertdialog"` ×1 |
| 表单标签关联 | **无** `htmlFor` / `id` 配对 | **全部配对**（编辑页 10 处 + 导入面板 1 处 + 工具行下拉 1 处） |
| 图标实现 | 文本字符（齿轮 `U+2699`、刷新 `U+27F3`） | **内联 SVG**（4 个 glyph，`aria-hidden` + `focusable="false"` + `currentColor`） |
| 删除确认 | `window.confirm` 阻塞对话框 | 页内确认条 `.ms-confirm`（`role="alertdialog"`） |
| **Token 命名体系** | `line-secondary` / `bg-primary` / `bg-hover` / `brand-primary` / `state-error-secondary` / `state-success-secondary` / `state-warn-primary` | **`border-l1` / `border-l2` / `border-l4` / `bg-layer-1` / `interactive-bg-hover` / `interactive-bg-hover-accent` / `interactive-bg-hover-danger` / `button-primary-fill` / `button-primary-hover` / `label-primary-foreground` / `link` / `state-*-tertiary` / `state-warn-secondary` / `state-business-primary`（焦点环）** |
| Token 引用规模 | 45 处 / 11 个变量名 | **88 处 / 20 个变量名** |

### A.1 Token 体系差异是两形态最本质的分界（已核实）

对 feat 导出副本逐名精确检索，**main 形态的 token 名在 feat 形态中命中数全为 0**：

| main 形态 token 名 | 在 feat 形态 `style.css` 中的精确命中数 |
|---|---|
| `--dsw-alias-line-secondary` | 0 |
| `--dsw-alias-bg-primary` | 0 |
| `--dsw-alias-bg-hover` | 0 |
| `--dsw-alias-brand-primary` | 0 |
| `--dsw-alias-state-error-secondary` | 0 |
| `--dsw-alias-state-success-secondary` | 0 |
| `--dsw-alias-state-warn-primary` | 0 |

反向亦然：feat 形态的 `border-l*` / `bg-layer-1` / `button-primary-fill` /
`label-primary-foreground` / `interactive-bg-hover*` / `link` / `state-*-tertiary` /
`state-warn-secondary` 在 main 形态中均不存在。

**这意味着两形态的 token 清单无法互推**——按 main 形态写出的 token 表、配对纪律、
禁止清单实例行号，对 feat 形态**全部失效**（这正是上一版规范失效的根因）。

### A.2 使用本文档时的形态判定步骤

1. 取当前 `src/client/style.css` 的行数与 SHA256（方法见 [附录 B](#appendix-b)）。
2. 与 §0.1 的 `851 行 / 18649 字节 / D5764705...` 比对。
3. 一致 → 本文行号锚点有效；不一致 → **先判定是哪一形态**：
   - 精确检索 `--dsw-alias-border-l2`：命中 → feat 系形态；0 命中 → main 系形态。
   - 精确检索 `.ms-card-hit`：命中 → 含拉伸按钮；0 命中 → 旧形态。
4. 若为 main 系形态，本文正文（§1-§9）的行号、token 表、禁止清单实例**均需整体重做**，
   不得局部沿用。

<a id="appendix-b"></a>
## 附录 B：本文断言的核对方法

本文所有行号、计数、缺席结论都可用下列只读方式复现。
`<feat>` = `feat/settings-page-ux-a11y @ 6a66f75` 的只读导出副本路径，
`<repo>` = 仓库根（仅供对照，**不要**在非该分支时用它核对本文行号）。

```text
# 1. 快照核对（行数 / 字节 / 哈希 / 行尾）
$p = "<feat>\packages\dsh-mcp-servers\src\client\style.css"
(Get-Content -LiteralPath $p).Count                      # 期望 851
(Get-Item -LiteralPath $p).Length                        # 期望 18649
(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash    # 期望 D576470536A4C17482BCDC27077EE8731072607FBA03B0140A3575D0296C7718

# 2. token 穷举（88 处引用 / 20 个变量名）
$c = Get-Content -LiteralPath $p -Raw
[regex]::Matches($c,'--dsw-alias-[a-z0-9-]+').Count
[regex]::Matches($c,'--dsw-alias-[a-z0-9-]+') | ForEach-Object { $_.Value } | Group-Object | Sort-Object Name

# 3. 结构断言（@media / focus-visible / min-height / !important / transition / outline）
Select-String -LiteralPath $p -Pattern "@media|prefers-reduced-motion|focus-visible|!important|min-height|transition|outline" |
  ForEach-Object { "$($_.LineNumber): $($_.Line.Trim())" }
# 期望：@media 2 处；focus-visible 3 处；min-height 8 处；!important 0 处；transition 3 处；outline 8 行

# 4. 硬编码颜色（应只剩 L485 一处独立字面量）
Select-String -LiteralPath $p -Pattern "#[0-9a-fA-F]{3,8}|rgb\(|hsl\(" |
  ForEach-Object { "$($_.LineNumber): $($_.Line.Trim())" }

# 5. 形态判定（见附录 A.2）：feat 系形态应命中，main 系形态应 0 命中
foreach ($t in @('--dsw-alias-border-l2','--dsw-alias-bg-layer-1','--dsw-alias-button-primary-fill','.ms-card-hit')) {
  "$t = " + (Select-String -LiteralPath $p -Pattern ([regex]::Escape($t)) -SimpleMatch).Count
}
foreach ($t in @('--dsw-alias-line-secondary','--dsw-alias-bg-primary','--dsw-alias-brand-primary')) {
  "$t = " + (Select-String -LiteralPath $p -Pattern ([regex]::Escape($t)) -SimpleMatch).Count
}

# 6. 对比度（本文 §7.3 的口径：WCAG 2.x 相对亮度；rgba 淡底按 alpha 与白底合成）
#    用任意实现该公式的计算器复算 §7.3 的组合即可。
#    务必标注「按浅色回退值计算」——本文不提供深色主题实测值。
```

**口径声明**：本文全部数值均为**只读静态核对**的结果（读文件 + 计算），
**未执行**构建 / 测试 / lint / 浏览器实测，**未修改**任何源码或样式。

---

[UI/UX 设计文档](./ui-design.md)

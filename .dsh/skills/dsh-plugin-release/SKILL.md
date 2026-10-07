---
name: dsh-plugin-release
description: >
  dsh-plugin-hub 的发版执行规程（项目级 skill）：推 tag 触发 release.yml 的完整链路、
  release notes 的中英分节与「双锚补位」跳转导航写法、版本一致性校验与回退。
  触发信号：用户要求发版/发布/打 tag、写或更新 docs/release-notes/vX.Y.Z.md、
  修订 release notes 的语言导航锚点、排查 release.yml 失败。
  Do NOT trigger for: 日常功能开发（按 docs/DEVELOPMENT.md 开发规范）、PR 评审（用 dsh-plugin-hub-pr-review）、
  纯版本号 bump 咨询。
---

# dsh-plugin-release — 发版执行规程

> 红线：**`v*` tag 只由维护者推送**，agent 不得推送 tag、不得为绕过校验而改包版本号。
> 发布产物与 GitHub Release 由 tag 触发，不可逆——推送前逐项核对本规程。

## 0. 发版链路

`.github/workflows/release.yml`：推 `vX.Y.Z` tag → ① 校验**全包**版本 == tag
（`scripts/release/verify-version.ts`）→ ② 全量门禁 → ③ `pnpm publish` →
④ 创建 GitHub Release（**优先引用 `docs/release-notes/vX.Y.Z.md`**，缺失则回退 GitHub 自动 notes）。

因此 release notes 必须在打 tag 前入库；版本号由发版提交统一 bump，**不要**在日常 PR 里
顺手改版本号绕过 tag 校验。

## 1. 发版步骤（维护者执行，agent 只做 1–3）

1. 全量门禁绿：`pnpm build && pnpm test && pnpm contract && pnpm pack:check && pnpm typecheck`
   + `pnpm verify:npmlayout`（发版全量产物闸）。
2. bump 全部包版本到目标 `vX.Y.Z`（含 peer 与 catalog 的锁步检查）。
3. 写 `docs/release-notes/vX.Y.Z.md`（见 §2–§3），随 `chore(release): vX.Y.Z` 提交。
4. 维护者推 tag：`git tag vX.Y.Z && git push origin vX.Y.Z`；随后核对 Release 页渲染。

## 2. release notes 结构（硬性）

- **每版入库**为 `docs/release-notes/vX.Y.Z.md`（入库起点 v0.1.8；v0.1.3–v0.1.7 为历史遗留，
  不再补录）。
- 内容来源：上一 tag 至今的**常规提交**（不含发版提交自身）。
- **中英各自成节分开呈现**，不逐条混排；**禁止 emoji**。

## 3. 语言跳转导航：双锚补位写法（已实测，勿"简化"）

各渲染器标题 slug 规则不一，中文锚点不可靠；且 GitHub sanitizer 会把 HTML `id`/`name`
一律改写为 `user-content-` 前缀，致 `href="#zh"` 落空，而 Release 页 heading 又无自动 id。
所以：**href 直写前缀形态，分节处双锚补位**——GitHub 命中被改写的首个锚，第三方渲染器
命中字面 id 的第二个锚，全场景可跳。

头部：

```markdown
> **[中文](#user-content-zh)** · **[English](#user-content-en)**
```

分节前（中英各一处）：

```html
<a id="zh"></a><a id="user-content-zh"></a>
<a id="en"></a><a id="user-content-en"></a>
```

样板可对照 `docs/release-notes/v0.2.3.md`（最新一版已按此落地）。

## 4. 收尾核对

- `docs/release-notes/vX.Y.Z.md` 的相对链接与 `pnpm docs:check` 通过。
- Release 页两处跳转都实测可点（GitHub 页 + 本地/第三方预览各一次）。
- 版本适配声明（根 README「版本适配（只适配 rc）」）若本次调整了适配基线，同步更新；
  基线唯一事实源是 `pnpm-workspace.yaml` catalog。
- 失败回退：Release 未生成时不要重推同 tag，先查 release.yml 日志；已发布的 npm 版本
  不可撤回，用 `scripts/release/publish-if-missing.ts` 的幂等语义重新执行管线。

## 5. NPM_TOKEN 补发（tag 已推、npm 未发布时）

`release.yml` 的 `Check npm token` 步骤在 `NPM_TOKEN` 缺失时**跳过** npm 发布并在 run 里留
notice；tag 版本校验、全量门禁、GitHub Release 三步照常完成。此时包处于「已发布 tag、
未发布 npm」形态——**不要重推 tag**，按下面顺序补发：

1. **配置 secret（维护者，一次性）**：npm 生成 @dunlingzi scope 的 automation token
   （Access Tokens → Generate New Token → Automation），写入仓库
   Settings → Secrets and variables → Actions → New repository secret，名称必须为 `NPM_TOKEN`。
2. **确认版本与 tag 一致**：`packages/dsh-mcp-servers/package.json` 的 `version` 必须等于
   tag 去掉 `v`（`Verify versions` 步骤会再校验一次，不一致在 publish 之前即中止）。
3. **重跑同一 tag 的 run（幂等，不新增 tag）**：

   ```sh
   gh run list --workflow=release.yml --limit 10   # 找该 tag 的 run id
   gh run rerun <run-id>                           # 完整校验 + 门禁 + publish + Release
   ```

   `release.yml` 只监听 `tag push`、没有 `workflow_dispatch`，故只能 rerun 既有 run，
   不能用 `gh workflow run`。secrets 在 run 执行时解析，补配后再 rerun 即生效。
4. **核对发布结果**（本机默认 registry 是镜像，必须显式带 `--registry`，否则可能读到滞后结果）：

   ```sh
   npm view @dunlingzi/dsh-mcp-servers version --registry=https://registry.npmjs.org
   npm view @dunlingzi/dsh-mcp-servers versions --registry=https://registry.npmjs.org
   ```

5. **幂等语义**：`scripts/release/publish-if-missing.ts` 逐包 `npm view <pkg>@<ver>`——已存在
   即跳过（stderr 记 `已存在，跳过: <pkg>@<ver>`），只把缺失的包名打到 stdout 交给
   `pnpm --filter <pkg> publish`。故 rerun 与重复触发都安全。**绝不 `npm unpublish`**
   （会打断已安装方的解析）；发错了只能 `npm deprecate` 并在下一版修正。
6. **刷新 Release body**：补发后把 `docs/release-notes/<tag>.md` 头部的「发布的形态」段
   （若之前标了「不含 npm 发布」）改写为已发布；rerun 时 `Create GitHub Release` 步骤会对
   同一 tag 的 Release 执行更新，body 取该文件。

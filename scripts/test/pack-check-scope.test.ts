// @ts-nocheck
'use strict'

/**
 * pack-check 切片口径的回归（#722 门禁分层）。
 *
 * 单插件仓库：无 dsh-plugins-all 聚合包专项（历史实现见 dsh-plugin-hub）。
 * 本测试锁死的语义：
 *   1. 增量切片（--packages 命中登记包）⇒ exit 0（产物就绪时），且只逐包检查切片内包；
 *   2. 切片含未登记包名 ⇒ fail-loud（resolvePackageScopeOrExit 拒绝未知包）；
 *   3. 全仓口径（未传 --packages）⇒ exit 0（产物就绪时）。
 *
 * 产物前提：`test:scripts` 只保证 `script-test-prereqs.mjs` 登记的包被构建
 * （dsh-mcp-servers）。切片用例必须取 PREREQ 包，否则在 CI 增量口径
 * （只还原 HIT 产物 + 只构建 PREREQ 包）下会因无产物而判红。
 *
 * 成本：全仓口径会真实 `pnpm pack` 各包（约 12-15s），故该口径只在模块内跑一次、共享结果。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PACK_CHECK = join(ROOT, 'scripts', 'gate', 'pack-check.ts')

/** 切片代表包：取自 `script-test-prereqs.mjs` 的 PREREQ 清单（见文件头「产物前提」）。 */
const SLICE_PKG = 'dsh-mcp-servers'

/** 跑 pack-check 并返回 { status, stdout }（非 0 也要拿到输出，不抛）。 */
function runPackCheck(args) {
  try {
    const stdout = execFileSync(process.execPath, [PACK_CHECK, ...args], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' })
    return { status: 0, stdout }
  } catch (e) {
    return { status: e.status ?? 1, stdout: `${e.stdout ?? ''}` }
  }
}

test('增量切片：命中登记包 → exit 0（产物就绪）', () => {
  const { status, stdout } = runPackCheck(['--packages', SLICE_PKG])
  assert.equal(status, 0, `增量切片应 exit 0，实际 ${status}\n${stdout}`)
  assert.match(stdout, /PASS plugins-manifest \| 目录集 == manifest\.active ∪ standalone 集/, 'manifest 一致性前置闸恒跑')
  assert.match(stdout, new RegExp(`PASS @dunlingzi/${SLICE_PKG}`), `切片包 ${SLICE_PKG} 应逐包 PASS`)
})

test('切片含未登记包名 → fail-loud（不得静默忽略）', () => {
  const { status, stdout } = runPackCheck(['--packages', 'dsh-notifier'])
  assert.equal(status, 1, `未知包名切片应 exit 1，实际 ${status}\n${stdout}`)
  assert.match(stdout, /dsh-notifier/, '报错应点名未知包名')
})

test('全仓口径：exit 0（产物就绪时逐包全查）', () => {
  // 全仓口径只跑一次（真实 pack 各包，约 12-15s）：以下断言共享同一份输出。
  const { status, stdout } = runPackCheck([])
  assert.equal(status, 0, `全仓口径应 exit 0，实际 ${status}\n${stdout}`)
  assert.match(stdout, new RegExp(`PASS @dunlingzi/${SLICE_PKG}`), '全仓口径逐包 PASS')
  assert.doesNotMatch(stdout, /FAIL /, '全仓口径不得有 FAIL 行')
})

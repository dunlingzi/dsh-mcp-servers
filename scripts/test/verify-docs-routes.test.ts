#!/usr/bin/env node
// @ts-nocheck
/**
 * verify-docs 的「路由表一致性」面自测（#P5 尾项）。
 *
 * 为什么存在：本仓库的文档门禁此前只校验「相对链接 / 锚点 / pnpm 命令存在」，
 * 没有任何「文档声明的清单 == 源码常量」的判据——架构文档的路由表因此长期缺
 * servers/probe。本面把「README 路由表 == 源码 ROUTES」变成机器判据。
 *
 * fixture 刻意覆盖 README 的缩写形态 `a|b|c`（真实 README 就用它合并三条 connect 路由）：
 * 不展缩会把三条缩写当成一条，从而误红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = join(import.meta.dirname, '../..')
const GATE = join(ROOT, 'scripts/gate/verify-docs.ts')

/** 造 fixture：README 表格行 + routes.ts 的 ROUTES 块；sourceRoutes=null 表示不写 ROUTES。 */
function fixture({ readmeRoutes = [], sourceRoutes = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-docs-routes-'))
  const pkg = join(dir, 'packages/dsh-fake')
  mkdirSync(join(pkg, 'src/api'), { recursive: true })
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@x/dsh-fake', description: 'fixture' }))
  writeFileSync(
    join(pkg, 'README.md'),
    `# fake\n\n| 路由 | 说明 |\n|---|---|\n${readmeRoutes.map((r) => `| \`${r}\` | x |`).join('\n')}\n`,
  )
  writeFileSync(
    join(pkg, 'src/api/routes.ts'),
    sourceRoutes === null
      ? '// 无 ROUTES\n'
      : `export const ROUTES = {\n${sourceRoutes.map((r, i) => `  k${i}: "${r}",`).join('\n')}\n};\n`,
  )
  return dir
}

function run(dir) {
  try {
    return spawnSync(process.execPath, [GATE, '--root', dir], { encoding: 'utf8' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const R = (p) => `/api/dsh-mcp-servers/${p}`
/** 失败明细经 console.error 走 stderr（门禁约定），故断言看合并输出。 */
const out = (r) => `${r.stdout}${r.stderr}`

test('正例：README 表格与 ROUTES 逐项一致 → exit 0，且打印两侧计数', () => {
  const dir = fixture({
    readmeRoutes: [R('health'), R('servers'), R('servers/connect|disconnect|reconnect')],
    sourceRoutes: [R('health'), R('servers'), R('servers/connect'), R('servers/disconnect'), R('servers/reconnect')],
  })
  const r = run(dir)
  assert.equal(r.status, 0, `应判绿：\n${r.stdout}\n${r.stderr}`)
  assert.match(r.stdout, /路由表一致性：1 个包 \/ 5 条路由/, `应打印判据自述：\n${r.stdout}`)
})

test('反证：README 缺一条路由 → exit 1 且点名该路由', () => {
  const dir = fixture({
    readmeRoutes: [R('health')],
    sourceRoutes: [R('health'), R('servers/probe')],
  })
  const r = run(dir)
  assert.equal(r.status, 1, `应判红：\n${r.stdout}`)
  assert.match(out(r), new RegExp(`README 路由表缺 ${R('servers/probe').replace(/\//g, '\\/')}`), `应点名缺失项：\n${out(r)}`)
})

test('反证：README 多一条源码没有的路由 → exit 1 且点名「多」', () => {
  const dir = fixture({
    readmeRoutes: [R('health'), R('not-exist')],
    sourceRoutes: [R('health')],
  })
  const r = run(dir)
  assert.equal(r.status, 1, `应判红：\n${r.stdout}`)
  assert.match(out(r), /README 路由表多 \/api\/dsh-mcp-servers\/not-exist/, `应点名多余项：\n${out(r)}`)
})

test('fail-closed：README 无路由表 → exit 1（判据输入缺失，不得当成一致）', () => {
  const dir = fixture({ readmeRoutes: [], sourceRoutes: [R('health')] })
  const r = run(dir)
  assert.equal(r.status, 1, `应 fail-closed：\n${r.stdout}`)
  assert.match(out(r), /README 路由表解析为空/, `应报判据输入缺失：\n${out(r)}`)
})

test('fail-closed：routes.ts 无 ROUTES 块 → exit 1（另一侧同样不得空转）', () => {
  const dir = fixture({ readmeRoutes: [R('health')], sourceRoutes: null })
  const r = run(dir)
  assert.equal(r.status, 1, `应 fail-closed：\n${r.stdout}`)
  assert.match(out(r), /ROUTES 解析为空/, `应报判据输入缺失：\n${out(r)}`)
})

test('真实仓库：docs:check 通过且判据自述非零（防判据被摘除后静默绿）', () => {
  const r = spawnSync(process.execPath, [GATE, '--strict-en'], { encoding: 'utf8', cwd: ROOT })
  assert.equal(r.status, 0, `真实仓库应通过：\n${r.stdout}\n${r.stderr}`)
  assert.match(r.stdout, /路由表一致性：1 个包 \/ 12 条路由/, `真实仓库应覆盖 1 包 12 路由：\n${r.stdout}`)
})

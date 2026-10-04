#!/usr/bin/env node
// @ts-nocheck
'use strict'

/**
 * export-surface-snapshot（P1）自测：正反双向 + 搬移免疫 + 门面链 + fail-closed + 判据自述。
 *
 * 正向用真实仓库跑 CLI（须先 pnpm build——本包已在 script-test-prereqs 的前置包清单内）；
 * 反向用 mkdtemp 最小副本（不触碰真实仓库，符合测试产物零污染纪律 #218）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  collectEntry,
  collectPackageSurface,
  diffSurface,
  normalizeBlock,
  splitTopLevelStatements,
} from '../gate/export-surface-snapshot.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const GATE = join(ROOT, 'scripts', 'gate', 'export-surface-snapshot.mjs')

const DEP_BLOCK = 'export declare function b(x: number): string;\n'
const DEP_MOVED_BLOCK = 'export declare function b( x: number ) : string;\n' // 同语义、不同排版

/** 造最小包副本：packages/dsh-probe 的 exports + 入口 d.ts + 一个被 re-export 的依赖 d.ts。 */
function makeFixture({ entryExtra = '', depPath = 'dep', depBlock = DEP_BLOCK, entryTypes = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'export-surface-'))
  const pkgDir = join(dir, 'packages', 'dsh-probe')
  mkdirSync(join(pkgDir, 'lib'), { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name: '@probe/dsh-probe',
    exports: { '.': { types: './lib/index.d.ts', default: './lib/index.js' } },
  }, null, 2))
  if (entryTypes) {
    writeFileSync(
      join(pkgDir, 'lib', 'index.d.ts'),
      `export declare const name = "probe";\n${entryExtra}export { b } from "./${depPath}.js";\n`,
    )
  }
  mkdirSync(join(pkgDir, 'lib', dirname(depPath)), { recursive: true })
  writeFileSync(join(pkgDir, 'lib', `${depPath}.d.ts`), depBlock)
  return dir
}

function withFixture(options, fn) {
  const dir = makeFixture(options)
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const collect = (dir) => collectPackageSurface(dir, 'dsh-probe', '@probe/dsh-probe')

test('真实仓库：--check 退出码 0（快照与基线逐项一致）', () => {
  const run = spawnSync(process.execPath, [GATE, '--check'], { encoding: 'utf8' })
  assert.equal(run.status, 0, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`)
  assert.match(run.stdout, /一致：逐入口符号集与声明块多重集均与基线相同/)
  assert.match(run.stdout, /当前 \/ 基线：符号 \d+\/\d+/) // 自述取真实计数，不是写死的字符串
})

test('真实仓库：两个入口都被采集，且未解析为零', () => {
  const surface = collectPackageSurface(ROOT, 'dsh-mcp-servers', '@dunlingzi/dsh-mcp-servers')
  assert.deepEqual(Object.keys(surface.entries).sort(), ['.', './client'])
  assert.equal(surface.entries['.'].unresolved.length, 0, `实际: ${JSON.stringify(surface.entries['.'].unresolved.slice(0, 5))}`)
  assert.ok(surface.entries['.'].symbols.length > 100, `符号数 ${surface.entries['.'].symbols.length}`)
  assert.ok(surface.entries['./client'].augmentations.length > 0) // 客户端声明合并面在快照内
})

test('正向：同一份入口两次采集 → 无差异（防恒真）', () => {
  withFixture({}, (dir) => {
    const once = collect(dir)
    let twice = null
    withFixture({}, (dir2) => {
      twice = collect(dir2)
    })
    assert.deepEqual(diffSurface(twice.entries, once.entries), [])
    assert.deepEqual(once.entries['.'].symbols, ['value:b', 'value:name'])
  })
})

test('反证：新增导出符号 → 差异点名该符号', () => {
  withFixture({}, (dir) => {
    const before = collect(dir)
    withFixture({ entryExtra: 'export declare const extra = 1;\n' }, (dir2) => {
      const after = collect(dir2)
      const diffs = diffSurface(after.entries, before.entries)
      assert.ok(diffs.some((d) => /新增 symbols: value:extra/.test(d)), `实际: ${JSON.stringify(diffs)}`)
    })
  })
})

test('反证：导出函数签名改写 → 声明块差异（对定义改写敏感）', () => {
  withFixture({}, (dir) => {
    const before = collect(dir)
    withFixture({ depBlock: 'export declare function b(x: number, y?: string): string;\n' }, (dir2) => {
      const diffs = diffSurface(collect(dir2).entries, before.entries)
      assert.ok(diffs.some((d) => /blocks/.test(d) && /b :: /.test(d)), `实际: ${JSON.stringify(diffs)}`)
    })
  })
})

test('正向：只搬移实现文件（specifier 变、声明块不变）→ 仍无差异（对文件搬移免疫）', () => {
  withFixture({}, (dir) => {
    const before = collect(dir)
    // 同语义、不同排版 + 换到子目录：两条差异都必须被「追到声明 + 归一化」吸收
    withFixture({ depPath: 'impl/dep', depBlock: DEP_MOVED_BLOCK }, (dir2) => {
      assert.deepEqual(diffSurface(collect(dir2).entries, before.entries), [])
    })
  })
})

test('反证（回归）：门面链 入口 → 门面 → 实现，声明块仍能追到', () => {
  const dir = mkdtempSync(join(tmpdir(), 'export-surface-facade-'))
  try {
    const pkgDir = join(dir, 'packages', 'dsh-probe')
    mkdirSync(join(pkgDir, 'lib'), { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: '@probe/dsh-probe', exports: { '.': { types: './lib/index.d.ts' } },
    }, null, 2))
    writeFileSync(join(pkgDir, 'lib', 'index.d.ts'), 'export { b } from "./facade.js";\n')
    writeFileSync(join(pkgDir, 'lib', 'facade.d.ts'), 'export { b } from "./dep.js";\n')
    writeFileSync(join(pkgDir, 'lib', 'dep.d.ts'), DEP_BLOCK)
    const entry = collectEntry(join(pkgDir, 'lib', 'index.d.ts'))
    assert.deepEqual(entry.unresolved, [])
    assert.deepEqual(entry.symbols, ['value:b'])
    assert.deepEqual(entry.blocks, ['b :: export declare function b(x:number):string;'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('fail-closed：入口产物缺失 → 抛错，不静默当成「零符号」', () => {
  withFixture({ entryTypes: false }, (dir) => {
    assert.throws(() => collect(dir), /先跑 pnpm build/)
  })
})

test('fail-closed：入口出现 export * → 抛错（无法逐符号测量）', () => {
  withFixture({ entryExtra: 'export * from "./dep.js";\n' }, (dir) => {
    assert.throws(() => collect(dir), /export \*/)
  })
})

test('切分与归一化：模块增强块是单条语句、排版差异被吸收', () => {
  const text = [
    'declare module "@x/y" {',
    '    interface M {',
    '        a: string;',
    '    }',
    '}',
    "export declare const  k  =  'v' ;",
  ].join('\n')
  const statements = splitTopLevelStatements(text)
  assert.equal(statements.length, 2)
  assert.match(statements[0], /^declare module "@x\/y" \{/)
  assert.equal(normalizeBlock(statements[1]), "export declare const k='v';")
})

test('入口采集：解析不到的成员登记为未解析，不静默丢弃', () => {
  withFixture({ entryExtra: 'export { ghost } from "./dep.js";\n' }, (dir) => {
    const entry = collectEntry(join(dir, 'packages', 'dsh-probe', 'lib', 'index.d.ts'))
    assert.deepEqual(entry.unresolved, ['ghost ← ./dep.js'])
    assert.ok(entry.blocks.some((b) => b.startsWith('ghost :: <unresolved:')))
  })
})

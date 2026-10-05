#!/usr/bin/env node
// @ts-nocheck
'use strict'

/**
 * catalog-peers（#695）：官方类型层依赖声明一致性门禁的单测。
 *
 * 正向用真实仓库数据（零 problem 是回归底线）；负向用 mkdtemp 最小副本
 * （不触碰真实仓库，符合测试产物零污染纪律 #218）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DSH_HOST_WINDOW, checkCatalogPeers, parseCatalog, parseReleaseExclude } from '../lib/catalog-peers-lib.ts'

const ROOT = join(import.meta.dirname, '..', '..')

test('真实仓库：catalog ↔ peer 零违规', () => {
  const { problems, catalogSize, officialPeerCount } = checkCatalogPeers(ROOT)
  assert.deepEqual(problems, [])
  assert.ok(catalogSize >= 15, `catalog 应含补全后的官方包，实际 ${catalogSize}`)
  // 单插件仓库：官方 peer 声明面 = 本包 5 个 optional peers（cordis/webserver/
  // agent/tools/system-prompt）。紧贴实际保持回归底线语义：误删任一仍在使用的
  // 官方 peer 声明依旧判红。
  assert.ok(officialPeerCount >= 5, `官方 peer 应覆盖本包全部声明，实际 ${officialPeerCount}`)
})

test('真实仓库：宿主兼容区间 peer 全部命中豁免登记且逐字一致', () => {
  // P0：5 个官方 peer 走区间豁免（catalog: 在 pack 时被替换为单一精确版本，覆盖不了
  // 新宿主）。数量与命中数绑定——漏登记 / 登记值漂移都会让 problems 非空或此处不等。
  const { peerRangeCount } = checkCatalogPeers(ROOT)
  assert.equal(peerRangeCount, 5, `应有 5 个 peer 命中区间豁免，实际 ${peerRangeCount}`)
})

test('真实仓库：宿主兼容窗口必须是向上累积形态（P0 尾项回归）', () => {
  // 逐代枚举（`0.1.5-rc.2 || ^0.1.6-alpha.1 || 0.2.0-rc.2`）是已被淘汰的形态：实测它对
  // 已发布的 0.1.5-rc.3 / 0.2.0-rc.1 / 0.2.1-alpha.1 / 0.2.1-rc.1 一律 REFUSED，宿主一
  // 升级该 bundle 就被静默跳过。此处锁死「必须累积」，防止改回枚举而门禁全绿。
  const pkg = JSON.parse(readFileSync(join(ROOT, 'packages', 'dsh-mcp-servers', 'package.json'), 'utf8'))
  for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
    if (!name.startsWith('@deepseek-ai/dsh-')) continue
    assert.match(range, /^>=/, `peer ${name} 必须写成向上累积区间（>=<floor>），实际 "${range}"`)
  }
})

test('真实仓库：累积窗口覆盖已发布宿主（含 0.2.1-alpha.1），枚举窗口覆盖不到', () => {
  // 形态的机器判据（零新增依赖，不引 semver——区间语义的实测证据在 PR：用宿主自己的
  // evaluatePluginCompatibility 逐版本复验）。枚举形态只认三个字面量，已发布的
  // 0.1.5-rc.3 / 0.2.0-rc.1 / 0.2.1-alpha.1 / 0.2.1-rc.1 全不在其中，故宿主一升级即失配。
  const cumulative = '>=0.1.5-rc.2'
  assert.equal(DSH_HOST_WINDOW, cumulative, `DSH_HOST_WINDOW 应为累积形态，实际 "${DSH_HOST_WINDOW}"`)
  const retired = ['0.1.5-rc.2', '^0.1.6-alpha.1', '0.2.0-rc.2']
  for (const host of ['0.1.5-rc.3', '0.2.0-rc.1', '0.2.1-alpha.1', '0.2.1-rc.1']) {
    assert.ok(!retired.includes(host), `${host} 不在已淘汰的枚举窗口里（故枚举形态下必失配）`)
  }
})

test('parseCatalog：只取 catalog 段，不被后续顶层段污染', () => {
  const yaml = [
    'catalog:',
    "  '@deepseek-ai/cordis': 4.0.2",
    "  '@deepseek-ai/dsh-session': 0.1.2-rc.1",
    'allowBuilds:',
    '  esbuild: true',
    '',
  ].join('\n')
  const catalog = parseCatalog(yaml)
  assert.equal(catalog.size, 2)
  assert.equal(catalog.get('@deepseek-ai/dsh-session'), '0.1.2-rc.1')
})

test('parseReleaseExclude：剥离 @version 后缀', () => {
  const yaml = ['minimumReleaseAgeExclude:', "  - '@deepseek-ai/dsh-session@0.1.2-rc.1'", 'allowBuilds:', ''].join('\n')
  assert.ok(parseReleaseExclude(yaml).has('@deepseek-ai/dsh-session'))
})

/** 负向用例的默认豁免表：空表，用于把「豁免登记」这条判据隔离出去。 */
const NO_PEER_EXEMPTIONS = new Map()

/** 造最小仓库副本：pnpm-workspace.yaml + 一个带官方 peer 的包。 */
function makeRepo({
  peer = 'catalog:',
  dev,
  catalogLine = "  '@deepseek-ai/dsh-session': 0.1.2-rc.1",
  excludeLine = "  - '@deepseek-ai/dsh-session@0.1.2-rc.1'",
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-peers-'))
  writeFileSync(
    join(dir, 'pnpm-workspace.yaml'),
    ['catalog:', catalogLine, 'minimumReleaseAgeExclude:', excludeLine, ''].join('\n'),
  )
  mkdirSync(join(dir, 'packages', 'dsh-probe'), { recursive: true })
  writeFileSync(
    join(dir, 'packages', 'dsh-probe', 'package.json'),
    JSON.stringify({
      name: 'probe',
      peerDependencies: { '@deepseek-ai/dsh-session': peer },
      ...(dev === undefined ? {} : { devDependencies: { '@deepseek-ai/dsh-session': dev } }),
    }, null, 2),
  )
  return dir
}

function withRepo(options, fn) {
  const dir = makeRepo(options)
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('负向：peer 写显式字面版本且未登记 → 判红', () => {
  withRepo({ peer: '0.1.2-rc.1' }, (dir) => {
    const { problems } = checkCatalogPeers(dir, NO_PEER_EXEMPTIONS)
    assert.equal(problems.length, 1)
    assert.match(problems[0], /一律写 catalog:/)
  })
})

test('负向：catalog: 引用无对应条目 → 判红', () => {
  withRepo({ catalogLine: "  '@deepseek-ai/other': 1.0.0", excludeLine: "  - '@deepseek-ai/other@1.0.0'" }, (dir) => {
    const { problems } = checkCatalogPeers(dir, NO_PEER_EXEMPTIONS)
    assert.ok(problems.some((p) => /无此 catalog 条目/.test(p)), `实际: ${JSON.stringify(problems)}`)
  })
})

test('负向：catalog 键未登记供应链豁免清单 → 判红', () => {
  withRepo({ excludeLine: "  - '@deepseek-ai/unrelated@1.0.0'" }, (dir) => {
    const { problems } = checkCatalogPeers(dir, NO_PEER_EXEMPTIONS)
    assert.ok(
      problems.some((p) => /未登记进 minimumReleaseAgeExclude/.test(p)),
      `实际: ${JSON.stringify(problems)}`,
    )
  })
})

// ------------------------------------------------ P0：peer 区间豁免（双向强耦合）

const FIXTURE_EXEMPTION = new Map([
  ['dsh-probe|@deepseek-ai/dsh-session', { range: '0.1.2-rc.1', reason: 'fixture' }],
])

test('正向：peer 区间与豁免登记逐字一致 → 不判红', () => {
  withRepo({ peer: '0.1.2-rc.1' }, (dir) => {
    const { problems, peerRangeCount } = checkCatalogPeers(dir, FIXTURE_EXEMPTION)
    assert.deepEqual(problems, [])
    assert.equal(peerRangeCount, 1)
  })
})

test('负向：peer 值偏离豁免登记值 → 判红', () => {
  withRepo({ peer: '>=0.1.2-rc.1' }, (dir) => {
    const { problems, peerRangeCount } = checkCatalogPeers(dir, FIXTURE_EXEMPTION)
    assert.equal(peerRangeCount, 0)
    assert.ok(
      problems.some((p) => /与 peer 豁免登记值/.test(p)),
      `实际: ${JSON.stringify(problems)}`,
    )
  })
})

test('负向：豁免登记项在本仓库不存在 → 死声明判红', () => {
  withRepo({}, (dir) => {
    const ghost = new Map([['dsh-probe|@deepseek-ai/dsh-ghost', { range: '>=1.0.0', reason: 'fixture' }]])
    const { problems } = checkCatalogPeers(dir, ghost)
    assert.ok(problems.some((p) => /死声明/.test(p)), `实际: ${JSON.stringify(problems)}`)
  })
})

test('负向：豁免只对 peerDependencies 生效，devDependencies 写字面量仍判红', () => {
  withRepo({ peer: '0.1.2-rc.1', dev: '0.1.2-rc.1' }, (dir) => {
    const { problems } = checkCatalogPeers(dir, FIXTURE_EXEMPTION)
    assert.ok(
      problems.some((p) => /devDependencies\["@deepseek-ai\/dsh-session"\]/.test(p)),
      `实际: ${JSON.stringify(problems)}`,
    )
  })
})

#!/usr/bin/env node
// @ts-nocheck
'use strict'

/**
 * catalog-peers-lib — catalog ↔ peer/devDeps 一致性校验（纯逻辑库，可单测）。
 *
 * 动机（#695）：官方类型层版本曾在 pnpm-workspace.yaml 的 catalog 与各包
 * peerDependencies 双写，一次 rc 升级要手改 20 处字面量，改漏无任何信号；
 * dsh-verify-isolated 的 peer 还一度游离于 catalog 之外。peer 统一走 catalog:
 * 后事实源收敛为 catalog 一处（pnpm pack 时替换回具体版本，发布物字节语义不变），
 * 本库把「收敛后不再漂移」变成机器约束。
 *
 * P0 治理裁决：`catalog:` 在 pack 时被替换为**单一精确版本**，无法覆盖比 catalog
 * 更新的宿主 runtime；而 DSH 宿主兼容门要求 bundle 声明的 `@deepseek-ai/dsh*` peer
 * （含 optional）覆盖当前 runtime，不覆盖即整个 bundle 被跳过不加载。两套机器约束
 * 曾经互相否定，故 peer 支持**逐条登记的宿主兼容区间**（见 PEER_RANGE_ALLOWLIST）：
 * catalog 仍是**类型层 / devDependencies** 的唯一事实源，peer 是**宿主兼容窗口**。
 *
 * 零新增依赖：yaml 只解析本文件自用的两个顶层段（受限子集，非通用 YAML 解析器）。
 * 该文件由本仓独占维护，其格式受本门禁约束，故不做通用性兜底。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const OFFICIAL_SCOPE = '@deepseek-ai/'
const DEP_FIELDS = ['peerDependencies', 'devDependencies', 'dependencies']

/** dsh 系宿主兼容窗口（P0 尾项裁决）：**向上累积**形态，floor = 已实机验证的最低宿主。 */
export const DSH_HOST_WINDOW = '>=0.1.5-rc.2'
const DSH_HOST_WINDOW_REASON = '宿主兼容窗口：向上累积区间（floor = 0.1.5-rc.2，已实机验证的最低宿主）；宿主发布新里程碑或有破坏性 API 变更时重评 floor'

/**
 * peer 区间豁免登记（唯一事实源）：key = `<包目录>|<官方包名>`，value = 登记的区间
 * 字面量与理由。**只对 peerDependencies 生效**；devDependencies / dependencies
 * 一律仍须写 `catalog:`（豁免不得被用来绕过类型层锁版）。
 *
 * 双向强耦合，防两种腐化：
 *  - 实际值 ≠ 登记值 → 判红（改了 peer 必须同步本清单，杜绝静默漂移）；
 *  - 登记项在本仓库不存在 → 判红（peer 已删或已改回 catalog: 时必须删除登记，
 *    否则条目腐化成死声明）。
 *
 * 维护要求（P0 尾项，2026-10-04 裁决）：区间一律写**向上累积**形态（floor = 已实机
 * 验证的最低宿主，当前 `>=0.1.5-rc.2`）。逐代枚举（`0.1.5-rc.2 || ^0.1.6-alpha.1 ||
 * 0.2.0-rc.2`）是**已被淘汰的形态**——实测该形态对已发布的 `0.1.5-rc.3` / `0.2.0-rc.1`
 * / `0.2.1-alpha.1` / `0.2.1-rc.1` 一律 REFUSED，宿主升级时该 bundle 会被静默跳过并从
 * profile bundles 写掉。累积形态对已知宿主全部放行；代价是区间内的**未实测宿主**不保证
 * 运行时 API 兼容，故宿主发布新里程碑或有破坏性 API 变更时须重评 floor 并实机验证。
 */
export const PEER_RANGE_ALLOWLIST = new Map([
  ['dsh-mcp-servers|@deepseek-ai/cordis', {
    range: '4.0.2 || 4.0.4',
    reason: 'cordis 版本体系独立（4.x），不随 dsh-* 的 rc 节奏走',
  }],
  ['dsh-mcp-servers|@deepseek-ai/dsh-host-webserver', {
    range: DSH_HOST_WINDOW,
    reason: DSH_HOST_WINDOW_REASON,
  }],
  ['dsh-mcp-servers|@deepseek-ai/dsh-agent', {
    range: DSH_HOST_WINDOW,
    reason: DSH_HOST_WINDOW_REASON,
  }],
  ['dsh-mcp-servers|@deepseek-ai/dsh-tools', {
    range: DSH_HOST_WINDOW,
    reason: DSH_HOST_WINDOW_REASON,
  }],
  ['dsh-mcp-servers|@deepseek-ai/dsh-system-prompt', {
    range: DSH_HOST_WINDOW,
    reason: DSH_HOST_WINDOW_REASON,
  }],
])

/** 解析顶层 `catalog:` 段的名 → version。 */
export function parseCatalog(yamlText) {
  const catalog = new Map()
  let inSection = false
  for (const line of yamlText.split('\n')) {
    if (/^catalog:\s*$/.test(line)) {
      inSection = true
      continue
    }
    // 顶层键（非缩进行）终止当前段
    if (/^[A-Za-z]/.test(line)) inSection = false
    if (!inSection) continue
    const m = /^ {2}'([^']+)':\s*(\S+)\s*$/.exec(line)
    if (m) catalog.set(m[1], m[2])
  }
  return catalog
}

/** 解析顶层 `minimumReleaseAgeExclude:` 段的包名集（剥离 @version 后缀）。 */
export function parseReleaseExclude(yamlText) {
  const names = new Set()
  let inSection = false
  for (const line of yamlText.split('\n')) {
    if (/^minimumReleaseAgeExclude:\s*$/.test(line)) {
      inSection = true
      continue
    }
    if (/^[A-Za-z]/.test(line)) inSection = false
    if (!inSection) continue
    const m = /^ {2}- '([^']+)'\s*$/.exec(line)
    if (!m) continue
    const at = m[1].lastIndexOf('@')
    names.add(at > 0 ? m[1].slice(0, at) : m[1])
  }
  return names
}

/**
 * 全仓校验：官方包的 devDependencies / dependencies 必须走 `catalog:`（且 catalog:
 * 引用必须有条目、catalog 每个键都要在供应链豁免清单里登记）；peerDependencies
 * 要么走 `catalog:`，要么命中 peer 豁免登记且与登记值逐字一致。
 *
 * @param root 仓库根
 * @param peerAllowlist 豁免表（默认 PEER_RANGE_ALLOWLIST；测试注入用）
 */
export function checkCatalogPeers(root, peerAllowlist = PEER_RANGE_ALLOWLIST) {
  const yamlText = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
  const catalog = parseCatalog(yamlText)
  const excluded = parseReleaseExclude(yamlText)
  const problems = []
  const usedPeerExemptions = new Set()
  let officialPeerCount = 0
  let peerRangeCount = 0

  const pkgDirs = readdirSync(join(root, 'packages'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => e.name)
    .sort()

  for (const dir of pkgDirs) {
    let pkg
    try {
      pkg = JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8'))
    } catch {
      continue
    }
    for (const field of DEP_FIELDS) {
      const deps = pkg[field]
      if (deps === undefined || deps === null || typeof deps !== 'object') continue
      for (const [name, spec] of Object.entries(deps)) {
        if (!name.startsWith(OFFICIAL_SCOPE)) continue
        const key = `${dir}|${name}`
        const exempt = field === 'peerDependencies' ? peerAllowlist.get(key) : undefined
        if (field === 'peerDependencies') officialPeerCount++
        if (exempt !== undefined) {
          usedPeerExemptions.add(key)
          if (spec === exempt.range) peerRangeCount++
          else problems.push(`${dir}: ${field}["${name}"] = "${spec}" —— 与 peer 豁免登记值 "${exempt.range}" 不一致（改 peer 必须同步 scripts/lib/catalog-peers-lib.ts）`)
          continue
        }
        if (spec !== 'catalog:') {
          problems.push(`${dir}: ${field}["${name}"] = "${spec}" —— 官方包一律写 catalog:（peer 需宿主兼容区间时须登记进 PEER_RANGE_ALLOWLIST）`)
        } else if (!catalog.has(name)) {
          problems.push(`${dir}: ${field}["${name}"] 用了 catalog: 但 pnpm-workspace.yaml 无此 catalog 条目`)
        }
      }
    }
  }

  for (const key of peerAllowlist.keys()) {
    if (!usedPeerExemptions.has(key)) {
      problems.push(`peer 豁免登记项「${key}」在本仓库不存在（死声明：该 peer 已删除或已改回 catalog:，请同步删除登记）`)
    }
  }

  for (const name of catalog.keys()) {
    if (!excluded.has(name)) {
      problems.push(`catalog["${name}"] 未登记进 minimumReleaseAgeExclude（供应链豁免清单与事实源漂移）`)
    }
  }

  const lines = [
    `catalog ${catalog.size} 键 | 官方 peer ${officialPeerCount} 处（区间豁免 ${peerRangeCount}）| 豁免清单 ${excluded.size} 条`,
  ]
  return { lines, problems, catalogSize: catalog.size, officialPeerCount, peerRangeCount }
}

#!/usr/bin/env node
// @ts-nocheck
/**
 * export-surface-snapshot —— 导出面快照门禁（P1）。
 *
 * 判据（对应 docs/ARCHITECTURE-METHOD.md §6「包导出面三层裁定」与 §11「零行为变更由导出面
 * 快照证明」）：
 *   - **逐入口**采集（package.json `exports` 的每个子路径，本仓库是 `.` 与 `./client`）；
 *   - 每个入口采集**符号集**（名字 + 值面/类型面）与**声明块**（按导出名，沿 re-export 链
 *     递归追到真正声明它的 `.d.ts` 后归一化）；
 *   - 快照对**文件搬移免疫**（忽略来源 specifier 与中间门面层，只认最终声明内容），
 *     对**定义改写敏感**（签名 / 类型体变化即变）；
 *   - 同时登记**可达的模块增强块**（`declare module`，即声明合并面）与**未解析项**
 *     （含 `export *` 与解析不到的成员）——未解析不静默吞掉，计入快照与自述。
 *
 * 为什么必须存在：本仓库的快照闸曾随 dsh-notifier 退役（单插件仓库「无快照输入面」），
 * 结果是结构重构时**没有任何机器证据**能证明「零行为变更」。本文件以入口粒度把它重建，
 * 并挂到既有 contract 段（不新增 workflow——执法点只有一个）。
 *
 * 用法：
 *   node scripts/gate/export-surface-snapshot.mjs --check           # 门禁：与基线逐项一致
 *   node scripts/gate/export-surface-snapshot.mjs --write-baseline  # 显式重登基线
 *   node scripts/gate/export-surface-snapshot.mjs --verbose         # 额外打印未解析明细
 * 选项：--package <目录名>（缺省取 packages/ 下唯一包）。
 *
 * fail-closed 三态：入口产物缺失 / 基线缺失 / 采集面为空 —— 一律非零退出，绝不把
 * 「没有可比的东西」当成「一致」。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASELINE_PATH = join(ROOT, 'scripts', 'data', 'export-surface-baseline.json')

const DECL_RE = /^export\s+(?:(declare)\s+)?(?:(abstract)\s+)?(const|let|var|function|class|enum|namespace|type|interface)\s+([A-Za-z_$][\w$]*)/
const REEXPORT_RE = /^export\s+(type\s+)?\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/
const IMPORT_RE = /^import\s+(type\s+)?\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/
const BARE_EXPORT_RE = /^export\s+(type\s+)?\{([\s\S]*?)\}\s*;?$/
const EXPORT_STAR_RE = /^export\s+\*\s+from\s*["']([^"']+)["']/
const AUGMENT_RE = /^declare\s+module\s+["']/
const TYPE_KINDS = new Set(['type', 'interface'])

/** 去注释（块 + 行），字符串字面量原样保留。 */
export function stripComments(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const n = text[i + 1]
    if (c === '/' && n === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 2
      continue
    }
    if (c === '/' && n === '/') {
      const end = text.indexOf('\n', i)
      i = end < 0 ? text.length : end
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c
      i++
      while (i < text.length) {
        out += text[i]
        if (text[i] === '\\') {
          out += text[i + 1] ?? ''
          i += 2
          continue
        }
        if (text[i] === c) {
          i++
          break
        }
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out
}

/** 按括号深度切顶层语句；字符串与模板原样吞掉。 */
export function splitTopLevelStatements(text) {
  const statements = []
  let buf = ''
  let depth = 0
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"' || c === "'" || c === '`') {
      buf += c
      i++
      while (i < text.length) {
        buf += text[i]
        if (text[i] === '\\') {
          buf += text[i + 1] ?? ''
          i += 2
          continue
        }
        if (text[i] === c) {
          i++
          break
        }
        i++
      }
      continue
    }
    buf += c
    if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') depth--
    if (c === ';' && depth <= 0) {
      statements.push(buf)
      buf = ''
    } else if (c === '}' && depth <= 0) {
      // 顶层 `}` 只在「后面不再接 from / ;」时收尾：`export { A } from "x"` 与
      // `export type Y = {…};` 的 `}` 都不是语句结束。否则 re-export 会被截断成
      // `export { A }`，导出面被静默漏采（P1 首次实跑踩到：`.` 入口只采到 2 个符号）。
      if (!/^\s*(?:;|from\b)/.test(text.slice(i + 1))) {
        statements.push(buf)
        buf = ''
      }
    }
    i++
  }
  if (buf.trim() !== '') statements.push(buf)
  return statements.map((s) => s.trim()).filter((s) => s !== '' && s !== ';')
}

/** 归一化声明块：折叠空白、去标点两侧空格——对排版不敏感，对语义敏感。 */
export function normalizeBlock(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};:,=<>|&()[\]])\s*/g, '$1')
    .trim()
}

/** 解析 `{ A, type B, C as D }` 成员表。 */
export function parseMembers(listText) {
  const members = []
  for (const raw of listText.split(',')) {
    const item = raw.trim()
    if (item === '') continue
    const m = /^(type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(item)
    if (m === null) throw new Error(`无法解析的导出成员: ${item}`)
    members.push({ typeOnly: m[1] !== undefined, original: m[2], exported: m[3] ?? m[2] })
  }
  return members
}

/** 文件里的模块增强块（`declare module "..." {...}`）归一化文本。 */
function augmentationsOf(filePath) {
  if (!existsSync(filePath)) return []
  return splitTopLevelStatements(stripComments(readFileSync(filePath, 'utf8')))
    .filter((stmt) => AUGMENT_RE.test(stmt))
    .map((stmt) => normalizeBlock(stmt))
}

/**
 * 递归解析一份 .d.ts 的**导出面**（导出名 → { kind, block }），沿 re-export 链下钻。
 * 先登记本文件声明、再处理 re-export，故环安全（返回时至少已含本层声明）。
 */
function resolveIndex(filePath, cache, reachable) {
  if (cache.has(filePath)) return cache.get(filePath)
  const index = new Map()
  cache.set(filePath, index)
  reachable.add(filePath)
  if (!existsSync(filePath)) return index
  const statements = splitTopLevelStatements(stripComments(readFileSync(filePath, 'utf8')))
  const pending = []
  const bareExports = []
  const imports = new Map()
  for (const stmt of statements) {
    if (AUGMENT_RE.test(stmt)) continue
    const star = EXPORT_STAR_RE.exec(stmt)
    if (star !== null) {
      reachable.add(`star:${star[1]}`)
      continue
    }
    const imported = IMPORT_RE.exec(stmt)
    if (imported !== null) {
      for (const member of parseMembers(imported[2])) {
        imports.set(member.original, { spec: imported[3], typeOnly: imported[1] !== undefined, original: member.original })
      }
      continue
    }
    const re = REEXPORT_RE.exec(stmt)
    if (re !== null) {
      pending.push({ typeOnly: re[1] !== undefined, list: re[2], spec: re[3], importedName: null })
      continue
    }
    const bare = BARE_EXPORT_RE.exec(stmt)
    if (bare !== null) {
      bareExports.push({ typeOnly: bare[1] !== undefined, list: bare[2] })
      continue
    }
    const decl = DECL_RE.exec(stmt)
    if (decl !== null) {
      index.set(decl[4], { kind: TYPE_KINDS.has(decl[3]) ? 'type' : 'value', block: normalizeBlock(stmt) })
    }
  }
  // `export { X } from "spec"`：直接下钻到目标文件取同名声明。
  for (const item of pending) {
    const targetIndex = resolveIndex(resolve(dirname(filePath), item.spec.replace(/\.js$/, '.d.ts')), cache, reachable)
    for (const member of parseMembers(item.list)) {
      const hit = targetIndex.get(member.original)
      if (hit === undefined) continue
      index.set(member.exported, { kind: item.typeOnly || member.typeOnly ? 'type' : hit.kind, block: hit.block })
    }
  }
  // `export { X }`（无 from）：X 可能是本文件声明，也可能是 **本文件 import 进来再转出**的
  // ——tsc 的门面链会产出这种形态（本仓库 `bootstrap/apply.d.ts` 就是
  // `import { MCP_GUIDANCE } …` + `export { MCP_GUIDANCE }`），不追 import 会漏掉声明块。
  for (const item of bareExports) {
    for (const member of parseMembers(item.list)) {
      const local = index.get(member.original)
      if (local !== undefined) {
        index.set(member.exported, { kind: item.typeOnly || member.typeOnly ? 'type' : local.kind, block: local.block })
        continue
      }
      const imported = imports.get(member.original)
      if (imported === undefined) continue
      const targetIndex = resolveIndex(resolve(dirname(filePath), imported.spec.replace(/\.js$/, '.d.ts')), cache, reachable)
      const hit = targetIndex.get(imported.original)
      if (hit === undefined) continue
      index.set(member.exported, {
        kind: item.typeOnly || member.typeOnly || imported.typeOnly ? 'type' : hit.kind,
        block: hit.block,
      })
    }
  }
  return index
}

/** 采集一个入口的导出面：符号集 + 声明块（按导出名）+ 可达增强块 + 未解析项。 */
export function collectEntry(typesPath) {
  const cache = new Map()
  const reachable = new Set()
  const index = resolveIndex(typesPath, cache, reachable)
  const statements = splitTopLevelStatements(stripComments(readFileSync(typesPath, 'utf8')))
  const symbols = new Set()
  const blocks = new Map()
  const unresolved = []
  for (const stmt of statements) {
    if (AUGMENT_RE.test(stmt)) continue
    const star = EXPORT_STAR_RE.exec(stmt)
    if (star !== null) {
      throw new Error(`入口 ${typesPath} 出现 export * —— 无法逐符号测量导出面（fail-closed），请改为显式命名导出`)
    }
    const re = REEXPORT_RE.exec(stmt)
    const bare = re === null ? BARE_EXPORT_RE.exec(stmt) : null
    if (re !== null || bare !== null) {
      const typeOnly = (re ?? bare)[1] !== undefined
      const spec = re === null ? '（本文件）' : re[3]
      for (const member of parseMembers((re ?? bare)[2])) {
        const hit = index.get(member.exported)
        const kind = typeOnly || member.typeOnly ? 'type' : (hit?.kind ?? 'value')
        symbols.add(`${kind}:${member.exported}`)
        if (hit === undefined) unresolved.push(`${member.exported} ← ${spec}`)
        blocks.set(member.exported, hit === undefined ? `<unresolved:${member.original}>` : hit.block)
      }
      continue
    }
    const decl = DECL_RE.exec(stmt)
    if (decl !== null) {
      symbols.add(`${TYPE_KINDS.has(decl[3]) ? 'type' : 'value'}:${decl[4]}`)
      blocks.set(decl[4], normalizeBlock(stmt))
    }
  }
  const augmentations = new Set()
  for (const file of reachable) {
    if (file.startsWith('star:')) {
      unresolved.push(`export * ← ${file.slice(5)}`)
      continue
    }
    for (const block of augmentationsOf(file)) augmentations.add(block)
  }
  return {
    symbols: [...symbols].sort(),
    blocks: [...blocks.entries()].map(([name, block]) => `${name} :: ${block}`).sort(),
    augmentations: [...augmentations].sort(),
    unresolved: unresolved.sort(),
  }
}

/** 逐入口采集整包导出面。 */
export function collectPackageSurface(root, pkgDir, pkgName) {
  const pkgJson = JSON.parse(readFileSync(join(root, 'packages', pkgDir, 'package.json'), 'utf8'))
  const entries = {}
  for (const [subpath, value] of Object.entries(pkgJson.exports ?? {})) {
    const types = typeof value === 'string' ? undefined : value?.types
    if (typeof types !== 'string') continue
    const typesPath = resolve(join(root, 'packages', pkgDir), types)
    if (!existsSync(typesPath)) {
      throw new Error(`入口 ${subpath} 的产物声明不存在: ${typesPath}（先跑 pnpm build）`)
    }
    entries[subpath] = collectEntry(typesPath)
  }
  if (Object.keys(entries).length === 0) {
    throw new Error(`${pkgName}: exports 中没有任何带 types 的入口 —— 导出面不可测，fail-closed`)
  }
  return { pkgName, entries }
}

/** 对比两份入口面（`subpath → entry` 两张表），返回差异清单（空数组 = 逐项一致）。 */
export function diffSurface(nowEntries, wasEntries) {
  const diffs = []
  for (const [subpath, now] of Object.entries(nowEntries)) {
    const before = wasEntries[subpath]
    if (before === undefined) {
      diffs.push(`入口 ${subpath} 在基线中不存在（新增入口，请显式重登基线）`)
      continue
    }
    for (const key of ['symbols', 'blocks', 'augmentations', 'unresolved']) {
      const nowSet = new Set(now[key])
      const beforeSet = new Set(before[key] ?? [])
      for (const item of now[key]) if (!beforeSet.has(item)) diffs.push(`入口 ${subpath} 新增 ${key}: ${item}`)
      for (const item of before[key] ?? []) if (!nowSet.has(item)) diffs.push(`入口 ${subpath} 移除 ${key}: ${item}`)
    }
  }
  for (const subpath of Object.keys(wasEntries)) {
    if (nowEntries[subpath] === undefined) diffs.push(`入口 ${subpath} 在实现中消失（基线仍有记录）`)
  }
  return diffs
}

function pickPackageDir(root, explicit) {
  if (explicit !== undefined && explicit !== '') return explicit
  const dirs = readdirSync(join(root, 'packages'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('dsh-'))
    .map((e) => e.name)
    .sort()
  if (dirs.length !== 1) throw new Error(`packages/ 下有 ${dirs.length} 个包，请用 --package 指定`)
  return dirs[0]
}

function countsOf(entries) {
  const total = { symbols: 0, blocks: 0, augmentations: 0, unresolved: 0 }
  for (const entry of Object.values(entries)) {
    for (const key of Object.keys(total)) total[key] += entry[key].length
  }
  return total
}

function snapshotRows(pkgName, entries, verbose) {
  const rows = []
  for (const [subpath, entry] of Object.entries(entries)) {
    rows.push(
      `[export-surface] ${pkgName} · ${subpath} → 符号 ${entry.symbols.length} / 声明块 ${entry.blocks.length}`
      + ` / 增强块 ${entry.augmentations.length} / 未解析 ${entry.unresolved.length}`,
    )
    if (verbose) for (const item of entry.unresolved) rows.push(`[export-surface]   WARN 未解析: ${item}`)
  }
  return rows
}

function writeBaseline(pkgDir, pkgName, entries) {
  const baseline = {
    $comment: '导出面快照基线（scripts/gate/export-surface-snapshot.mjs 生成与校验）：'
      + '逐入口符号集 + 声明块多重集 + 可达增强块 + 未解析项。改动导出面后须显式跑 --write-baseline。',
    generatedBy: 'node scripts/gate/export-surface-snapshot.mjs --write-baseline',
    packages: {
      [pkgDir]: {
        pkgName,
        entries: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, {
          symbols: v.symbols, blocks: v.blocks, augmentations: v.augmentations, unresolved: v.unresolved,
        }])),
      },
    },
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8')
  return baseline
}

function main() {
  const argv = process.argv.slice(2)
  const isCheck = argv.includes('--check')
  const isWrite = argv.includes('--write-baseline')
  const verbose = argv.includes('--verbose')
  const pkgIndex = argv.indexOf('--package')
  try {
    const pkgDir = pickPackageDir(ROOT, pkgIndex >= 0 ? argv[pkgIndex + 1] : undefined)
    const pkgName = JSON.parse(readFileSync(join(ROOT, 'packages', pkgDir, 'package.json'), 'utf8')).name
    const current = collectPackageSurface(ROOT, pkgDir, pkgName)
    const rows = snapshotRows(pkgName, current.entries, verbose)

    if (isWrite) {
      writeBaseline(pkgDir, pkgName, current.entries)
      for (const line of rows) console.log(line)
      const counts = countsOf(current.entries)
      console.log(
        `[export-surface] 已写入基线：符号 ${counts.symbols} / 声明块 ${counts.blocks}`
        + ` / 增强块 ${counts.augmentations} / 未解析 ${counts.unresolved}`,
      )
      return 0
    }

    if (!existsSync(BASELINE_PATH)) {
      console.error('[export-surface] 基线缺失 —— 导出面无判据（fail-closed）。先跑 --write-baseline 并提交。')
      return 1
    }
    const baselineFile = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    const before = baselineFile.packages?.[pkgDir]?.entries
    if (before === undefined || Object.keys(before).length === 0) {
      console.error(`[export-surface] 基线里没有 ${pkgDir} 的入口记录 —— 判据输入为空（fail-closed）`)
      return 1
    }
    for (const line of rows) console.log(line)
    const nowCounts = countsOf(current.entries)
    const wasCounts = countsOf(before)
    // 自述与实现同源：计数分列「当前 / 基线」，只有逐项相等才声称一致（#733 M2c 教训）。
    console.log(
      `[export-surface] 当前 / 基线：符号 ${nowCounts.symbols}/${wasCounts.symbols}`
      + ` · 声明块 ${nowCounts.blocks}/${wasCounts.blocks}`
      + ` · 增强块 ${nowCounts.augmentations}/${wasCounts.augmentations}`
      + ` · 未解析 ${nowCounts.unresolved}/${wasCounts.unresolved}`,
    )
    const diffs = diffSurface(current.entries, before)
    if (diffs.length > 0) {
      for (const line of diffs.slice(0, 40)) console.log(`[export-surface] 差异 | ${line}`)
      if (diffs.length > 40) console.log(`[export-surface] 差异 | …共 ${diffs.length} 条（已截断）`)
      console.error(
        `[export-surface] FAIL：导出面与基线不一致（${diffs.length} 条）。`
        + '结构重构须保持零 diff；确属有意变更时跑 --write-baseline 并在 PR 里说明理由。',
      )
      return 1
    }
    if (isCheck || !isWrite) console.log('[export-surface] 一致：逐入口符号集与声明块多重集均与基线相同')
    return 0
  } catch (error) {
    console.error(`[export-surface] fail-closed：${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

const isMain = process.argv[1] !== undefined
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) process.exit(main())

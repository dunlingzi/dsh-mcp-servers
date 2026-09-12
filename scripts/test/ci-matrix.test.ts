import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { computeCiMatrix, runCli } from '../ci/ci-matrix.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/data/plugins-manifest.json'), 'utf8'));
// 单插件仓库：全量清单 = active ∪ standalone（无聚合包）。
const EXPECTED_ALL = Array.from(new Set([...MANIFEST.active, ...(MANIFEST.standalone ?? [])])).sort();

test('ci-matrix: 场景 a - 正常命中单一 active 包 (via FILTER_OUTPUTS)', () => {
  const res = computeCiMatrix({
    env: {
      GLOBAL_HIT: 'false',
      FILTER_OUTCOME: 'success',
      BASE_SET: 'origin/main',
      FILTER_OUTPUTS: JSON.stringify({ 'dsh-mcp-servers': true }),
    },
    rootDir: ROOT,
  });

  assert.deepEqual(res.allPackages, EXPECTED_ALL);
  assert.deepEqual(res.hitPackages, ['dsh-mcp-servers']);
  assert.deepEqual(res.buildPackages, ['dsh-mcp-servers'], '#722：矩阵 = 命中包（有命中时）');
  assert.deepEqual(res.mutationPackages, ['dsh-mcp-servers']);
  assert.equal(res.hasMutations, 'true');
  // dsh-mcp-servers 变异 6 段（entry/manager/middleware/routes/runtime/supervisor），
  // combos 按段名字母序展开。
  assert.equal(res.mutationCombos.length, 6);
  assert.deepEqual(
    res.mutationCombos.map((c) => c.seg),
    ['entry', 'manager', 'middleware', 'routes', 'runtime', 'supervisor']
  );
});

test('ci-matrix: 空切片 → buildPackages 用哨兵占位（防零实例动态矩阵回报 failure，#722）', () => {
  const res = computeCiMatrix({
    env: {
      GLOBAL_HIT: 'false',
      FILTER_OUTCOME: 'success',
      BASE_SET: 'origin/main',
      // 纯文档 PR：docs/**、AGENTS.md 刻意不在 global 面（#220），故全 false
      FILTER_OUTPUTS: '{}',
    },
    rootDir: ROOT,
  });

  assert.deepEqual(res.hitPackages, [], '空切片');
  assert.deepEqual(res.buildPackages, ['__no-hit-package__'],
    'GHA 对零实例动态矩阵回报 failure（实证 run 32802575298），必须用哨兵项占位');
  assert.equal(res.hasMutations, 'false');
});

test('ci-matrix: 场景 a - 正常命中单一 active 包 (via BASE_SET 空格分隔)', () => {
  const res = computeCiMatrix({
    env: {
      GLOBAL_HIT: 'false',
      FILTER_OUTCOME: 'success',
      BASE_SET: 'dsh-mcp-servers',
      FILTER_OUTPUTS: '{}',
    },
    rootDir: ROOT,
  });

  assert.deepEqual(res.hitPackages, ['dsh-mcp-servers']);
  assert.deepEqual(res.mutationPackages, ['dsh-mcp-servers']);
  assert.equal(res.hasMutations, 'true');
  assert.deepEqual(
    res.mutationCombos.map((c) => c.seg),
    ['entry', 'manager', 'middleware', 'routes', 'runtime', 'supervisor']
  );
});

test('ci-matrix: 场景 b - standalone 未登记包不进全量清单', () => {
  // 单插件仓库：standalone 为空；未登记包名不得静默进入 CI 全量清单。
  assert.deepEqual(MANIFEST.standalone, [], 'standalone 应为空（单包仓库走 active）');
  for (const pkg of ['dsh-notifier', 'dsh-lan-proxy', 'dsh-plugins-all']) {
    assert.ok(!EXPECTED_ALL.includes(pkg), `${pkg} 不属于本仓库，不得进入 CI 全量清单`);
  }
});

test('ci-matrix: 场景 b - 命中无变异配置的 active 包', () => {
  // 伪造一个已登记但无 stryker.conf.d 配置的包名：不应进变异切片。
  const res = computeCiMatrix({
    env: {
      GLOBAL_HIT: 'false',
      FILTER_OUTCOME: 'success',
      BASE_SET: 'origin/main',
      FILTER_OUTPUTS: JSON.stringify({
        'dsh-mcp-servers-no-such-conf': true,
      }),
    },
    rootDir: ROOT,
  });

  assert.deepEqual(res.hitPackages, [], '未登记包名不进切片（allPackages 不含它）');
  assert.deepEqual(res.mutationPackages, []);
  assert.equal(res.hasMutations, 'false');
  assert.deepEqual(res.mutationCombos, []);
});

test('ci-matrix: 场景 c - 全局命中 (GLOBAL_HIT=true) 触发全量切片', () => {
  const res = computeCiMatrix({
    env: {
      GLOBAL_HIT: 'true',
      FILTER_OUTCOME: 'success',
      BASE_SET: 'origin/main',
      FILTER_OUTPUTS: JSON.stringify({ 'dsh-mcp-servers': true }),
    },
    rootDir: ROOT,
  });

  assert.deepEqual(res.hitPackages, EXPECTED_ALL);
  assert.equal(res.hasMutations, 'true');
  // 必须包含 active + standalone 全集
  for (const p of [...MANIFEST.active, ...MANIFEST.standalone]) {
    assert.ok(res.hitPackages.includes(p), `hitPackages 必须包含 ${p}`);
  }
});

test('ci-matrix: 场景 c - 回退机制 (FILTER_OUTCOME!=success 或 BASE_SET 为空)', () => {
  // 1. FILTER_OUTCOME failure
  const resFailure = computeCiMatrix({
    env: {
      GLOBAL_HIT: 'false',
      FILTER_OUTCOME: 'failure',
      BASE_SET: 'origin/main',
    },
    rootDir: ROOT,
  });
  assert.deepEqual(resFailure.hitPackages, EXPECTED_ALL);

  // 2. FILTER_OUTCOME cancelled
  const resCancelled = computeCiMatrix({
    env: {
      GLOBAL_HIT: 'false',
      FILTER_OUTCOME: 'cancelled',
      BASE_SET: 'origin/main',
    },
    rootDir: ROOT,
  });
  assert.deepEqual(resCancelled.hitPackages, EXPECTED_ALL);

  // 3. BASE_SET 为空字符串
  const resEmptyBase = computeCiMatrix({
    env: {
      GLOBAL_HIT: 'false',
      FILTER_OUTCOME: 'success',
      BASE_SET: '',
    },
    rootDir: ROOT,
  });
  assert.deepEqual(resEmptyBase.hitPackages, EXPECTED_ALL);

  // 4. BASE_SET 仅含空格
  const resWhitespaceBase = computeCiMatrix({
    env: {
      GLOBAL_HIT: 'false',
      FILTER_OUTCOME: 'success',
      BASE_SET: '   ',
    },
    rootDir: ROOT,
  });
  assert.deepEqual(resWhitespaceBase.hitPackages, EXPECTED_ALL);
});

test('ci-matrix: 场景 d - 变异段展开正确性 (段名排序)', () => {
  const res = computeCiMatrix({
    env: {
      GLOBAL_HIT: 'false',
      FILTER_OUTCOME: 'success',
      BASE_SET: 'origin/main',
      FILTER_OUTPUTS: JSON.stringify({ 'dsh-mcp-servers': true }),
    },
    rootDir: ROOT,
  });
  assert.deepEqual(res.mutationPackages, ['dsh-mcp-servers']);
  assert.deepEqual(res.mutationCombos, [
    { package: 'dsh-mcp-servers', seg: 'entry' },
    { package: 'dsh-mcp-servers', seg: 'manager' },
    { package: 'dsh-mcp-servers', seg: 'middleware' },
    { package: 'dsh-mcp-servers', seg: 'routes' },
    { package: 'dsh-mcp-servers', seg: 'runtime' },
    { package: 'dsh-mcp-servers', seg: 'supervisor' },
  ]);
});

test('ci-matrix: 场景 e - 畸形输入与防御性回退', () => {
  // 畸形 JSON 字符串
  const resBadJson = computeCiMatrix({
    env: {
      GLOBAL_HIT: 'false',
      FILTER_OUTCOME: 'success',
      BASE_SET: 'origin/main',
      FILTER_OUTPUTS: '{broken-json',
    },
    rootDir: ROOT,
  });
  assert.deepEqual(resBadJson.hitPackages, []);
  assert.equal(resBadJson.hasMutations, 'false');

  // BASE_SET 含有无关 token 与有效包名
  const resTokens = computeCiMatrix({
    env: {
      GLOBAL_HIT: 'false',
      FILTER_OUTCOME: 'success',
      BASE_SET: 'origin/main 0000000000000000000000000000000000000000 dsh-mcp-servers non-existent-pkg',
      FILTER_OUTPUTS: '{}',
    },
    rootDir: ROOT,
  });
  assert.deepEqual(resTokens.hitPackages, ['dsh-mcp-servers']);
});

test('ci-matrix: 场景 e - fail-closed 异常防护 (manifest 损坏或空清单)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-matrix-mock-'));
  try {
    const scriptsDataDir = path.join(tmpDir, 'scripts/data');
    fs.mkdirSync(scriptsDataDir, { recursive: true });
    // 读取失败 fail-closed
    fs.writeFileSync(path.join(scriptsDataDir, 'plugins-manifest.json'), 'invalid json');
    assert.throws(
      () => computeCiMatrix({ rootDir: tmpDir }),
      /读取 plugins-manifest\.json 失败/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ci-matrix: 场景 f - CLI 命令行与 --json 参数验证', () => {
  const scriptPath = path.join(ROOT, 'scripts/ci/ci-matrix.mjs');
  const ret = spawnSync(process.execPath, [scriptPath, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(ret.status, 0, `CLI 执行失败: ${ret.stderr}`);
  const parsed = JSON.parse(ret.stdout);
  assert.ok(Array.isArray(parsed.allPackages));
  assert.ok(Array.isArray(parsed.hitPackages));
  assert.ok(Array.isArray(parsed.mutationPackages));
  assert.ok(typeof parsed.hasMutations === 'string');
  assert.ok(Array.isArray(parsed.mutationCombos));
});

test('ci-matrix: 场景 f - GITHUB_OUTPUT 写入契约', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-matrix-gha-'));
  const outputFile = path.join(tmpDir, 'github_output.txt');
  fs.writeFileSync(outputFile, '');

  try {
    const scriptPath = path.join(ROOT, 'scripts/ci/ci-matrix.mjs');
    const ret = spawnSync(process.execPath, [scriptPath], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputFile,
        GLOBAL_HIT: 'false',
        FILTER_OUTCOME: 'success',
        BASE_SET: 'origin/main',
        FILTER_OUTPUTS: JSON.stringify({ 'dsh-mcp-servers': true }),
      },
    });
    assert.equal(ret.status, 0, `CLI 执行失败: ${ret.stderr}`);

    const content = fs.readFileSync(outputFile, 'utf8');
    const lines = content.trim().split('\n');
    const record = Object.fromEntries(lines.map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx), l.slice(idx + 1)];
    }));

    assert.equal(record.hitPackages, JSON.stringify(['dsh-mcp-servers']));
    assert.equal(record.mutationPackages, JSON.stringify(['dsh-mcp-servers']));
    assert.equal(record.hasMutations, 'true');
    assert.deepEqual(JSON.parse(record.allPackages), EXPECTED_ALL);
    const combos = JSON.parse(record.mutationCombos);
    assert.equal(combos.length, 6);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

/**
 * dsh-mcp-servers — 客户端「文本 ⇄ 配置」编解码（core 层，React 无关）。
 *
 * 表单用文本编辑 args / env / headers，宿主存的是结构化数组与对象；本模块是
 * 这对转换的唯一实现处，供编辑页与单元测试共用（React 无关，可直接直连 src 测）。
 *
 * **互逆性是本模块的核心契约**：`formatArgs` 的输出必须能被 `splitArgs` 原样还原
 * （含空格、含双引号、含反斜杠、空字符串），否则「打开编辑页 → 直接保存」就会
 * 静默改写用户配置。两个函数必须成对修改。
 */

/**
 * 按空格拆分参数；双引号包裹的段可含空格，段内 `\"` 与 `\\` 为转义。
 * 与 formatArgs 成对（见模块头注释）。
 */
export function splitArgs(input: string): string[] {
  const out: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"|(\S+)/g;
  for (const m of input.matchAll(re)) {
    if (m[1] !== undefined) out.push(m[1].replace(/\\(["\\])/g, "$1"));
    else out.push(m[2]);
  }
  return out;
}

/**
 * 参数数组 → 命令行文本（回显）。含空白、含双引号或为空串的段加双引号并转义
 * （`\` → `\\`、`"` → `\"`），其余原样——保证「表单 → JSON → 表单 → 保存」往返
 * 后参数数组逐项不变。空串也必须加引号，否则会被 join 成连续空格而被丢弃。
 */
export function formatArgs(arr: readonly unknown[] | undefined): string {
  if (!Array.isArray(arr)) return "";
  return arr
    .map((item) => String(item))
    .map((arg) => (arg === "" || /[\s"]/.test(arg) ? `"${arg.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : arg))
    .join(" ");
}

/** 多行 KEY=VALUE → 对象（去引号；空行/# 注释跳过）。 */
export function parseKeyValueLines(input: string, sep: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(sep);
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + sep.length).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/** 对象 → 多行 KEY=VALUE 文本（回显）。 */
export function formatKeyValueLines(obj: Record<string, string> | undefined, sep: string): string {
  if (obj === undefined) return "";
  return Object.entries(obj).map(([k, v]) => `${k}${sep}${v}`).join("\n");
}

/**
 * 相对序列化（键排序、丢 undefined、数组保序）：用于「有无未保存改动」的语义比较，
 * 免受键序与空白影响。仅服务于脏值判定，不用于传输。
 */
export function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

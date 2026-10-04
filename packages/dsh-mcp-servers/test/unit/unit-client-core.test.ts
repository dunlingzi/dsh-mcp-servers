/**
 * dsh-mcp-servers — 客户端 core 层纯函数单元测试（`src/client/core/`）。
 *
 * 直连 src（无 React / DOM 依赖），覆盖两组「措辞容易写错、错了就静默出错」的契约：
 *
 * 1. **文本 ⇄ 结构化配置的互逆性**（`args.ts`）：`splitArgs(formatArgs(args))` 必须
 *    逐项还原 `args`，否则「打开编辑页 → 直接保存」就会改写用户配置。历史缺陷：
 *    含空格的段丢引号（往返被切成两段）、含双引号的段被 `\"` 转义后又被不认转义的
 *    splitArgs 拆开、空串参数被 join 成连续空格而丢失。
 * 2. **cwd 查询参数绝不进 pathname**（`api.ts`）：宿主 10 条路由全是 exact 命中，
 *    `cwd` 一旦被拼进 pathname，请求就落到前端静态 fallback 并以 405 空响应失败。
 *    历史缺陷：对无 query 的路径手拼 `cwdQueryOf()`（返回 `&cwd=…`）。
 */
import { describe, expect, it } from "vitest";
import {
  formatArgs,
  formatKeyValueLines,
  parseKeyValueLines,
  splitArgs,
  stableJson,
} from "../../src/client/core/args.ts";
import { cwdQueryOf, withCwd } from "../../src/client/core/api.ts";

describe("splitArgs", () => {
  it("按空格拆分裸参数", () => {
    expect(splitArgs("serve --mcp")).toEqual(["serve", "--mcp"]);
  });

  it("双引号包裹的段保留内部空格", () => {
    expect(splitArgs('--cwd "C:/my dir/x" -v')).toEqual(["--cwd", "C:/my dir/x", "-v"]);
  });

  it("引号内的 \\\" 与 \\\\ 是转义", () => {
    expect(splitArgs('--pattern "a\\"b"')).toEqual(["--pattern", 'a"b']);
    expect(splitArgs('"a\\\\b"')).toEqual(["a\\b"]);
  });

  it("空串与空输入", () => {
    expect(splitArgs("")).toEqual([]);
    expect(splitArgs('""')).toEqual([""]);
  });

  it("未加引号的段里的引号不当作分隔（向后兼容）", () => {
    expect(splitArgs("a\"b")).toEqual(['a"b']);
  });
});

describe("formatArgs / splitArgs 互逆（往返保真）", () => {
  const cases: Array<[string, string[]]> = [
    ["空数组", []],
    ["普通参数", ["serve", "--mcp"]],
    ["含空格的参数", ["C:/my dir/x"]],
    ["含空格的参数 + 其他参数", ["--cwd", "C:/my dir/x", "-v"]],
    ["含双引号的参数", ['a"b']],
    ["含双引号 + 其他参数", ["--pattern", 'a"b']],
    ["仅双引号", ['"']],
    ["空字符串参数", [""]],
    ["空串与普通参数混合", ["--x", "", "--y"]],
    ["含反斜杠", ["C:\\path\\to\\bin"]],
    ["含反斜杠 + 空格", ["C:\\my dir\\bin"]],
    ["含制表符", ["a\tb"]],
    ["等号与空格混合", ["--env=K=V", "--name=my tool"]],
  ];

  for (const [label, args] of cases) {
    it(`${label}：format → split 原样还原`, () => {
      expect(splitArgs(formatArgs(args))).toEqual(args);
    });
  }

  it("稳定：formatArgs 自身幂等（format→split→format 与直接 format 等价）", () => {
    for (const [, args] of cases) {
      expect(formatArgs(splitArgs(formatArgs(args)))).toBe(formatArgs(args));
    }
  });

  it("undefined / 非数组回落空串", () => {
    expect(formatArgs(undefined)).toBe("");
  });
});

describe("parseKeyValueLines / formatKeyValueLines", () => {
  it("KEY=VALUE 解析（空行与 # 注释跳过）", () => {
    expect(parseKeyValueLines("# 注释\nA=1\n\nB=2", "=")).toEqual({ A: "1", B: "2" });
  });

  it("值两侧的引号被剥掉，等号右侧整体为值", () => {
    expect(parseKeyValueLines('TOKEN="a=b c"', "=")).toEqual({ TOKEN: "a=b c" });
  });

  it("空值保留键", () => {
    expect(parseKeyValueLines("A=", "=")).toEqual({ A: "" });
  });

  it("请求头用冒号分隔，值内的冒号不影响切分", () => {
    expect(parseKeyValueLines("X-Url: https://example.com/a", ":")).toEqual({ "X-Url": "https://example.com/a" });
  });

  it("对象 → 多行文本回显（undefined 回落空串）", () => {
    expect(formatKeyValueLines({ A: "1", B: "2" }, "=")).toBe("A=1\nB=2");
    expect(formatKeyValueLines(undefined, "=")).toBe("");
  });
});

describe("withCwd / cwdQueryOf：cwd 只做查询参数", () => {
  it("withCwd 给无 query 的路径补 ?", () => {
    expect(withCwd("/api/dsh-mcp-servers/tool-disable", "G:/my proj"))
      .toBe("/api/dsh-mcp-servers/tool-disable?cwd=G%3A%2Fmy%20proj");
  });

  it("withCwd 给已有 query 的路径接 &", () => {
    expect(withCwd("/api/x?name=a&scope=global", "G:/p")).toBe("/api/x?name=a&scope=global&cwd=G%3A%2Fp");
  });

  it("withCwd 无 cwd 时原样返回", () => {
    expect(withCwd("/api/x", undefined)).toBe("/api/x");
    expect(withCwd("/api/x?a=1", "")).toBe("/api/x?a=1");
  });

  it("不变量：cwd 永不进 pathname（宿主 exact 路由的硬前提）", () => {
    for (const base of ["/api/x", "/api/x?a=1", "/api/x?a=1&b=2"]) {
      const url = new URL(withCwd(base, "G:/my proj"), "http://127.0.0.1:3080");
      expect(url.pathname).toBe("/api/x");
      expect(url.searchParams.get("cwd")).toBe("G:/my proj");
    }
  });

  it("cwdQueryOf 以 & 开头（只能接在已有 ? 之后）", () => {
    expect(cwdQueryOf("G:/p")).toBe("&cwd=G%3A%2Fp");
    expect(cwdQueryOf(undefined)).toBe("");
  });
});

describe("stableJson", () => {
  it("键序无关", () => {
    expect(stableJson({ a: 1, b: 2 })).toBe(stableJson({ b: 2, a: 1 }));
  });

  it("数组保序，undefined 键被丢弃", () => {
    expect(stableJson({ a: [1, 2], b: undefined })).toBe('{"a":[1,2]}');
    expect(stableJson({ a: [1, 2] })).not.toBe(stableJson({ a: [2, 1] }));
  });

  it("嵌套结构稳定", () => {
    expect(stableJson({ x: { b: 1, a: 2 } })).toBe('{"x":{"a":2,"b":1}}');
  });
});

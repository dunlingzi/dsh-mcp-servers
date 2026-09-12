/**
 * dsh-mcp-servers — 浏览器端客户端入口（装配层）。
 *
 * 注册设置页「MCP 服务器」顶级菜单（settings.section 槽位）+ i18n 字典 +
 * 样式；apply 级常驻会话绑定（项目级 MCP 跟随当前会话 cwd，独立于设置页
 * 是否打开）。失败策略：只 warn 不抛，绝不让 GUI 启动失败。
 *
 * 客户端干净模块：只导出 apply/inject，契约外壳（IIFE/factory 装配）由
 * scripts/build/build-client.ts 统一生成——源码不写任何 loader 痕迹。
 * React 由 dsh web 的 factory require("react") 注入（build-client externals
 * 路径）；入口必须 bare-import react，build-client 据此判定 external 面。
 * 样式：独立 style.css（.css text-loader 构建期内联为字符串）。
 */

import STYLE from "./style.css";
import { ensureStyle } from "../../../../shared/client/ensure-style.js";
import { t as sharedT, bindLocale } from "../../../../shared/client/i18n.js";
import * as React from "react";
void React;

import { McpServersPage } from "./page/McpServersPage.tsx";
import { createSharedSessionState, bindSession } from "./core/session.ts";
import { NS, zh, en, type McpLocaleKey } from "./locales.ts";
// 显式类型导入，先把 @deepseek-ai/dsh-client-ui-slots 拉进模块解析图：上游发布物
// lib/types/*.d.ts 相对导入保留 .ts 后缀，declare module 增强的模块名解析会判
// TS2664（microsoft/TypeScript#63960 同类；上游修复发布物后此行可删）。
import type { LocaleNamespaceMap } from "@deepseek-ai/dsh-client-ui-slots";

// i18n：字典命名空间 + LocaleNamespaceMap 声明合并（官方 ui-jobs 同款）。
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** dsh-mcp-servers 设置页文案。 */
    mcpServers: McpLocaleKey;
  }
}

export function apply(ctx: any): void {
  try {
    // i18n：注册本插件字典；共享 t() 经 bindLocale 活绑定，语言切换 subscribe
    // 重绑（下次渲染即生效）。unsubLocale 供 effect 卸载时解绑，防 HMR 重复
    // apply 后旧订阅持续重绑已停用实例。
    const locale: any = ctx.get("locale");
    let unsubLocale: (() => void) | undefined;
    if (locale && typeof locale.register === "function") {
      try {
        locale.register(NS, { zh, en });
        bindLocale(locale, NS);
        if (typeof locale.subscribe === "function" && typeof locale.getSnapshot === "function") {
          unsubLocale = locale.subscribe(function () {
            bindLocale(locale, NS);
          });
        }
      } catch (error) {
        console.warn("[dsh-mcp-servers] locale 注册失败：", error);
      }
    }

    // 注入样式（幂等；重复 apply 不重复创建——收敛 shared/client/ensure-style）。
    ensureStyle({ id: "dsh-mcp-servers-style", cssText: STYLE });

    // 会话绑定（apply 级常驻）：项目级 MCP 跟随当前会话 cwd——即使用户从不
    // 打开设置页，会话级项目 MCP 也要工作。cwd 同时供页面查询参数复用。
    const shared = createSharedSessionState();
    const disposeSession = bindSession(ctx, shared);

    // 设置页顶级菜单（settings.section 槽位；对照官方 通用/模型/插件 与
    // 插件贡献的 Codex UI/Watcher 条目）。组件经 slot inject 拿到 ctx + 共享
    // 会话状态（React 组件由宿主 React 渲染）。
    const slots = ctx.get("slots");
    if (slots && typeof slots.inject === "function") {
      slots.inject("settings.section", () =>
        slots.register(
          {
            name: "settings.section",
            id: "mcp-servers",
            order: 18,
            label: () => sharedT("nav"),
            locale: NS,
            inject: () => ({ ctx, shared }),
          },
          McpServersPage,
        ),
      );
    }

    ctx.effect(
      () => () => {
        if (unsubLocale !== undefined) unsubLocale();
        disposeSession();
      },
      "dsh-mcp-servers: client",
    );
  } catch (error) {
    console.warn("[dsh-mcp-servers] mount failed:", error);
  }
}

// ---- 客户端契约：apply/inject 由 build-client 经 factory 装配（干净模块）----
// 注入 sessions 服务以跟随当前会话（cwd 切换项目级 MCP）；slots 服务用于注册
// 设置页顶级菜单；locale 服务用于字典注册与 t 装配。
export const inject: string[] = ["sessions", "slots", "locale"];

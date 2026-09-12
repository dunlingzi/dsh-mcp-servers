/**
 * dsh-mcp-servers — 设置页列表视图：作用域筛选 + 搜索 + 分组卡片 + 启停/探活。
 *
 * 视觉形态对齐目标设计：标题 + 计数，工具行（作用域筛选 / 搜索 / 刷新 / 新建
 * / 中间层切换），卡片按「用户（全局）/ 项目级」分组，状态点 + 名称 +
 * `stdio · 端点摘要` 副标题 + 工具数 + 启停开关；卡片点击进编辑。
 */
import * as React from "react";
import { api, cwdQueryOf } from "../core/api.ts";
import { API, statusDot } from "../core/constants.ts";
import { t } from "../../../../../shared/client/i18n.js";
import type { SharedSessionState } from "../core/session.ts";
import type { ServerRow, Summary } from "./McpServersPage.tsx";

/** 端点摘要：stdio 取「command + args 首段」，http 取 URL。 */
function endpointSummary(server: ServerRow): string {
  if (server.transport === "stdio") {
    const args = Array.isArray(server.args) && server.args.length > 0 ? ` ${server.args.join(" ")}` : "";
    return `${server.command ?? ""}${args}`;
  }
  return server.url ?? "";
}

/** 卡片副标题：传输 · 端点（错误状态附错误消息，超长截断）。 */
function cardSubtitle(server: ServerRow): string {
  const base = `${server.transport} · ${endpointSummary(server)}`;
  if (server.status === "failed" && server.error) {
    const msg = server.error.length > 120 ? `${server.error.slice(0, 120)}…` : server.error;
    return `${base} — ${msg}`;
  }
  return base;
}

interface ListViewProps {
  summary: Summary | null;
  middleware: string;
  error: string;
  shared: SharedSessionState;
  onMiddlewareChange(mode: string): void;
  onRefresh(): void;
  onCreate(): void;
  onEdit(server: ServerRow): void;
}

/** 单台探活结果（卡片内联展示）。 */
interface ProbeView {
  pending: boolean;
  ok?: boolean;
  text?: string;
}

export function ListView(props: ListViewProps): any {
  const { summary, middleware, error, shared, onMiddlewareChange, onRefresh, onCreate, onEdit } = props;
  const [scopeFilter, setScopeFilter] = React.useState("all" as "all" | "global" | "project");
  const [query, setQuery] = React.useState("" as string);
  const [probeViews, setProbeViews] = React.useState({} as Record<string, ProbeView>);
  const [busy, setBusy] = React.useState({} as Record<string, boolean>);

  const servers = summary?.servers ?? [];
  const filtered = servers.filter((server) => {
    if (scopeFilter === "global" && server.scope !== "global") return false;
    if (scopeFilter === "project" && server.scope !== "project") return false;
    const q = query.trim().toLowerCase();
    if (q === "") return true;
    return server.name.toLowerCase().includes(q) || endpointSummary(server).toLowerCase().includes(q);
  });
  const globalGroup = filtered.filter((server) => server.scope === "global");
  const projectGroup = filtered.filter((server) => server.scope === "project");

  /** 启停开关：PATCH enabled；开启后追加 connect（清中间层 userDisabled，幂等）。 */
  const toggleServer = (server: ServerRow, next: boolean) => {
    const key = `${server.scope}/${server.name}`;
    setBusy((prev: Record<string, boolean>) => ({ ...prev, [key]: true }));
    const scopeQuery = `?name=${encodeURIComponent(server.name)}&scope=${server.scope}${cwdQueryOf(shared.currentCwd)}`;
    api(`${API.servers}${scopeQuery}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    })
      .then(() => (next ? api(`${API.connect}${scopeQuery}`, { method: "POST" }) : undefined))
      .then(() => onRefresh())
      .catch((e: any) => alert(t("actionFail", { msg: String(e?.message ?? e) })))
      .finally(() => setBusy((prev: Record<string, boolean>) => ({ ...prev, [key]: false })));
  };

  /** 探活：一次性连接，报延迟与工具数（不改连接状态）。 */
  const probeServer = (server: ServerRow) => {
    const key = `${server.scope}/${server.name}`;
    setProbeViews((prev: Record<string, ProbeView>) => ({ ...prev, [key]: { pending: true } }));
    api(`${API.probe}?name=${encodeURIComponent(server.name)}&scope=${server.scope}${cwdQueryOf(shared.currentCwd)}`, {
      method: "POST",
      timeoutMs: 20_000,
    })
      .then((result: any) => {
        const view: ProbeView = result?.ok === true
          ? { pending: false, ok: true, text: t("testOk", { latency: String(result.latencyMs ?? "?"), tools: String(result.toolCount ?? 0) }) }
          : { pending: false, ok: false, text: t("testFail", { error: String(result?.error ?? "unknown") }) };
        setProbeViews((prev: Record<string, ProbeView>) => ({ ...prev, [key]: view }));
      })
      .catch((e: any) => {
        setProbeViews((prev: Record<string, ProbeView>) => ({ ...prev, [key]: { pending: false, ok: false, text: t("testFail", { error: String(e?.message ?? e) }) } }));
      });
  };

  const renderGroup = (title: string, servers: ServerRow[]) => {
    if (servers.length === 0) return null;
    return (
      <div className="ms-group" key={title}>
        <div className="ms-group-title">
          {title} <span className="ms-group-count">{servers.length}</span>
        </div>
        <div className="ms-cards">
          {servers.map((server) => {
            const key = `${server.scope}/${server.name}`;
            const enabled = server.enabled !== false && server.status !== "disabled";
            const probe = probeViews[key];
            return (
              <div className="ms-card" key={key} onClick={() => onEdit(server)}>
                <div className="ms-card-icon">
                  <span className="ms-dot" style={{ background: statusDot(server.status) }} />
                  <span className="ms-icon-glyph">⚙</span>
                </div>
                <div className="ms-card-body">
                  <div className="ms-card-name">{server.name}</div>
                  <div className="ms-card-sub" title={server.status === "failed" ? server.error : undefined}>
                    {cardSubtitle(server)}
                  </div>
                  {(server.tools?.length ?? 0) > 0 || (server.disabledTools?.length ?? 0) > 0 ? (
                    <div className="ms-card-tools">
                      {t("toolsCount", { n: String(server.tools?.length ?? 0) })}
                      {(server.disabledTools?.length ?? 0) > 0
                        ? ` · ${t("toolDisabledBadge", { n: String(server.disabledTools?.length ?? 0) })}`
                        : ""}
                    </div>
                  ) : null}
                  {probe !== undefined ? (
                    <div className={probe.ok === true ? "ms-probe-ok" : "ms-probe-fail"}>
                      {probe.pending ? t("testing") : probe.text}
                    </div>
                  ) : null}
                </div>
                <div className="ms-card-actions" onClick={(e: any) => e.stopPropagation()}>
                  <button className="ms-btn ms-btn-ghost" onClick={() => probeServer(server)}>{t("test")}</button>
                  <label
                    className={busy[key] === true ? "ms-switch ms-switch-busy" : "ms-switch"}
                    title={enabled ? t("stConnected") : t("stDisabled")}
                  >
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e: any) => toggleServer(server, e.target.checked === true)}
                    />
                    <span className="ms-switch-slider" />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="ms-page">
      <h1 className="ms-title">{t("title")}</h1>
      <p className="ms-subtitle">{t("subtitle")}</p>
      {error !== "" ? <div className="ms-error-banner">{error}</div> : null}
      <div className="ms-toolbar">
        <div className="ms-toolbar-left">
          <select
            className="ms-select"
            value={scopeFilter}
            onChange={(e: any) => setScopeFilter(e.target.value)}
            aria-label={t("scopeLabel")}
          >
            <option value="all">{t("scopeAll")}</option>
            <option value="global">{t("scopeGlobal")}</option>
            <option value="project">{t("scopeProject")}</option>
          </select>
          <span className="ms-count">{t("mcpCount", { n: String(servers.length) })}</span>
        </div>
        <div className="ms-toolbar-right">
          <select
            className="ms-select"
            value={middleware}
            onChange={(e: any) => onMiddlewareChange(e.target.value)}
            title={t("middlewareHint")}
            aria-label={t("middlewareLabel")}
          >
            <option value="off">{t("middlewareOff")}</option>
            <option value="project">{t("middlewareProject")}</option>
            <option value="all">{t("middlewareAll")}</option>
          </select>
          <input
            className="ms-search"
            type="search"
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={(e: any) => setQuery(e.target.value)}
          />
          <button className="ms-btn ms-btn-ghost" onClick={onRefresh} aria-label={t("refresh")}>⟳</button>
          <button className="ms-btn ms-btn-primary" onClick={onCreate}>+ {t("create")}</button>
        </div>
      </div>
      <div className="ms-hint">{t("middlewareHint")}</div>
      {summary === null ? null : (
        <div className="ms-groups">
          {renderGroup(t("groupGlobal"), globalGroup)}
          {renderGroup(t("groupProject"), projectGroup)}
          {globalGroup.length === 0 && projectGroup.length === 0 ? (
            <div className="ms-empty">
              {query.trim() !== "" ? t("emptyFilter", { q: query.trim() }) : t("emptyList")}
            </div>
          ) : null}
          {projectGroup.length === 0 && scopeFilter !== "global" ? (
            <div className="ms-hint">{t("noProjectHint")}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

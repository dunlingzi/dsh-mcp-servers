/**
 * dsh-mcp-servers — 设置页列表视图：状态筛选 + 作用域筛选 + 搜索 + 分组卡片 + 启停/探活/导入。
 *
 * 信息架构：标题 → 状态簇筛选条（同时充当状态图例）→ 工具行（作用域 / 搜索 / 刷新 / 新建）
 * → 中间层模式与效果说明 → 分组卡片（用户（全局）/ 项目级）。
 *
 * 可访问性：卡片主操作用「拉伸按钮」（stretched button）承载——卡片内不含嵌套的可交互
 * 元素，键盘可达且有可读名；状态不止靠颜色（色点 + 文字徽章双通道）；开关走
 * role="switch" + aria-checked；错误横幅 role="alert"、探活结果 role="status"。
 *
 * 图标一律内联 SVG（不用 emoji / 字形符号），跟随 currentColor 与主题变量。
 */
import * as React from "react";
import { api, cwdQueryOf } from "../core/api.ts";
import { API, STATUS_BUCKETS, statusDot, statusTone, statusTextKey } from "../core/constants.ts";
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

/** 副标题：传输 · 端点。失败详情另起一行，不挤进摘要（长错误不再被截断吞掉）。 */
function cardSubtitle(server: ServerRow): string {
  return `${server.transport} · ${endpointSummary(server)}`;
}

/** 状态可见文案（未知状态原样回显，不吞信息）。 */
function statusLabel(status: string): string {
  const key = statusTextKey(status);
  return key === undefined ? status : t(key);
}

/**
 * 解包 mcpServers 包裹形态：Claude Desktop / Cursor 导出的都是
 * `{"mcpServers": {...}}`，而宿主 parser 只接受裸 map（`{名称: 配置}`）。
 * 在客户端解包，两种形态都能直接粘贴；解包失败原样透传，把报错权留给宿主
 * （保持单一错误来源）。
 */
function unwrapServers(text: string): string {
  try {
    const doc = JSON.parse(text);
    if (doc !== null && typeof doc === "object" && !Array.isArray(doc)) {
      const inner = (doc as Record<string, unknown>).mcpServers;
      if (inner !== null && typeof inner === "object" && !Array.isArray(inner)) return JSON.stringify(inner);
    }
  } catch {
    // 非法 JSON：原样交给宿主报错
  }
  return text;
}

/** 服务器图标（内联 SVG，跟随 currentColor）。 */
function ServerGlyph(): any {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </svg>
  );
}

/** 刷新图标。 */
function RefreshGlyph(): any {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 5v6h-6" />
    </svg>
  );
}

/** 加号图标。 */
function PlusGlyph(): any {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
      strokeWidth="2.1" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** 导入图标。 */
function ImportGlyph(): any {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}

/** 状态徽章：色点 + 文字（颜色不是唯一通道）。 */
function StatusBadge(props: { status: string }): any {
  return (
    <span className={`ms-badge ms-badge-${statusTone(props.status)}`}>
      <span className="ms-dot" style={{ background: statusDot(props.status) }} aria-hidden="true" />
      {statusLabel(props.status)}
    </span>
  );
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

/** 单台服务器卡片。 */
interface ServerCardProps {
  /** React 保留字 key：宿主 React 类型经 factory 注入（无 @types/react），此处声明仅为通过 JSX 属性检查，运行时读不到。 */
  key?: string;
  server: ServerRow;
  probe: ProbeView | undefined;
  busy: boolean;
  onProbe(server: ServerRow): void;
  onToggle(server: ServerRow, next: boolean): void;
  onEdit(server: ServerRow): void;
}

function ServerCard(props: ServerCardProps): any {
  const { server, probe, busy, onProbe, onToggle, onEdit } = props;
  const enabled = server.enabled !== false && server.status !== "disabled";
  const toolCount = server.tools?.length ?? 0;
  const disabledCount = server.disabledTools?.length ?? 0;
  const showTools = toolCount > 0 || disabledCount > 0 || server.status === "connected";
  return (
    <div className="ms-card" title={server.status === "failed" ? server.error : undefined}>
      <button
        type="button"
        className="ms-card-hit"
        aria-label={t("editAria", { name: server.name })}
        onClick={() => onEdit(server)}
      />
      <span className="ms-card-glyph" aria-hidden="true">
        <ServerGlyph />
      </span>
      <div className="ms-card-body">
        <div className="ms-card-head">
          <span className="ms-card-name">{server.name}</span>
          <StatusBadge status={server.status} />
        </div>
        <div className="ms-card-sub">{cardSubtitle(server)}</div>
        {server.status === "failed" && server.error !== undefined ? (
          <div className="ms-card-error">
            {t("errorLabel")} · {server.error}
          </div>
        ) : null}
        {showTools ? (
          <div className="ms-card-tools">
            {t("toolsCount", { n: String(toolCount) })}
            {disabledCount > 0 ? ` · ${t("toolDisabledBadge", { n: String(disabledCount) })}` : ""}
          </div>
        ) : null}
        {probe !== undefined ? (
          <div
            className={probe.ok === true ? "ms-probe-ok" : probe.ok === false ? "ms-probe-fail" : "ms-probe-pending"}
            role="status"
            aria-live="polite"
          >
            {probe.pending ? t("testing") : probe.text}
          </div>
        ) : null}
      </div>
      <div className="ms-card-actions">
        <button
          type="button"
          className="ms-btn ms-btn-ghost"
          disabled={probe?.pending === true}
          aria-label={t("probeAria", { name: server.name })}
          onClick={() => onProbe(server)}
        >
          {probe?.pending === true ? t("testing") : t("test")}
        </button>
        <label className={busy ? "ms-switch ms-switch-busy" : "ms-switch"} aria-busy={busy}>
          <input
            type="checkbox"
            role="switch"
            aria-checked={enabled}
            aria-label={t("toggleAria", { name: server.name })}
            checked={enabled}
            onChange={(e: any) => onToggle(server, e.target.checked === true)}
          />
          <span className="ms-switch-slider" aria-hidden="true" />
        </label>
      </div>
    </div>
  );
}

export function ListView(props: ListViewProps): any {
  const { summary, middleware, error, shared, onMiddlewareChange, onRefresh, onCreate, onEdit } = props;
  const [scopeFilter, setScopeFilter] = React.useState("all" as "all" | "global" | "project");
  const [statusFilter, setStatusFilter] = React.useState("all" as string);
  const [query, setQuery] = React.useState("" as string);
  const [probeViews, setProbeViews] = React.useState({} as Record<string, ProbeView>);
  const [busy, setBusy] = React.useState({} as Record<string, boolean>);
  const [actionError, setActionError] = React.useState("" as string);
  const [notice, setNotice] = React.useState("" as string);
  const [importOpen, setImportOpen] = React.useState(false);
  const [importText, setImportText] = React.useState("" as string);
  const [importOverwrite, setImportOverwrite] = React.useState(false);
  const [importBusy, setImportBusy] = React.useState(false);
  const [importScope, setImportScope] = React.useState("" as "" | "global" | "project");

  const servers = summary?.servers ?? [];
  const hasProject = typeof summary?.projectRoot === "string" && summary.projectRoot !== "";
  /** 导入作用域默认跟随当前会话（有项目根即项目级），用户可显式覆盖。 */
  const effectiveImportScope = importScope !== "" ? importScope : hasProject ? "project" : "global";
  const bucket = STATUS_BUCKETS.find((entry) => entry.id === statusFilter);
  const filtered = servers.filter((server) => {
    if (scopeFilter === "global" && server.scope !== "global") return false;
    if (scopeFilter === "project" && server.scope !== "project") return false;
    if (bucket !== undefined && !bucket.match(server.status)) return false;
    const q = query.trim().toLowerCase();
    if (q === "") return true;
    return server.name.toLowerCase().includes(q) || endpointSummary(server).toLowerCase().includes(q);
  });
  const globalGroup = filtered.filter((server) => server.scope === "global");
  const projectGroup = filtered.filter((server) => server.scope === "project");
  const counts: Record<string, number> = { all: servers.length };
  for (const entry of STATUS_BUCKETS) counts[entry.id] = servers.filter((s) => entry.match(s.status)).length;

  /** 启停开关：PATCH enabled；开启后追加 connect（清中间层 userDisabled，幂等）。 */
  const toggleServer = (server: ServerRow, next: boolean) => {
    const key = `${server.scope}/${server.name}`;
    setActionError("");
    setBusy((prev: Record<string, boolean>) => ({ ...prev, [key]: true }));
    const scopeQuery = `?name=${encodeURIComponent(server.name)}&scope=${server.scope}${cwdQueryOf(shared.currentCwd)}`;
    api(`${API.servers}${scopeQuery}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    })
      .then(() => (next ? api(`${API.connect}${scopeQuery}`, { method: "POST" }) : undefined))
      .then(() => onRefresh())
      .catch((e: any) => setActionError(t("actionFail", { msg: String(e?.message ?? e) })))
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

  /** 导入 mcpServers JSON（宿主解析；同名默认跳过，勾选覆盖则更新）。 */
  const runImport = () => {
    setImportBusy(true);
    setActionError("");
    setNotice("");
    api(API.importJson, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        json: unwrapServers(importText),
        scope: effectiveImportScope,
        overwrite: importOverwrite,
        ...(shared.currentCwd !== undefined ? { cwd: shared.currentCwd } : {}),
      }),
      timeoutMs: 20_000,
    })
      .then((result: any) => {
        const imported: string[] = Array.isArray(result?.imported) ? result.imported : [];
        const skipped: string[] = Array.isArray(result?.skipped) ? result.skipped : [];
        if (imported.length === 0 && skipped.length === 0) {
          setActionError(t("importEmpty"));
        } else {
          setNotice(t("importDone", { imported: String(imported.length), skipped: String(skipped.length) }));
          setImportOpen(false);
          setImportText("");
        }
        onRefresh();
      })
      .catch((e: any) => setActionError(t("importFail", { msg: String(e?.message ?? e) })))
      .finally(() => setImportBusy(false));
  };

  const renderGroup = (title: string, group: ServerRow[]) => {
    if (group.length === 0) return null;
    return (
      <div className="ms-group" key={title}>
        <div className="ms-group-title">
          {title} <span className="ms-group-count">{group.length}</span>
        </div>
        <div className="ms-cards">
          {group.map((server) => {
            const key = `${server.scope}/${server.name}`;
            return (
              <ServerCard
                key={key}
                server={server}
                probe={probeViews[key]}
                busy={busy[key] === true}
                onProbe={probeServer}
                onToggle={toggleServer}
                onEdit={onEdit}
              />
            );
          })}
        </div>
      </div>
    );
  };

  const middlewareEffect = middleware === "off"
    ? t("middlewareEffectOff")
    : middleware === "all"
      ? t("middlewareEffectAll")
      : t("middlewareEffectProject");

  return (
    <div className="ms-page">
      <h1 className="ms-title">{t("title")}</h1>
      <p className="ms-subtitle">{t("subtitle")}</p>

      <div className="ms-filters" role="group" aria-label={t("filterStatusAria")}>
        <button
          type="button"
          className={statusFilter === "all" ? "ms-chip ms-chip-active" : "ms-chip"}
          aria-pressed={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
        >
          {t("filterAll")} <span className="ms-chip-count">{counts.all}</span>
        </button>
        {STATUS_BUCKETS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={statusFilter === entry.id ? "ms-chip ms-chip-active" : "ms-chip"}
            aria-pressed={statusFilter === entry.id}
            onClick={() => setStatusFilter(statusFilter === entry.id ? "all" : entry.id)}
          >
            {t(entry.labelKey)} <span className="ms-chip-count">{counts[entry.id]}</span>
          </button>
        ))}
      </div>

      {/* 两条横幅各自独立：加载失败在场时动作失败也必须可见（此前被顶掉）。 */}
      {error !== "" ? <div className="ms-error-banner" role="alert">{error}</div> : null}
      {actionError !== "" ? <div className="ms-error-banner" role="alert">{actionError}</div> : null}
      {notice !== "" ? <div className="ms-ok-banner" role="status">{notice}</div> : null}

      <div className="ms-toolbar">
        <div className="ms-toolbar-left">
          <div className="ms-seg" role="group" aria-label={t("scopeLabel")}>
            {(["all", "global", "project"] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={scopeFilter === id ? "ms-seg-btn ms-seg-active" : "ms-seg-btn"}
                aria-pressed={scopeFilter === id}
                onClick={() => setScopeFilter(id)}
              >
                {id === "all" ? t("scopeAll") : id === "global" ? t("scopeGlobal") : t("scopeProject")}
              </button>
            ))}
          </div>
          <input
            className="ms-search"
            type="search"
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            value={query}
            onChange={(e: any) => setQuery(e.target.value)}
          />
        </div>
        <div className="ms-toolbar-right">
          <label className="ms-mode-label" htmlFor="ms-middleware">{t("middlewareLabel")}</label>
          <select
            id="ms-middleware"
            className="ms-select"
            value={middleware}
            onChange={(e: any) => onMiddlewareChange(e.target.value)}
          >
            <option value="off">{t("middlewareOff")}</option>
            <option value="project">{t("middlewareProject")}</option>
            <option value="all">{t("middlewareAll")}</option>
          </select>
          <button
            type="button"
            className="ms-btn ms-btn-ghost ms-btn-icon"
            onClick={onRefresh}
            aria-label={t("refresh")}
            title={t("refresh")}
          >
            <RefreshGlyph />
          </button>
          <button
            type="button"
            className="ms-btn ms-btn-ghost"
            aria-expanded={importOpen}
            onClick={() => setImportOpen(!importOpen)}
          >
            <ImportGlyph /> {t("importRun")}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" onClick={onCreate}>
            <PlusGlyph /> {t("create")}
          </button>
        </div>
      </div>
      <div className="ms-hint">{middlewareEffect}</div>

      {importOpen ? (
        <div className="ms-form-card ms-import">
          <div className="ms-import-head">
            <strong>{t("importTitle")}</strong>
          </div>
          <p className="ms-field-hint">{t("importHint")}</p>
          <textarea
            className="ms-json"
            rows={6}
            value={importText}
            spellCheck={false}
            aria-label={t("importTitle")}
            placeholder={t("importPlaceholder")}
            onChange={(e: any) => setImportText(e.target.value)}
          />
          <div className="ms-import-scope">
            <label className="ms-label" htmlFor="ms-import-scope">{t("fieldScope")}</label>
            <select
              id="ms-import-scope"
              className="ms-select"
              value={effectiveImportScope}
              onChange={(e: any) => setImportScope(e.target.value)}
            >
              <option value="global">{t("scopeGlobal")}</option>
              <option value="project" disabled={!hasProject}>{t("scopeProject")}</option>
            </select>
            <div className="ms-field-hint">
              {effectiveImportScope === "global" ? t("scopeGlobalHint") : t("scopeProjectHint")}
            </div>
          </div>
          <div className="ms-form-footer">
            <label className="ms-check">
              <input type="checkbox" checked={importOverwrite} onChange={(e: any) => setImportOverwrite(e.target.checked === true)} />
              {t("importOverwrite")}
            </label>
            <div className="ms-form-footer-right">
              <button type="button" className="ms-btn ms-btn-ghost" disabled={importBusy} onClick={() => setImportOpen(false)}>
                {t("cancel")}
              </button>
              <button type="button" className="ms-btn ms-btn-primary" disabled={importBusy || importText.trim() === ""} onClick={runImport}>
                {importBusy ? t("saving") : t("importRun")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {summary === null ? null : (
        <div className="ms-groups">
          {renderGroup(t("groupGlobal"), globalGroup)}
          {renderGroup(t("groupProject"), projectGroup)}
          {filtered.length === 0 ? (
            <div className="ms-empty">
              {servers.length === 0
                ? t("emptyList")
                : query.trim() !== ""
                  ? t("emptyFilter", { q: query.trim() })
                  : t("emptyFilterStatus")}
            </div>
          ) : null}
          {projectGroup.length === 0 && scopeFilter !== "global" && servers.length > 0 && query.trim() === "" ? (
            <div className="ms-hint">{hasProject ? t("noProjectServers") : t("noProjectHint")}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

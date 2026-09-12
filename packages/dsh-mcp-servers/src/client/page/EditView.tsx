/**
 * dsh-mcp-servers — 设置页编辑视图：表单 / JSON 双模式，新建与编辑共用。
 *
 * 字段模型对齐目标设计：名称（新建可填、编辑只读——name 是存储键）、作用域
 * （编辑锁定）、类型（stdio / streamable-http）、超时 MS、命令/参数/环境变量/
 * 工作目录（stdio）或 URL/请求头（http）；底部左删除（确认）、右保存/取消。
 * 保存：新建 POST /servers，编辑 PATCH /servers（后端 merge 后重连）。
 */
import * as React from "react";
import { api, cwdQueryOf } from "../core/api.ts";
import { API } from "../core/constants.ts";
import { t } from "../../../../../shared/client/i18n.js";
import type { SharedSessionState } from "../core/session.ts";
import type { ServerRow } from "./McpServersPage.tsx";

/** 按空格拆分参数；双引号包裹的段可含空格（Windows 路径场景）。 */
export function splitArgs(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  for (const m of input.matchAll(re)) {
    out.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return out;
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
function formatKeyValueLines(obj: Record<string, string> | undefined, sep: string): string {
  if (obj === undefined) return "";
  return Object.entries(obj).map(([k, v]) => `${k}${sep}${v}`).join("\n");
}

interface EditViewProps {
  /** null = 新建。 */
  server: ServerRow | null;
  shared: SharedSessionState;
  onClose(): void;
  onSaved(): void;
}

export function EditView(props: EditViewProps): any {
  const { server, shared, onClose, onSaved } = props;
  const isEdit = server !== null;
  const [name, setName] = React.useState(server?.name ?? "");
  const [scope, setScope] = React.useState((server?.scope === "project" ? "project" : "global") as "global" | "project");
  const [transport, setTransport] = React.useState((server?.transport ?? "stdio") as "stdio" | "streamable-http");
  const [command, setCommand] = React.useState(server?.command ?? "");
  const [args, setArgs] = React.useState(Array.isArray(server?.args) ? server.args.join(" ") : "");
  const [env, setEnv] = React.useState(formatKeyValueLines(server?.env, "="));
  const [cwd, setCwd] = React.useState(server?.cwd ?? "");
  const [url, setUrl] = React.useState(server?.url ?? "");
  const [headers, setHeaders] = React.useState(formatKeyValueLines(server?.headers, ": "));
  const [timeout, setTimeoutMs] = React.useState(server?.toolCallTimeoutMs !== undefined ? String(server.toolCallTimeoutMs) : "");
  const [mode, setMode] = React.useState("form" as "form" | "json");
  const [jsonText, setJsonText] = React.useState(() => {
    if (server !== null) {
      const { name: _n, scope: _s, status: _st, error: _e, tools: _t, disabledTools: _d, ...config } = server;
      return JSON.stringify(config, null, 2) as string;
    }
    return JSON.stringify({ transport: "stdio", command: "", args: [] }, null, 2) as string;
  });
  const [busy, setBusy] = React.useState(false);
  const [probe, setProbe] = React.useState(undefined as { pending: boolean; text?: string; ok?: boolean } | undefined);
  const [errorText, setErrorText] = React.useState("");

  const scopeQuery = isEdit
    ? `?name=${encodeURIComponent(server.name)}&scope=${server.scope}${cwdQueryOf(shared.currentCwd)}`
    : "";

  /** 表单 → 配置对象。 */
  const buildPayload = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = { transport };
    if (timeout.trim() !== "" && Number.isFinite(Number(timeout))) payload.toolCallTimeoutMs = Math.floor(Number(timeout));
    if (transport === "stdio") {
      payload.command = command.trim();
      payload.args = splitArgs(args);
      const envObj = parseKeyValueLines(env, "=");
      if (Object.keys(envObj).length > 0) payload.env = envObj;
      if (cwd.trim() !== "") payload.cwd = cwd.trim();
    } else {
      payload.url = url.trim();
      const headerObj = parseKeyValueLines(headers, ":");
      if (Object.keys(headerObj).length > 0) payload.headers = headerObj;
    }
    return payload;
  };

  const saveWith = (payload: Record<string, unknown>): void => {
    setBusy(true);
    setErrorText("");
    const request = isEdit
      ? api(`${API.servers}${scopeQuery}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
      : api(`${API.servers}${cwdQueryOf(shared.currentCwd).replace("&", "?")}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, name: name.trim(), scope }),
        });
    request
      .then(() => onSaved())
      .catch((e: any) => setErrorText(t("saveFail", { msg: String(e?.message ?? e) })))
      .finally(() => setBusy(false));
  };

  const onSave = (): void => {
    if (mode === "json") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch (e: any) {
        setErrorText(t("jsonInvalid", { msg: String(e?.message ?? e) }));
        return;
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        setErrorText(t("jsonInvalid", { msg: "object expected" }));
        return;
      }
      const payload = { ...(parsed as Record<string, unknown>) };
      if (!isEdit) payload.name = name.trim();
      saveWith(payload);
      return;
    }
    if (!isEdit && name.trim() === "") {
      setErrorText(t("saveFail", { msg: "name is required" }));
      return;
    }
    saveWith(buildPayload());
  };

  const onDelete = (): void => {
    if (!isEdit) return;
    if (window.confirm(t("deleteConfirm", { name: server.name })) !== true) return;
    setBusy(true);
    api(`${API.servers}${scopeQuery}`, { method: "DELETE" })
      .then(() => onSaved())
      .catch((e: any) => setErrorText(t("actionFail", { msg: String(e?.message ?? e) })))
      .finally(() => setBusy(false));
  };

  const onTest = (): void => {
    if (!isEdit) return;
    setProbe({ pending: true });
    api(`${API.probe}${scopeQuery}`, { method: "POST", timeoutMs: 20_000 })
      .then((result: any) => {
        setProbe(
          result?.ok === true
            ? { pending: false, ok: true, text: t("testOk", { latency: String(result.latencyMs ?? "?"), tools: String(result.toolCount ?? 0) }) }
            : { pending: false, ok: false, text: t("testFail", { error: String(result?.error ?? "unknown") }) },
        );
      })
      .catch((e: any) => setProbe({ pending: false, ok: false, text: t("testFail", { error: String(e?.message ?? e) }) }));
  };

  return (
    <div className="ms-page">
      <div className="ms-breadcrumb">
        <button className="ms-breadcrumb-root" onClick={onClose}>{t("breadcrumbRoot")}</button>
        <span className="ms-breadcrumb-sep">›</span>
        <span className="ms-breadcrumb-current">{isEdit ? server.name : t("create")}</span>
      </div>
      <div className="ms-edit-head">
        <div>
          <h1 className="ms-title">{isEdit ? t("editTitle") : t("createTitle")}</h1>
          <p className="ms-subtitle">{isEdit ? t("editSubtitle") : t("createSubtitle")}</p>
        </div>
        <div className="ms-mode-switch">
          <button className={mode === "form" ? "ms-mode-active" : ""} onClick={() => setMode("form")}>{t("modeForm")}</button>
          <button className={mode === "json" ? "ms-mode-active" : ""} onClick={() => setMode("json")}>{t("modeJson")}</button>
        </div>
      </div>
      {errorText !== "" ? <div className="ms-error-banner">{errorText}</div> : null}
      <div className="ms-form-card">
        {mode === "form" ? (
          <div className="ms-form">
            <div className="ms-field-row">
              <div className="ms-field">
                <label className="ms-label">{t("fieldName")}</label>
                <input className="ms-input" value={name} disabled={isEdit} onChange={(e: any) => setName(e.target.value)} />
                {isEdit ? null : <div className="ms-field-hint">{t("fieldNameHint")}</div>}
              </div>
              <div className="ms-field">
                <label className="ms-label">{t("fieldScope")}</label>
                <select className="ms-select" value={scope} disabled={isEdit} onChange={(e: any) => setScope(e.target.value)}>
                  <option value="global">{t("scopeGlobal")}</option>
                  <option value="project">{t("scopeProject")}</option>
                </select>
                <div className="ms-field-hint">{scope === "global" ? t("scopeGlobalHint") : t("scopeProjectHint")}</div>
              </div>
            </div>
            <div className="ms-field">
              <label className="ms-label">{t("fieldType")}</label>
              <select className="ms-select" value={transport} onChange={(e: any) => setTransport(e.target.value)}>
                <option value="stdio">{t("typeStdio")}</option>
                <option value="streamable-http">{t("typeHttp")}</option>
              </select>
            </div>
            <div className="ms-field ms-field-narrow">
              <label className="ms-label">{t("fieldTimeout")}</label>
              <input className="ms-input" value={timeout} placeholder="30000" onChange={(e: any) => setTimeoutMs(e.target.value)} />
              <div className="ms-field-hint">{t("fieldTimeoutHint")}</div>
            </div>
            {transport === "stdio" ? (
              <>
                <div className="ms-field">
                  <label className="ms-label">{t("fieldCommand")}</label>
                  <input className="ms-input" value={command} onChange={(e: any) => setCommand(e.target.value)} />
                </div>
                <div className="ms-field">
                  <label className="ms-label">{t("fieldArgs")}</label>
                  <input className="ms-input" value={args} onChange={(e: any) => setArgs(e.target.value)} />
                </div>
                <div className="ms-field">
                  <label className="ms-label">{t("fieldEnv")}</label>
                  <textarea className="ms-textarea" rows={3} value={env} onChange={(e: any) => setEnv(e.target.value)} />
                </div>
                <div className="ms-field">
                  <label className="ms-label">{t("fieldCwd")}</label>
                  <input className="ms-input" value={cwd} onChange={(e: any) => setCwd(e.target.value)} />
                </div>
              </>
            ) : (
              <>
                <div className="ms-field">
                  <label className="ms-label">{t("fieldUrl")}</label>
                  <input className="ms-input" value={url} onChange={(e: any) => setUrl(e.target.value)} />
                </div>
                <div className="ms-field">
                  <label className="ms-label">{t("fieldHeaders")}</label>
                  <textarea className="ms-textarea" rows={3} value={headers} onChange={(e: any) => setHeaders(e.target.value)} />
                </div>
              </>
            )}
          </div>
        ) : (
          <textarea className="ms-json" rows={16} value={jsonText} onChange={(e: any) => setJsonText(e.target.value)} spellCheck={false} />
        )}
        {probe !== undefined ? (
          <div className={probe.ok === true ? "ms-probe-ok" : "ms-probe-fail"}>
            {probe.pending ? t("testing") : probe.text}
          </div>
        ) : null}
        <div className="ms-form-footer">
          {isEdit ? (
            <button className="ms-btn ms-btn-danger" disabled={busy} onClick={onDelete}>{t("delete")}</button>
          ) : null}
          <div className="ms-form-footer-right">
            {isEdit ? (
              <button className="ms-btn ms-btn-ghost" disabled={busy || probe?.pending === true} onClick={onTest}>{t("test")}</button>
            ) : null}
            <button className="ms-btn ms-btn-ghost" disabled={busy} onClick={onClose}>{t("cancel")}</button>
            <button className="ms-btn ms-btn-primary" disabled={busy} onClick={onSave}>
              {busy ? t("saving") : t("save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

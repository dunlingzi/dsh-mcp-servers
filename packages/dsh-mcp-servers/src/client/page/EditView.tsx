/**
 * dsh-mcp-servers — 设置页编辑视图：表单 / JSON 双模式，新建与编辑共用。
 *
 * 字段模型对齐目标设计：名称（新建可填、编辑只读——name 是存储键）、作用域
 * （编辑锁定）、类型（stdio / streamable-http）、超时、命令/参数/环境变量/
 * 工作目录（stdio）或 URL/请求头（http）。
 *
 * 双模式语义（本版收敛）：表单与 JSON **互为镜像**——切到 JSON 会把当前表单
 * 序列化过去，切回表单会把 JSON 解析回填；任一侧的改动都不会被另一侧静默丢弃。
 *
 * 危险操作（删除 / 放弃改动）改为**页内确认条**，不再用 window.confirm 阻塞对话框。
 *
 * 已连接服务器在编辑页额外提供**工具级禁用面板**（PATCH /tool-disable）。
 * 文本 ⇄ 结构化配置的编解码（args / env / headers）统一走 core/args.ts。
 */
import * as React from "react";
import { api, cwdQueryOf, withCwd, toolDisableServerKey } from "../core/api.ts";
import { API } from "../core/constants.ts";
import { rebindSession } from "../core/session.ts";
import {
  splitArgs,
  formatArgs,
  parseKeyValueLines,
  formatKeyValueLines,
  stableJson,
} from "../core/args.ts";
import { t } from "../../../../../shared/client/i18n.js";
import type { SharedSessionState } from "../core/session.ts";
import type { ServerRow } from "./McpServersPage.tsx";

interface EditViewProps {
  /** null = 新建。 */
  server: ServerRow | null;
  shared: SharedSessionState;
  /** 当前工作空间根（工具级禁用需要 @<root>/<server> 全名）。 */
  projectRoot?: string;
  onClose(): void;
  onSaved(): void;
  /** 工具级禁用生效后回列表取新快照（卡片上的「已禁用 N」随之更新）。 */
  onRefresh(): void;
}

/** 工具级禁用面板（PATCH /tool-disable；root 路由一致性校验由宿主裁决）。 */
function ToolPanel(props: {
  /** React 保留字 key：宿主 React 类型经 factory 注入（无 @types/react），此处声明仅为通过 JSX 属性检查，运行时读不到。 */
  key?: string;
  serverKey: string | undefined;
  tools: string[];
  disabledTools: string[];
  globalScope: boolean;
  cwd: string | undefined;
  onApplied(): void;
  onError(msg: string): void;
}): any {
  const { serverKey, tools, disabledTools, globalScope, cwd, onApplied, onError } = props;
  const [disabled, setDisabled] = React.useState(new Set(disabledTools));
  const [pending, setPending] = React.useState({} as Record<string, boolean>);

  const setTool = (tool: string, enabled: boolean) => {
    if (serverKey === undefined) return;
    setPending((prev: Record<string, boolean>) => ({ ...prev, [tool]: true }));
    // 路径无 query → 必须走 withCwd（手拼 cwdQueryOf 的 `&cwd=` 会拼进 pathname，
    // 宿主 exact 路由不命中、请求落到静态 fallback 返 405）。
    api(withCwd(API.toolDisable, cwd), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ server: serverKey, tool, disabled: !enabled }),
    })
      .then(() => {
        setDisabled((prev: Set<string>) => {
          const next = new Set(prev);
          if (enabled) next.delete(tool);
          else next.add(tool);
          return next;
        });
        onApplied();
      })
      .catch((e: any) => onError(t("actionFail", { msg: String(e?.message ?? e) })))
      .finally(() => setPending((prev: Record<string, boolean>) => ({ ...prev, [tool]: false })));
  };

  return (
    <div className="ms-tools">
      <div className="ms-tools-head">
        <strong>{t("toolsTitle")}</strong>
        <span className="ms-tools-summary">
          {t("toolsSummary", { n: String(tools.length), disabled: String(disabled.size) })}
        </span>
      </div>
      {serverKey === undefined ? <div className="ms-field-hint">{t("toolsUnavailable")}</div> : null}
      {tools.length === 0 ? (
        <div className="ms-tools-empty">{t("toolsEmpty")}</div>
      ) : (
        <ul className="ms-tools-list">
          {tools.map((tool) => {
            const enabled = !disabled.has(tool);
            return (
              <li className="ms-tool-row" key={tool}>
                <span className={enabled ? "ms-tool-name" : "ms-tool-name ms-tool-name-off"}>{tool}</span>
                <label className={pending[tool] === true ? "ms-switch ms-switch-busy" : "ms-switch"}>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={t("toolToggleAria", { tool })}
                    disabled={serverKey === undefined}
                    checked={enabled}
                    onChange={(e: any) => setTool(tool, e.target.checked === true)}
                  />
                  <span className="ms-switch-slider" aria-hidden="true" />
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <div className="ms-field-hint">{t("toolsHint")}</div>
      {globalScope ? <div className="ms-field-hint">{t("toolsGlobalHint")}</div> : null}
    </div>
  );
}

export function EditView(props: EditViewProps): any {
  const { server, shared, projectRoot, onClose, onSaved, onRefresh } = props;
  const isEdit = server !== null;
  const [name, setName] = React.useState(server?.name ?? "");
  const [scope, setScope] = React.useState((server?.scope === "project" ? "project" : "global") as "global" | "project");
  const [transport, setTransport] = React.useState((server?.transport ?? "stdio") as "stdio" | "streamable-http");
  const [command, setCommand] = React.useState(server?.command ?? "");
  const [args, setArgs] = React.useState(formatArgs(server?.args));
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
    return JSON.stringify({ name: "", transport: "stdio", command: "", args: [] }, null, 2) as string;
  });
  const [busy, setBusy] = React.useState(false);
  const [probe, setProbe] = React.useState(undefined as { pending: boolean; text?: string; ok?: boolean } | undefined);
  const [errorText, setErrorText] = React.useState("");
  const [confirming, setConfirming] = React.useState("" as "" | "delete" | "discard");

  const scopeQuery = isEdit
    ? `?name=${encodeURIComponent(server.name)}&scope=${server.scope}${cwdQueryOf(shared.currentCwd)}`
    : "";

  /** 表单 → 配置对象（不含 name/scope：这两个在提交时按模式决定来源）。 */
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

  /** 表单的镜像配置（新建页带上 name，使 JSON 视图与表单同形）。 */
  const mirrorJson = (): Record<string, unknown> => {
    const payload = buildPayload();
    return isEdit ? payload : { name: name.trim(), ...payload };
  };

  // 脏值基线：表单镜像在挂载时的稳定序列化 + JSON 侧「最后一次由本组件写入」的文本。
  // 手写 onChange 不再需要逐个 setTouched，改回原值也不会误报未保存（P2）。
  // 注：React 经 factory 注入、类型面是 any，故用 `null as T` 而不用泛型实参。
  const formBaseRef = React.useRef(null as string | null);
  if (formBaseRef.current === null) formBaseRef.current = stableJson(mirrorJson());
  const jsonBaseRef = React.useRef(null as string | null);
  if (jsonBaseRef.current === null) jsonBaseRef.current = jsonText;

  const formDirty = stableJson(mirrorJson()) !== formBaseRef.current;
  const jsonDirty = (() => {
    if (mode !== "json" || jsonText === jsonBaseRef.current) return false;
    try {
      return stableJson(JSON.parse(jsonText)) !== stableJson(JSON.parse(jsonBaseRef.current ?? ""));
    } catch {
      return true; // 解析不了即视为有改动，绝不静默丢弃
    }
  })();
  const dirty = formDirty || jsonDirty;

  /** JSON → 表单字段回填（缺字段按空值处理，不在两侧之间制造半套状态）。 */
  const applyJsonToForm = (parsed: Record<string, unknown>): void => {
    if (!isEdit && typeof parsed.name === "string") setName(parsed.name);
    if (parsed.transport === "stdio" || parsed.transport === "streamable-http") setTransport(parsed.transport);
    setCommand(typeof parsed.command === "string" ? parsed.command : "");
    setArgs(formatArgs(Array.isArray(parsed.args) ? parsed.args : undefined));
    setEnv(formatKeyValueLines(parsed.env as Record<string, string> | undefined, "="));
    setCwd(typeof parsed.cwd === "string" ? parsed.cwd : "");
    setUrl(typeof parsed.url === "string" ? parsed.url : "");
    setHeaders(formatKeyValueLines(parsed.headers as Record<string, string> | undefined, ": "));
    setTimeoutMs(parsed.toolCallTimeoutMs === undefined ? "" : String(parsed.toolCallTimeoutMs));
  };

  /** 切换表单 / JSON：切入前对齐两侧状态，解析失败则停在 JSON 并报错。 */
  const switchMode = (next: "form" | "json"): void => {
    if (next === mode) return;
    if (next === "json") {
      const mirrored = JSON.stringify(mirrorJson(), null, 2);
      setJsonText(mirrored);
      jsonBaseRef.current = mirrored;
      setMode("json");
      return;
    }
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
    applyJsonToForm(parsed as Record<string, unknown>);
    setErrorText("");
    setMode("form");
  };

  /**
   * 提交前校验（表单与 JSON 两条路径共用）。表单态传 `timeoutText` 以便对**输入文本**
   * 判错（buildPayload 会把非法文本静默丢弃）；JSON 态传 undefined，改判 payload 里的值。
   */
  const validate = (payload: Record<string, unknown>, timeoutText: string | undefined): string => {
    const effectiveName = isEdit ? server.name : String(payload.name ?? "").trim();
    if (effectiveName === "") return t("nameRequired");
    if (timeoutText !== undefined) {
      if (timeoutText.trim() !== "" && (!Number.isInteger(Number(timeoutText)) || Number(timeoutText) <= 0)) return t("timeoutInvalid");
    } else {
      const value = payload.toolCallTimeoutMs;
      if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value <= 0)) return t("timeoutInvalid");
    }
    if (payload.transport === "stdio" && String(payload.command ?? "").trim() === "") return t("commandRequired");
    if (payload.transport !== "stdio" && String(payload.url ?? "").trim() === "") return t("urlRequired");
    return "";
  };

  /** 提交：新建时 name/scope 由调用方给的来源决定（表单或 JSON），不互相覆盖。 */
  const saveWith = (payload: Record<string, unknown>, create?: { name: string; scope: string }): void => {
    setBusy(true);
    setErrorText("");
    if (isEdit) {
      api(`${API.servers}${scopeQuery}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
        .then(() => onSaved())
        .catch((e: any) => setErrorText(t("saveFail", { msg: String(e?.message ?? e) })))
        .finally(() => setBusy(false));
      return;
    }
    const targetScope = create?.scope ?? scope;
    // issue #7：会话 cwd 由宿主从 `?cwd=` 读取，而 apply 级 bindSession 的 POST /session 是
    // fire-and-forget（core/session.ts）——项目级新建需要宿主侧已有活跃会话，否则
    // projectStoreOrThrow 会 400。故项目级新建前先 await 一次重绑（宿主 setSession 幂等短路，
    // 正常时零副作用），把这条时序依赖显式化，而不是依赖「请求恰好先到」。
    //
    // 仅在**确有会话 cwd** 时重绑：rebindSession 对空 cwd 会发 `{cwd:""}`，那在宿主侧是
    // 「清空项目级」——「新建」这个动作不该顺带清会话。无 cwd 时跳过重绑，请求照发
    // （项目级会由宿主按既有守卫报「无活跃项目会话」）。
    const hasSessionCwd = typeof shared.currentCwd === "string" && shared.currentCwd !== "";
    const rebind = targetScope === "project" && hasSessionCwd ? rebindSession(shared) : Promise.resolve();
    rebind
      .catch(() => {})
      .then(() =>
        api(withCwd(API.servers, shared.currentCwd), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, name: create?.name ?? name.trim(), scope: targetScope }),
        }),
      )
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
      // 新建时 JSON 里的 name 优先（用户在 JSON 视图里写的名字此前会被表单空值覆盖）。
      const jsonName = typeof payload.name === "string" && payload.name.trim() !== "" ? payload.name.trim() : name.trim();
      payload.name = jsonName;
      const jsonScope = payload.scope === "project" || payload.scope === "global" ? String(payload.scope) : scope;
      const invalid = validate(payload, undefined);
      if (invalid !== "") {
        setErrorText(invalid);
        return;
      }
      saveWith(payload, { name: jsonName, scope: jsonScope });
      return;
    }
    const payload = { ...buildPayload(), name: name.trim() };
    const invalid = validate(payload, timeout);
    if (invalid !== "") {
      setErrorText(invalid);
      return;
    }
    saveWith(payload);
  };

  const onDelete = (): void => {
    if (!isEdit) return;
    setConfirming("");
    setBusy(true);
    api(`${API.servers}${scopeQuery}`, { method: "DELETE" })
      .then(() => onSaved())
      .catch((e: any) => setErrorText(t("actionFail", { msg: String(e?.message ?? e) })))
      .finally(() => setBusy(false));
  };

  /**
   * 返回列表：保存中（busy）时忽略——否则挂起的请求结束后错误横幅落在已卸载的页面上，
   * 用户既没保存成功也没被告知（静默丢弃）。有未保存改动时先就地确认。
   */
  const requestClose = (): void => {
    if (busy) return;
    if (dirty) setConfirming("discard");
    else onClose();
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

  const serverKey = isEdit ? toolDisableServerKey(server, projectRoot) : undefined;
  const toolNames = Array.isArray(server?.tools) ? server.tools : [];
  const disabledNames = Array.isArray(server?.disabledTools) ? server.disabledTools : [];

  return (
    <div className="ms-page">
      <div className="ms-breadcrumb">
        <button type="button" className="ms-breadcrumb-root" aria-label={t("backAria")} disabled={busy} onClick={requestClose}>
          {t("breadcrumbRoot")}
        </button>
        <span className="ms-breadcrumb-sep" aria-hidden="true">›</span>
        <span className="ms-breadcrumb-current">{isEdit ? server.name : t("create")}</span>
      </div>
      <div className="ms-edit-head">
        <div>
          <h1 className="ms-title">{isEdit ? t("editTitle") : t("createTitle")}</h1>
          <p className="ms-subtitle">{isEdit ? t("editSubtitle") : t("createSubtitle")}</p>
        </div>
        <div className="ms-mode-switch" role="group" aria-label={t("fieldType")}>
          <button type="button" className={mode === "form" ? "ms-mode-active" : ""} aria-pressed={mode === "form"} onClick={() => switchMode("form")}>{t("modeForm")}</button>
          <button type="button" className={mode === "json" ? "ms-mode-active" : ""} aria-pressed={mode === "json"} onClick={() => switchMode("json")}>{t("modeJson")}</button>
        </div>
      </div>
      {errorText !== "" ? <div className="ms-error-banner" role="alert">{errorText}</div> : null}
      <div className="ms-form-card">
        {mode === "form" ? (
          <div className="ms-form">
            <div className="ms-field-row">
              <div className="ms-field">
                <label className="ms-label" htmlFor="ms-name">{t("fieldName")}</label>
                <input id="ms-name" className="ms-input" value={name} disabled={isEdit} onChange={(e: any) => setName(e.target.value)} />
                {isEdit ? null : <div className="ms-field-hint">{t("fieldNameHint")}</div>}
              </div>
              <div className="ms-field">
                <label className="ms-label" htmlFor="ms-scope">{t("fieldScope")}</label>
                <select id="ms-scope" className="ms-select" value={scope} disabled={isEdit} onChange={(e: any) => setScope(e.target.value)}>
                  <option value="global">{t("scopeGlobal")}</option>
                  <option value="project">{t("scopeProject")}</option>
                </select>
                <div className="ms-field-hint">{scope === "global" ? t("scopeGlobalHint") : t("scopeProjectHint")}</div>
              </div>
            </div>
            <div className="ms-field-row">
              <div className="ms-field">
                <label className="ms-label" htmlFor="ms-transport">{t("fieldType")}</label>
                <select id="ms-transport" className="ms-select" value={transport} onChange={(e: any) => setTransport(e.target.value)}>
                  <option value="stdio">{t("typeStdio")}</option>
                  <option value="streamable-http">{t("typeHttp")}</option>
                </select>
              </div>
              <div className="ms-field">
                <label className="ms-label" htmlFor="ms-timeout">{t("fieldTimeout")}</label>
                <input id="ms-timeout" className="ms-input" inputMode="numeric" value={timeout} placeholder="30000" onChange={(e: any) => setTimeoutMs(e.target.value)} />
                <div className="ms-field-hint">{t("fieldTimeoutHint")}</div>
              </div>
            </div>
            {transport === "stdio" ? (
              <>
                <div className="ms-field">
                  <label className="ms-label" htmlFor="ms-command">{t("fieldCommand")}</label>
                  <input id="ms-command" className="ms-input" value={command} onChange={(e: any) => setCommand(e.target.value)} />
                </div>
                <div className="ms-field">
                  <label className="ms-label" htmlFor="ms-args">{t("fieldArgs")}</label>
                  <input id="ms-args" className="ms-input" value={args} onChange={(e: any) => setArgs(e.target.value)} />
                </div>
                <div className="ms-field">
                  <label className="ms-label" htmlFor="ms-env">{t("fieldEnv")}</label>
                  <textarea id="ms-env" className="ms-textarea" rows={3} value={env} onChange={(e: any) => setEnv(e.target.value)} />
                </div>
                <div className="ms-field">
                  <label className="ms-label" htmlFor="ms-cwd">{t("fieldCwd")}</label>
                  <input id="ms-cwd" className="ms-input" value={cwd} onChange={(e: any) => setCwd(e.target.value)} />
                </div>
              </>
            ) : (
              <>
                <div className="ms-field">
                  <label className="ms-label" htmlFor="ms-url">{t("fieldUrl")}</label>
                  <input id="ms-url" className="ms-input" value={url} onChange={(e: any) => setUrl(e.target.value)} />
                </div>
                <div className="ms-field">
                  <label className="ms-label" htmlFor="ms-headers">{t("fieldHeaders")}</label>
                  <textarea id="ms-headers" className="ms-textarea" rows={3} value={headers} onChange={(e: any) => setHeaders(e.target.value)} />
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="ms-field-hint">{t("jsonSyncHint")}</div>
            <textarea
              className="ms-json"
              rows={16}
              value={jsonText}
              spellCheck={false}
              aria-label={t("modeJson")}
              onChange={(e: any) => setJsonText(e.target.value)}
            />
          </>
        )}
        {isEdit ? (
          <ToolPanel
            key={`${server.scope}/${server.name}`}
            serverKey={serverKey}
            tools={toolNames}
            disabledTools={disabledNames}
            globalScope={server.scope === "global"}
            cwd={shared.currentCwd}
            onApplied={onRefresh}
            onError={setErrorText}
          />
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
        {confirming !== "" ? (
          <div className="ms-confirm" role="alertdialog" aria-live="assertive">
            <span className="ms-confirm-text">
              {confirming === "delete" && isEdit ? t("deleteConfirm", { name: server.name }) : t("discardConfirm")}
            </span>
            <div className="ms-confirm-actions">
              <button type="button" className="ms-btn ms-btn-ghost" onClick={() => setConfirming("")}>
                {confirming === "delete" ? t("cancel") : t("discardNo")}
              </button>
              <button
                type="button"
                className="ms-btn ms-btn-danger-solid"
                onClick={() => (confirming === "delete" ? onDelete() : onClose())}
              >
                {confirming === "delete" ? t("deleteYes") : t("discardYes")}
              </button>
            </div>
          </div>
        ) : null}
        <div className="ms-form-footer">
          {isEdit ? (
            <button type="button" className="ms-btn ms-btn-danger" disabled={busy} onClick={() => setConfirming("delete")}>{t("delete")}</button>
          ) : null}
          <div className="ms-form-footer-right">
            {isEdit ? (
              <button type="button" className="ms-btn ms-btn-ghost" disabled={busy || probe?.pending === true} onClick={onTest}>{t("test")}</button>
            ) : null}
            <button type="button" className="ms-btn ms-btn-ghost" disabled={busy} onClick={requestClose}>{t("cancel")}</button>
            <button type="button" className="ms-btn ms-btn-primary" disabled={busy} onClick={onSave}>
              {busy ? t("saving") : t("save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

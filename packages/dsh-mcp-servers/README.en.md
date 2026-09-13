# @dunlingzi/dsh-mcp-servers
[![npm](https://img.shields.io/npm/v/@dunlingzi/dsh-mcp-servers)](https://www.npmjs.com/package/@dunlingzi/dsh-mcp-servers)

An **MCP server manager plugin** for DSH (DeepSeek Harness): a dedicated
"MCP Servers" page in the Settings sidebar, showing every MCP server grouped by
status (running / connecting / reconnecting / stopped / disabled / failed), with
add, edit, enable/disable, delete and one-shot probing (stdio / streamable-http
forms plus pasted mcpServers JSON import). Tools of connected servers are
registered to the model as `mcp__<server>__<tool>`; project-level servers go
through the `ws_mcp_*` middleware (four atomic tools) by default. The MCP
protocol client is built on the official SDK transports (stdio child process +
streamable-http), inlined at build time with zero runtime dependencies.

> Split out of dsh-plugin-hub's dsh-mcp-manager as an independent plugin: no
> conversation float window, no plugin config card — everything lives in the
> Settings page. **Mutually exclusive with `@wingsky-1/dsh-mcp-manager`**
> (pick one; both share `<DSH_HOME>/dsh-mcp.json`, so migration is automatic).

## Highlights

- **Bounded context cost**: project-level MCP servers converge through the
  middleware — the model face only occupies four atomic tool slots
  (`ws_mcp_list` / `ws_mcp_detail` / `ws_mcp_search` / `ws_mcp_call`), no
  matter how many servers or tools the workspace registers. `middleware: all`
  converges global servers too (two-level discovery: full inventory via
  `ws_mcp_list`, full schema on demand via `ws_mcp_detail`)
- **Per-project configuration**: project config lives at `<project root>/.dsh/mcp.json`
  (travels with the repo, committable); global config at `<DSH_HOME>/dsh-mcp.json`;
  switching sessions auto-loads the matching MCP set
- **Workspace isolation**: the middleware routes by session cwd with full-name
  consistency checks — same-named servers in different directories never clash
- **Safe defaults**: config stores only `${ENV}` references (0600 permissions +
  atomic writes); stdio child environments are sanitized so credential-shaped
  variables never leak; catalog summaries and error paths go through a redactor
- **Operable**: graded status at a glance; bounded exponential-backoff reconnect;
  per-server "Test" probe (connect once and close, reporting latency and tool
  count, without touching live connections); 8KB result truncation and
  per-server `toolCallTimeoutMs` override

## Install

Requires DeepSeek Harness with `dsh web` running.

```sh
dsh plugin --profile web add @dunlingzi/dsh-mcp-servers      # install
dsh plugin --profile web update @dunlingzi/dsh-mcp-servers   # update
dsh plugin --profile web remove @dunlingzi/dsh-mcp-servers   # remove
```

Without a global `dsh` binary, use `npx`:

```sh
npx @deepseek-ai/dsh plugin --profile web add @dunlingzi/dsh-mcp-servers
```

> Restart `dsh web` once after install/update/remove (bundles compose at
> startup). Then open **Settings → MCP Servers**.

## Usage (Settings → MCP Servers)

- **List view**: scope filter (All / User / Project) + search + refresh + New;
  cards grouped by "User (global) / Project", showing status dot, transport and
  endpoint summary, tool count and an enable toggle; click a card to edit
- **Edit view**: breadcrumb navigation, Form / JSON dual mode; fields: name
  (read-only when editing), scope, transport, timeout MS, command / args / env /
  cwd (stdio) or URL / headers (http); Delete (with confirm) bottom-left,
  Test / Cancel / Save bottom-right
- **Toggle**: ON = save config and connect (hot-applied); OFF = disconnect and
  disable, config kept
- **Test**: one-shot MCP connection (initialize + tools/list) reporting latency
  and tool count; never mutates live connections
- **Middleware mode**: `off / project / all` dropdown in the page header —
  saving hot-applies and persists without restarting dsh web; config changes
  hot-load and the page refreshes via SSE push

## Configuration (middleware)

`middleware: project` (default): project-level servers no longer register
`mcp__` tools; the model reaches them through the four atomic tools.
`middleware: off` restores direct registration for everything; `middleware: all`
converges global servers too (falling back to the global virtual root `@global`
when the session has no project cwd).

| Key | Values | Default |
| --- | --- | --- |
| `middleware` | `off` / `project` (recommended) / `all` | `project` |
| `middlewarePolicy` | `{ allowTools: {<serverKey>: [glob]}, denyTools: {<serverKey>: [glob]} }` (full name `@<root>/<server>` takes precedence over bare name; deny wins) | `{}` |

## Routes (loopback only)

| Route | Purpose |
| --- | --- |
| `/api/dsh-mcp-servers/health` | health check |
| `/api/dsh-mcp-servers/servers` | server CRUD (GET snapshot / POST add / PATCH update / DELETE) |
| `/api/dsh-mcp-servers/servers/connect|disconnect|reconnect` | connection control |
| `/api/dsh-mcp-servers/servers/probe` | one-shot probe (latency + tool count) |
| `/api/dsh-mcp-servers/config` | middleware mode read (GET) / hot-switch (POST) |
| `/api/dsh-mcp-servers/import/json` | paste mcpServers JSON import |
| `/api/dsh-mcp-servers/session` | session switch (project MCP follows session cwd) |
| `/api/dsh-mcp-servers/resume` | controlled rebuild of current workspace connections |
| `/api/dsh-mcp-servers/tool-disable` | per-tool disable switch (PATCH) |
| `/api/dsh-mcp-servers/events` | SSE status push (30s heartbeat + watchdog self-healing) |

## Runtime injection (ctx.mcpServers.registerServer)

Other plugins may register MCP servers at runtime via
`ctx.mcpServers.registerServer` (in-memory only, idempotent). An optional
`toolDefinitions` array (caller-owned `ToolDefinition[]`, bare tool names) makes
the server's tools register with the caller's wrapped definitions — `execute`
stays with the caller and the underlying implementation never leaks; without it,
remote schema projection + generic callTool applies. Model-visible names still
follow the manager naming scheme (`mcp__<server>__<tool>`); per-tool disable /
visibility / capability catalog apply to wrapped tools as usual.

```ts
await ctx.mcpServers.registerServer({
  name: "my-mcp",
  transport: "stdio",
  command: "my-mcp-server",
  args: ["serve", "--mcp"],
  toolDefinitions: [
    {
      name: "my_tool",
      description: "caller-defined wrapped tool",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      output: { schema: { ... }, render(args, value) { ... } },
      execute: async (args) => { await prepare(); return forwarded; },
    },
  ],
});
```

## Data & security

- Server config: `<DSH_HOME>/dsh-mcp.json` (only `${ENV}` references, never
  secrets in plaintext); 0600 permissions + atomic writes
- All `/api/dsh-mcp-servers/*` routes are loopback-only (403 non-loopback, 405 wrong method)
- **stdio child environment sanitization**: credential-shaped variables
  (KEY/TOKEN/SECRET/PASSWORD…) and stale `DSH_*` names are stripped before merging
  the explicit env
- **Workspace isolation**: routing keyed by session cwd; full-name consistency
  checks prevent cross-workspace leakage; policy guard (allowTools/denyTools, deny wins)
- **Per-tool disable** is enforced consistently across `ws_mcp_call`, the
  pre-execute guard for direct `mcp__` tools, and declared discipline tools;
  records persist in `<DSH_HOME>/dsh-mcp-user-state.json`
- **Credential redaction**: catalog summaries and error paths pass through a
  redactor (env/headers/URL user info → `[REDACTED]`)
- **Call stats & debug mode (metadata-only)**: off by default; enable via
  `dsh-mcp-servers.debug.callStats: true` in `~/.dsh/settings.yaml` — metrics are
  persisted atomically to `<DSH_HOME>/mcp-stats.json`, never user arguments or content
- Catalog injection messages use the host-registered generic source form
  (`{ kind: "plugin", plugin: "@dunlingzi/dsh-mcp-servers", form: "snapshot", ... }`),
  avoiding the session-format migration rejection caused by custom `source.kind` values (#723)

## Testing

```sh
curl -s http://127.0.0.1:3080/api/dsh-mcp-servers/health

pnpm --filter @dunlingzi/dsh-mcp-servers build
pnpm --filter @dunlingzi/dsh-mcp-servers test
```

## Known limitations

- No `tools/list_changed` subscription toward remote servers; tool lists refresh
  on reconnect / manual refresh
- The middleware catalog is a last-good snapshot (≤512 tools per server / ≤256KB total)
- Only tools are bridged; MCP resources and prompts have no harness consumer yet
- Requires Node ≥ 20

## Type dependencies

Host-side types come from official `@deepseek-ai/*` packages
(`cordis` / `dsh-host-webserver` / `dsh-agent` / `dsh-tools` / `dsh-system-prompt` /
`dsh-llm`, locked in the repo `pnpm-workspace.yaml` catalog): **`import type` only**,
zero official runtime imports in build artifacts, declared as optional peerDependencies.

## License

MIT

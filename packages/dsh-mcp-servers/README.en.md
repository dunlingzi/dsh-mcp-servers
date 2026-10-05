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

- **List view**: status-cluster filter chips (All / Running / Connecting / Idle /
  Failed — they double as the status legend and carry live counts), scope
  segmented control (All / User / Project), search, refresh, Import JSON, New;
  cards grouped by "User (global) / Project", showing a status dot **plus** a text
  badge (colour is never the only channel), transport and endpoint summary, tool
  count and an enable toggle; the whole card is a keyboard-reachable button, and
  a failed server renders its error on its own line
- **Edit view**: breadcrumb navigation, Form / JSON dual mode; fields: name
  (read-only when editing), scope, transport, timeout, command / args / env /
  cwd (stdio) or URL / headers (http); Delete and Cancel use an **inline confirm
  bar** (no blocking `window.confirm`), Test / Cancel / Save bottom-right
- **Form / JSON mirroring**: switching to JSON serializes the current form, and
  switching back parses the JSON into the form — neither side silently discards
  the other's edits (quoted args survive the round trip)
- **Tool-level disable**: connected servers list their tools in the edit view
  (`tools/list`) with a per-tool switch; a disabled tool is invisible to the
  model through every entry point. Records for global servers are shared across
  workspaces
- **Lossless args round-trip**: the args text field and the structured array are
  strictly inverse (spaces, double quotes, backslashes and empty-string args all
  survive item-by-item) — opening the editor and saving never rewrites your config
- **Import**: the toolbar's Import panel accepts mcpServers JSON — both the
  Claude Desktop / Cursor wrapper `{"mcpServers": {...}}` (unwrapped client-side)
  and a bare `{"name": {...}}` map; existing names are skipped unless "overwrite"
  is checked; the **scope is selectable** (defaults to the current session:
  project-level when a project root exists) and the landing file is shown right
  below (`<DSH_HOME>/dsh-mcp.json` or `<project root>/.dsh/mcp.json`)
- **Toggle**: ON = save config and connect (hot-applied); OFF = disconnect and
  disable, config kept
- **Test**: one-shot MCP connection (initialize + tools/list) reporting latency
  and tool count; never mutates live connections
- **Middleware mode**: `off / project / all` dropdown, with the effective
  behaviour explained on its own line — saving hot-applies and persists
  without restarting dsh web; config changes hot-load and the page refreshes via
  SSE push

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
| `/api/dsh-mcp-servers/servers` | server CRUD (GET snapshot / POST add / PATCH update / DELETE); the session cwd travels in the `?cwd=` query parameter, while the body `cwd` is the server working directory (stdio child cwd) — same name, different meaning |
| `/api/dsh-mcp-servers/servers/connect|disconnect|reconnect` | connection control |
| `/api/dsh-mcp-servers/servers/probe` | one-shot probe (latency + tool count) |
| `/api/dsh-mcp-servers/config` | middleware mode read (GET) / hot-switch (POST) |
| `/api/dsh-mcp-servers/import/json` | paste mcpServers JSON import |
| `/api/dsh-mcp-servers/session` | session switch (project MCP follows session cwd); the only entry point that can explicitly switch or clear the project scope |
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
- **The session cwd travels only in the query parameter**: every route reads it from
  `?cwd=` and **never from the request body**; a body `cwd` is merely the server working
  directory (stdio child cwd). Same name, different meaning — write routes treat an empty
  value as a no-op and never clear the project scope; switching or clearing it is reserved
  for `POST /session`
- **Per-tool disable** is enforced consistently across `ws_mcp_call`, the
  pre-execute guard for direct `mcp__` tools, and declared discipline tools;
  records persist in `<DSH_HOME>/dsh-mcp-user-state.json`
- **Credential redaction**: catalog summaries and error paths pass through a
  redactor (env/headers/URL user info → `[REDACTED]`)
- **Call stats & debug mode (metadata-only)**: off by default; enable via
  `dsh-mcp-servers.debug.callStats: true` in `~/.dsh/settings.yaml` — metrics are
  persisted atomically to `<DSH_HOME>/mcp-stats.json`, never user arguments or content
- Catalog injection messages use the plugin's own producer source kind
  (`{ kind: "dsh-mcp-servers", form: "snapshot", ... }`), replacing the removed host
  `plugin` kind (dsh 0.1.7-rc.1); the read side stays compatible with the legacy
  `plugin` / `mcp-catalog` and migrated `plugin:@dunlingzi/dsh-mcp-servers` forms (#723)

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

# dsh-mcp-servers

An **MCP server manager plugin** for DeepSeek Harness (DSH): a dedicated
"MCP Servers" page in the `dsh web` Settings sidebar — every MCP server shown
with graded status, supporting add, edit, enable/disable, delete and one-shot
probing; tools of connected servers are registered to the model, and
project-level servers converge through the middleware by default.

See [packages/dsh-mcp-servers](packages/dsh-mcp-servers/README.en.md)
（[中文](packages/dsh-mcp-servers/README.md)） for the full feature list,
configuration reference and security model.

## TL;DR

- Install: `dsh plugin --profile web add @dunlingzi/dsh-mcp-servers`, restart
  `dsh web` once
- Use: open **Settings → MCP Servers** — list / create / edit / toggle /
  delete / test / middleware switch
- Bounded context: project-level MCP servers are reached via the four atomic
  tools `ws_mcp_list / detail / search / call`, so no system-prompt bloat

## Repo layout

```
packages/dsh-mcp-servers/   the plugin package (host src/ + browser src/client/)
shared/                     host/client shared modules (loopback fence / sse-hub / host-utils)
scripts/build/              build chain (tsc + esbuild inlining + client contract shell)
scripts/gate/               gates (contract / pack-check / verify-npm-layout / lint / …)
scripts/data/               single sources of truth (plugins-manifest / mutation topology / gauntlet)
tools/lint/                 ESLint complexity gate
test/                       cross-package contract fixtures
.dsh/skills/                project-level skills (dev / review / release / upgrade playbooks)
```

## Development

```sh
pnpm install
pnpm build           # build the plugin package (tsc + bundle-host + client)
pnpm test            # vitest: unit / integration / e2e
pnpm typecheck
pnpm gate:pr         # pre-PR minimal gate (incremental slices + static gates)
pnpm gate:full       # full gate before release
```

Repo rules and the gate matrix live in [AGENTS.md](AGENTS.md); development
conventions in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Version policy (rc only)

Only dsh rc builds are targeted — not alphas. The single source of truth for the
adaptation baseline is the `catalog` in `pnpm-workspace.yaml`.

## License

MIT

# MCP Registry Submission Playbook — @altronis/sgdata-mcp

_Generated 2026-04-09 from live registry research. Execute in order._

## 1. Official MCP Registry (modelcontextprotocol/registry)

- **URL:** https://registry.modelcontextprotocol.io (API v0.1, frozen 2025-10-24)
- **Mechanism:** CLI `mcp-publisher` (NOT a PR). Namespace auto-verified via GitHub OAuth device flow.
- **Steps:**
  1. `brew install mcp-publisher` OR download binary from https://github.com/modelcontextprotocol/registry/releases/latest
  2. In sg-data-mcp repo root: `mcp-publisher init` → generates `server.json`
  3. Add `"mcpName": "io.github.sypherin/sgdata-mcp"` to `package.json`
  4. `npm publish` first (already done for 0.1.0)
  5. `mcp-publisher login github` (device flow)
  6. `mcp-publisher publish`

- **server.json:**
```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.sypherin/sgdata-mcp",
  "description": "Singapore government data MCP server — 46 tools across ACRA, HDB, COE, URA, SingStat, MAS, IRAS, MOE, ECDA, tourism. Local SQLite cache.",
  "repository": { "url": "https://github.com/sypherin/sgdata-mcp", "source": "github" },
  "version": "0.1.0",
  "packages": [{
    "registryType": "npm",
    "identifier": "@altronis/sgdata-mcp",
    "version": "0.1.0",
    "transport": { "type": "stdio" }
  }]
}
```

- **Gotchas:** Namespace MUST be `io.github.sypherin/...` (your GH username, not `altronis`). `mcpName` in package.json MUST equal server.json `name`. Versions in package.json, server.json, npm must match.

## 2. punkpeye/awesome-mcp-servers (GitHub PR)

- **URL:** https://github.com/punkpeye/awesome-mcp-servers
- **Section:** `### 📊 Data Platforms` (~line 685, alphabetical by repo slug)
- **Legend:** `📇` TS/JS, `🏠` Local, `🍎 🪟 🐧` cross-platform
- **Entry (insert alphabetically near `saikiyusuke/registep-mcp`):**
```
- [sypherin/sgdata-mcp](https://github.com/sypherin/sgdata-mcp) 📇 🏠 ☁️ 🍎 🪟 🐧 - Singapore government open data: 46 tools across 15 datasets — ACRA business registry, HDB resale prices, COE bids, URA private property, SingStat economy, MAS finance, IRAS tax, MOE schools, ECDA childcare, tourism. Local SQLite cache, zero API keys. `npx -y @altronis/sgdata-mcp`
```

- **PR title:** `Add sypherin/sgdata-mcp to Data Platforms`
- **PR body:**
```
Adds sgdata-mcp, a comprehensive Singapore government open data MCP server.
- 46 tools across 15 datasets (ACRA, HDB, COE, URA, SingStat, MAS, IRAS, MOE, ECDA, STB)
- TypeScript, stdio transport, local SQLite cache
- npm: https://www.npmjs.com/package/@altronis/sgdata-mcp
- MIT licensed
Inserted alphabetically in Data Platforms section.
```

- **Gotchas:** No CLA. No min stars. Keep to one line. Alphabetical order by repo slug.

## 3. mcp.so (chatmcp/mcpso)

- **URL:** https://github.com/chatmcp/mcpso/issues/1
- **Mechanism:** Comment on the catch-all submission issue. Informal.
- **Exact comment:**
```
Here is my MCP server for Singapore government data, thanks
https://github.com/sypherin/sgdata-mcp
```

## 4. Smithery.ai

- **URL:** https://smithery.ai/new
- **Mechanism:** Manual web form. GitHub login as `sypherin`.
- **Flow:** Paste GitHub URL → Smithery tries auto-scan → stdio-only means it may need manual `/.well-known/mcp/server-card.json` in the repo.

## 5. Glama.ai

- **URL:** https://glama.ai/mcp/servers
- **Mechanism:** Auto-discovery + claim. Likely already indexed within 24h of punkpeye PR merge.
- **Action:** Search `https://glama.ai/mcp/servers?query=sgdata-mcp`. Click "Claim this server" (GitHub login as `sypherin`). If not listed, click "Add Server" top-right.

## Execution order

1. Official Registry via `mcp-publisher` — 5 min, canonical identity
2. punkpeye PR — 10 min, highest organic traffic
3. mcp.so issue comment — 1 min
4. Smithery form — 5 min
5. Glama claim after 24h

# @altronis/sgdata-mcp

> A Singapore government data MCP server. **46 tools, 15 curated datasets**,
> covering ACRA + HDB + URA + COE + CPI + GDP + employment + IRAS + MAS FX + MOE + ECDA + tourism + retail.
> Local SQLite cache. No API keys. Runs anywhere MCP runs.

[![npm version](https://img.shields.io/npm/v/@altronis/sgdata-mcp.svg)](https://www.npmjs.com/package/@altronis/sgdata-mcp)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-2024--11--05-blue.svg)](https://modelcontextprotocol.io)

`@altronis/sgdata-mcp` is an [MCP](https://modelcontextprotocol.io) server that
lets Claude, Cursor, Continue, or any other MCP-compatible client query
Singapore government open data directly from data.gov.sg — corporate registry,
real estate, labour, prices, public services, capital flows.

It runs as a local stdio process on your machine. No hosted backend, no API
keys, no rate limits. First-time queries fetch straight from data.gov.sg;
repeat queries hit a local SQLite cache at `~/.sgdata-mcp/sgdata.sqlite`.

---

## What you can ask Claude

Drop this server into Claude Desktop and you immediately unlock questions like:

- *"Find all AI/ML companies (SSIC 62019) incorporated in Singapore in 2025."*
- *"What's the median resale price of 4-room HDB flats in Punggol over the last 6 months?"*
- *"What is the latest COE Category A premium, and how has it trended over 12 months?"*
- *"How many Chinese tourists visited Singapore last month, and is that above pre-2020?"*
- *"What was SGD/USD in January 2026? Give me a 12-month trend line."*
- *"Which industry sectors had the highest YoY GDP growth in 2025Q4?"*
- *"List SPARK-certified childcare centres with infant vacancies in postal sector 60."*
- *"What percentage of IRAS total revenue comes from GST?"*
- *"Look up DBS Bank by UEN 196800306E."*
- *"Which CPI categories are running hottest in 2026 vs headline inflation?"*
- *"How many new private residential units were sold in Singapore last quarter?"*
- *"Find all SAP secondary schools in the East zone."*

Your model picks the right tool, fills in the filters, and returns structured
rows. You never write a URL.

---

## Quick start

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "sg-data": {
      "command": "npx",
      "args": ["-y", "@altronis/sgdata-mcp"]
    }
  }
}
```

Restart Claude Desktop. The 46 `sg_*` tools appear in the MCP tools menu.

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sg-data": {
      "command": "npx",
      "args": ["-y", "@altronis/sgdata-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add sg-data -- npx -y @altronis/sgdata-mcp
```

Or edit `~/.claude.json` and add the entry under `mcpServers`.

### Continue

Add to `~/.continue/config.yaml`:

```yaml
mcpServers:
  - name: sg-data
    command: npx
    args:
      - -y
      - "@altronis/sgdata-mcp"
```

### Any other MCP client

The server speaks the 2024-11-05 MCP protocol over stdio. Any compliant
client works. The only requirements are Node.js 20+ on the host machine.

### Standalone (kick the tyres)

```bash
# Run it under npx without installing
npx -y @altronis/sgdata-mcp

# Or install globally
npm install -g @altronis/sgdata-mcp
sgdata-mcp
```

Smoke-test it over stdio with a scripted JSON-RPC handshake:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | npx -y @altronis/sgdata-mcp
```

You should see 46 tools in the response.

---

## What's in the box

### Datasets (15)

| # | Dataset | Agency | Rows | Refresh | Tools |
|---|---------|--------|------|---------|-------|
| 1 | ACRA Corporate Entities | ACRA | ~2.0M+ | monthly | 3 |
| 2 | HDB Resale Flat Prices (2017+) | HDB | ~210k | weekly | 2 |
| 3 | COE Bidding Results | LTA | ~2,500 | weekly | 3 |
| 4 | MOE Schools | MOE | ~350 | quarterly | 3 |
| 5 | HDB Carpark Information | HDB | ~2,200 | monthly | 3 |
| 6 | GDP YoY Growth (quarterly) | SingStat | ~80 series | monthly | 3 |
| 7 | Consumer Price Index (monthly) | SingStat | ~780 series | monthly | 3 |
| 8 | MOM Median Gross Monthly Income | MOM | ~120 | annual | 2 |
| 9 | Employment by Sector (annual) | SingStat | ~25 series | annual | 3 |
| 10 | URA Private Residential Transactions | URA | ~600 | quarterly | 3 |
| 11 | International Visitor Arrivals | STB | ~50 series | monthly | 3 |
| 12 | Retail Sales Index (monthly) | SingStat | ~30 series | monthly | 3 |
| 13 | MAS Exchange Rates (monthly avg) | MAS | ~30 series | monthly | 3 |
| 14 | IRAS Tax Collection (annual) | IRAS | ~200 | annual | 3 |
| 15 | ECDA Childcare & Kindergarten Centres | ECDA | ~2,300 | daily | 3 |

Plus **3 generic fallback tools** that work against any of the ~2,000
CSV datasets on data.gov.sg by ID (discover → schema → query). Total: **46 tools.**

All dataset IDs were verified live against the data.gov.sg v2 metadata API on
2026-04-08.

---

### Tools (46)

#### Generic tools — any data.gov.sg dataset

| Tool | Args | Description |
|------|------|-------------|
| `sg_search_datasets` | `query, limit?, agency?, format?` | Full-text discovery across data.gov.sg datasets. Returns IDs + high-level metadata. |
| `sg_dataset_schema` | `datasetId` | Human column labels, agency, format, row count, last updated. Cheap call. |
| `sg_dataset_query` | `datasetId, filters?, like?, limit?, offset?` | Exact-match + substring filter query with pagination. Auto-downloads and caches on first use. |

Use these as a fallback whenever a curated `sg_*` tool doesn't cover your
question — pipe a query through `sg_search_datasets`, pluck the `datasetId`,
check the schema with `sg_dataset_schema`, then pull rows with `sg_dataset_query`.

#### ACRA Corporate Registry (~2M entities, 27 shards)

| Tool | Args | Description |
|------|------|-------------|
| `sg_acra_search_entities` | `query?, ssic_prefix?, status?, incorporated_after?, incorporated_before?, postal_code_prefix?, limit?, offset?` | Full-text + filtered search across all 27 alphabetic shards. Sort by entity_name, paginated. |
| `sg_acra_get_entity` | `uen` | Exact UEN lookup. Returns the full entity row or `found: false`. |
| `sg_acra_formations_by_ssic` | `ssic_prefix, year` | Count formations for an SSIC prefix in a calendar year, plus a 25-row sample. |

#### HDB Resale Flat Prices (~210k transactions, 2017+)

| Tool | Args | Description |
|------|------|-------------|
| `sg_hdb_resale_search` | `town?, flat_type?, month_from?, month_to?, min_price?, max_price?, limit?, offset?` | Filtered, paginated search over every resale transaction since Jan 2017. |
| `sg_hdb_resale_stats` | `town?, flat_type?, month_from?, month_to?` | Aggregate count, median, mean, min, max resale price for a filtered slice. |

#### COE Bidding Results

| Tool | Args | Description |
|------|------|-------------|
| `sg_coe_latest` | `vehicle_class?` | Most recent bidding result per category (or all categories if omitted). |
| `sg_coe_history` | `vehicle_class, months_back?` | Chronological premium time series for one category. |
| `sg_coe_demand_supply` | `vehicle_class, months_back?` | Oversubscription ratio (bids_received / quota) for one category over time. |

#### MOE Schools

| Tool | Args | Description |
|------|------|-------------|
| `sg_moe_search_schools` | `query?, level?, zone?, sap?, gifted?, limit?, offset?` | Filter by name, mainlevel, zone, SAP, Gifted Education Programme status. |
| `sg_moe_school_by_name` | `name` | Exact-match lookup for a single school, with substring fallback. |
| `sg_moe_schools_near` | `postal_code, prefix_length?` | Proximity-by-postal-prefix (cheap proxy, not true geodesic radius). |

#### HDB Carpark Information (static metadata)

| Tool | Args | Description |
|------|------|-------------|
| `sg_hdb_carpark_lookup` | `car_park_no` | Exact lookup by carpark code (e.g. `BJ55`, `ACB`). |
| `sg_hdb_carparks_by_address` | `query, limit?` | Substring search over carpark addresses (e.g. `Tampines`, `Ang Mo Kio Ave 3`). |
| `sg_hdb_carparks_by_type` | `car_park_type?, has_night_parking?, free_parking?, limit?, offset?` | Filter by carpark type, night/free parking availability. |

#### GDP Year-on-Year Growth (quarterly)

| Tool | Args | Description |
|------|------|-------------|
| `sg_gdp_latest` | `industry?` | Most recent YoY growth for a matching industry (defaults to headline GDP). |
| `sg_gdp_history` | `industry, quarters_back?` | Time series of YoY growth for a single industry, oldest-to-newest. |
| `sg_gdp_industry_compare` | `quarter` | All industries ranked by YoY growth for a given quarter. |

#### Consumer Price Index (monthly)

| Tool | Args | Description |
|------|------|-------------|
| `sg_cpi_latest` | `category?` | Most recent CPI value and YoY change (defaults to `All Items`). |
| `sg_cpi_history` | `category, months_back?` | Monthly CPI time series for one sub-index. |
| `sg_cpi_yoy` | `category, month?` | Year-on-year inflation rate for one CPI sub-index in a specific month. |

#### MOM Median Monthly Income

| Tool | Args | Description |
|------|------|-------------|
| `sg_median_income_lookup` | `year?, sex?` | Look up median income by year and/or sex (`Males` / `Females` / `Total`). |
| `sg_median_income_history` | `sex?, years_back?` | Annual median income time series, oldest-to-newest. |

#### Employment by Sector (annual)

| Tool | Args | Description |
|------|------|-------------|
| `sg_employment_by_sector` | `year?, sector?` | Employment counts for a given year, optionally filtered by sector. |
| `sg_employment_sector_history` | `sector, years_back?` | Employment time series for a single sector. |
| `sg_employment_growth` | `sector, base_year, target_year` | Percent change in employment for a sector between two years. |

#### URA Private Residential Transactions (quarterly)

| Tool | Args | Description |
|------|------|-------------|
| `sg_ura_private_txn_latest` | — | Latest quarter, broken down by type_of_sale and sale_status. |
| `sg_ura_private_txn_history` | `type_of_sale?, quarters_back?` | Transaction volumes over time, optionally filtered by sale type. |
| `sg_ura_new_sale_pipeline` | `quarters_back?` | New-sale volume per quarter (summed across sale_status values). |

#### International Visitor Arrivals (monthly)

| Tool | Args | Description |
|------|------|-------------|
| `sg_visitors_latest` | `country?` | Most recent visitor arrivals for a source country (defaults to global total). |
| `sg_visitors_history` | `country?, months_back?` | Monthly arrivals time series for one source country. |
| `sg_visitors_top_sources` | `month?, n?` | Top N source countries for a given month, excluding the `Total` row. |

#### Retail Sales Index (monthly)

| Tool | Args | Description |
|------|------|-------------|
| `sg_retail_sales_latest` | `category?` | Most recent retail sales index value for a sub-industry. |
| `sg_retail_sales_history` | `category?, months_back?` | Monthly retail sales time series. |
| `sg_retail_sales_yoy` | `category, month?` | YoY percent change in retail sales for a sub-industry in a specific month. |

#### MAS Exchange Rates (monthly average)

| Tool | Args | Description |
|------|------|-------------|
| `sg_fx_rate` | `currency, month?` | Monthly SGD exchange rate for one currency (e.g. `U S Dollar`, `Euro`, `Japanese Yen`). |
| `sg_fx_history` | `currency, months_back?` | Monthly SGD rate time series for one currency. |
| `sg_fx_basket` | `month?` | All major SGD currency pairs for a single month. |

#### IRAS Tax Collection (annual)

| Tool | Args | Description |
|------|------|-------------|
| `sg_iras_collection` | `tax_type?, financial_year?` | Look up tax collection by tax type and/or financial year. |
| `sg_iras_collection_history` | `tax_type, years_back?` | Annual collection time series for one tax type. |
| `sg_iras_tax_mix` | `financial_year` | Percentage breakdown of total collection by tax type for one FY. |

#### ECDA Childcare & Kindergarten Centres

| Tool | Args | Description |
|------|------|-------------|
| `sg_ecda_search_centres` | `query?, postal_prefix?, service_model?, has_infant_vacancy?, spark_certified?, limit?, offset?` | Filter by name, postal prefix, service model, vacancy status, SPARK certification. |
| `sg_ecda_centres_near` | `postal_code, prefix_length?` | Proximity-by-postal-prefix search for nearby centres. |
| `sg_ecda_vacancy_summary` | `level, postal_prefix?` | Aggregate vacancy count for a level (`infant` / `pg` / `n1` / `n2` / `k1` / `k2`). |

**Total: 3 generic + 43 curated = 46 tools.**

---

## Architecture

```
┌─────────────────┐    spawn    ┌──────────────────────┐
│ Claude Desktop  │ ──────────▶ │ sgdata-mcp (node)   │
│ /Cursor/Code    │ ◀── stdio ─▶│ runs on your machine │
└─────────────────┘             └──────┬───────────────┘
                                       │ HTTPS (first fetch only)
                                       ▼
                              api.data.gov.sg/v2/...
                                       │
                                       ▼
                            ~/.sgdata-mcp/sgdata.sqlite
                            (shared local SQLite cache)
```

**stdio MCP server.** The CLI binary `sgdata-mcp` speaks JSON-RPC 2.0 over
stdin/stdout using the `@modelcontextprotocol/sdk` library. One server process
per client, spawned by the client (Claude Desktop, Cursor, etc.).

**Local SQLite cache.** The first time you hit a dataset, the server downloads
the CSV from `api-production.data.gov.sg`, parses it, and ingests it into a
per-dataset table in `better-sqlite3`. Subsequent queries hit SQLite directly
— no network, no rate limit, no auth.

**Curated layer-1 handlers.** Each of the 15 curated datasets has a
hand-written handler in `src/datasets/*.ts` that wraps the cache with
dataset-specific semantics (date parsing, wide-to-long transformations,
percent change math, shard fan-out for ACRA).

**Generic layer-2 fallback.** For the long tail of ~2,000 data.gov.sg
datasets not yet curated, the three generic tools (`sg_search_datasets`,
`sg_dataset_schema`, `sg_dataset_query`) let the model discover and query
anything ad-hoc. It'll download and cache on demand with the same 30-day
refresh window.

---

## Caching policy

- **Location.** `~/.sgdata-mcp/sgdata.sqlite` by default.
- **Override.** Set `SGDATA_MCP_CACHE_DIR=/custom/path` before starting the
  server to pick a different directory.
- **Refresh cadence.** Each curated dataset has its own `refreshDays` tuned
  to its real update frequency — daily for ECDA, weekly for HDB resale and
  COE, monthly for ACRA / CPI / GDP / FX / visitors / retail / HDB
  carparks, quarterly for MOE / URA / employment, annual for IRAS / MOM
  income. The generic `sg_dataset_query` uses a 30-day default.
- **Staleness check.** On every query, the server compares `now - ingestedAt`
  against the dataset's refresh window. If stale, it re-downloads before
  serving the query.
- **Wipe the cache.** Delete the SQLite file:

  ```bash
  rm ~/.sgdata-mcp/sgdata.sqlite
  ```

  The next query will rebuild it.
- **Disk footprint.** About 480 MB once everything is hot (ACRA is ~96% of
  that, across 27 shards). Non-ACRA datasets together are under 20 MB.

---

## Comparison

| | `@altronis/sgdata-mcp` | `sgdata-mcp` (by vdineshk) |
|---|---|---|
| Tools | **46** | 5 |
| Coverage | Corporate registry, real estate, prices, labour, tourism, FX, tax, public services | Real-time weather, traffic, carpark availability, taxi availability |
| Positioning | Business & economic intelligence | Real-time operational signals |
| Caching | Yes (SQLite, per-dataset refresh window) | No |
| API keys | None | None |
| ACRA registry (~2M companies) | Yes (27-shard collection, full search + UEN lookup) | No |
| HDB resale history (210k txns) | Yes | No |
| Works offline after first fetch | Yes | No |

We deliberately don't overlap with
[`sgdata-mcp`](https://www.npmjs.com/package/sgdata-mcp) (by vdineshk) —
they cover real-time weather, traffic, carpark availability, and taxi
availability. We cover business and economic data. Install both if you want
the full picture; they're designed to live side-by-side in the same MCP
config (they publish under different package names, so there's no conflict).

---

## FAQ

**Do I need an API key?**
No. data.gov.sg open datasets are public. The server makes anonymous HTTPS
calls to `api-production.data.gov.sg`. There's nothing to sign up for.

**Where is the data stored?**
On your machine, in `~/.sgdata-mcp/sgdata.sqlite`. Nothing ever leaves
your host. Set `SGDATA_MCP_CACHE_DIR` to move it.

**How often is data refreshed?**
Per-dataset. ECDA childcare vacancies refresh daily. HDB resale and COE
weekly. Most SingStat series monthly. URA, MOE, employment quarterly.
IRAS and MOM median income annually. The server checks freshness on every
query and re-fetches automatically when stale.

**How much disk space does it need?**
Up to ~480 MB fully populated (most of which is the ACRA corporate
registry). If you never touch ACRA tools, you'll stay under 20 MB.

**Is this production-ready?**
It runs as a local stdio process with no external dependencies beyond
data.gov.sg itself. Every curated handler has smoke tests. The ACRA shards
are downloaded lazily, one at a time, so first use is incremental. File
issues on GitHub if you hit anything sharp.

**Can I add my own dataset?**
Yes. Either:

1. Use the generic `sg_search_datasets` → `sg_dataset_schema` →
   `sg_dataset_query` chain for ad-hoc queries — no code changes needed.
2. Open a PR adding a new file under `src/datasets/<your_dataset>.ts`
   exporting a `create<Name>Tools(cache, downloader)` factory. We accept
   requests for new curated datasets via GitHub issues.

**How does this compare to writing my own tool calls against data.gov.sg?**
It does three things you'd otherwise build yourself: shard fan-out (ACRA
is split across 27 CSV files), wide-to-long transformation (SingStat CSVs
are wide with one column per quarter/month — we normalise them), and
per-dataset refresh policies. It also keeps a local SQLite cache so repeat
queries are sub-millisecond.

**Does it work on Windows?**
Yes. Node 20+ and `better-sqlite3` build clean on Windows, macOS, and
Linux. The cache dir defaults to `%USERPROFILE%\.sgdata-mcp\` on Windows.

---

## Roadmap

- **More curated datasets on request.** HSA pharmacies, MOH clinics, URA
  price indices, SingStat income components of GDP, MAS daily FX rates,
  business expectations surveys. Open an issue with the `d_xxx` ID and
  your use case.
- **Geo resolution layer.** Parse URA Master Plan subzone / planning area
  GEOJSON into the cache so queries can join HDB `town` → URA planning
  area → postal code → SSIC.
- **Incremental cache refresh.** Today the refresh is whole-dataset. For
  HDB resale and ACRA we could diff on `month` / `registration_date` and
  only fetch deltas.
- **Shared cache mode.** Optional HTTP layer so multiple MCP clients on
  the same machine hit one cache instead of N duplicates.
- **Singa data brain.** We're wiring this server into the Singa chat on
  [altronis.sg](https://altronis.sg) as a public Singapore-data assistant.

---

## License

MIT — © 2026 [Altronis](https://altronis.sg).

See [LICENSE](./LICENSE).

---

## Attribution & data licence

This server redistributes data from [data.gov.sg](https://data.gov.sg).

> Contains information from data.gov.sg which is made available under the
> terms of the [Singapore Open Data Licence v1.0](https://beta.data.gov.sg/open-data-licence).

The MIT licence above covers the **software**; the Singapore Open Data
Licence covers the **data** this software fetches and caches. OGL-SG v1.0
permits free commercial use, redistribution, and derivative works —
attribution is the only requirement, which this notice satisfies for all
datasets sourced through the generic and curated tools in this server.

A small number of datasets on data.gov.sg (notably some MAS, URA, and
SingStat series) may carry additional source-specific terms layered on
top of OGL-SG. If you are redistributing a specific dataset commercially
at scale, check the originating dataset page on data.gov.sg for any
extra conditions before relying on this blanket notice.

See [NOTICE](./NOTICE) for the full attribution statement.

---

## Built by

Built and maintained by **[Altronis](https://altronis.sg)** — a Singapore AI
consultancy. We use this server internally for Singapore business
intelligence work and ship it open-source so everyone else can too.

Found a bug? Want a dataset added? Open an issue on
[GitHub](https://github.com/sypherin/sgdata-mcp) or email
[hello@altronis.sg](mailto:hello@altronis.sg).

If you build something cool on top of this, we'd love to hear about it.

# @altronis/sgdata-mcp

> A Singapore government data MCP server. **71 tools, 24 curated datasets, CLI mode, data visualization, cross-dataset queries, natural language queries.**
> Covering ACRA + HDB + URA + COE + CPI + GDP + employment + IRAS + MAS FX + MOE + ECDA + tourism + retail + population + crime + health + energy + hawkers.
> Local SQLite cache. No API keys. Runs anywhere MCP runs.

[![npm version](https://img.shields.io/npm/v/@altronis/sgdata-mcp.svg)](https://www.npmjs.com/package/@altronis/sgdata-mcp)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-2024--11--05-blue.svg)](https://modelcontextprotocol.io)

`@altronis/sgdata-mcp` is an [MCP](https://modelcontextprotocol.io) server that
lets Claude, Cursor, Continue, or any other MCP-compatible client query
Singapore government open data directly from data.gov.sg — corporate registry,
real estate, labour, prices, public services, capital flows, crime, health,
demographics, energy, and more.

It runs as a local stdio process on your machine. No hosted backend, no API
keys, no rate limits. First-time queries fetch straight from data.gov.sg;
repeat queries hit a local SQLite cache at `~/.sgdata-mcp/sgdata.sqlite`.

**v0.3.1 highlights:** Business entity formation counts by industry via SingStat
Table Builder -- lightweight alternative to bulk ACRA downloads.

**v0.3.0 highlights:** 8 new datasets, CLI mode, ASCII sparkline visualization,
cross-dataset correlation queries, natural language query routing.

---

## What you can ask Claude

Drop this server into Claude Desktop and you immediately unlock questions like:

- *"Find all AI/ML companies (SSIC 62019) incorporated in Singapore in 2025."*
- *"What's the median resale price of 4-room HDB flats in Punggol over the last 6 months?"*
- *"What is the latest COE Category A premium, and how has it trended over 12 months?"*
- *"How many dengue cases were reported this week?"*
- *"What's Singapore's unemployment rate? Show me the trend."*
- *"Compare GDP growth vs crime rates over the last 5 years."*
- *"How many scam cases were recorded in 2024?"*
- *"What is Singapore's population and how fast is it growing?"*
- *"How much electricity did Singapore generate last month?"*
- *"Are birth rates declining? Show me the last 12 months."*
- *"What were Singapore's tourism receipts by component?"*
- *"Find hawker centres near Tampines."*
- *"Which CPI categories are running hottest vs headline inflation?"*
- *"Look up DBS Bank by UEN 196800306E."*

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

Restart Claude Desktop. The 71 `sg_*` tools appear in the MCP tools menu.

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

### CLI mode (new in v0.3.0)

Query Singapore data directly from the terminal — no MCP client needed:

```bash
# Natural language query
npx @altronis/sgdata-mcp query "What is Singapore's unemployment rate?"
npx @altronis/sgdata-mcp query "How many dengue cases this week?"
npx @altronis/sgdata-mcp query "Latest COE prices"

# Call a specific tool
npx @altronis/sgdata-mcp tool sg_crime_compare '{"year":"2024"}'
npx @altronis/sgdata-mcp tool sg_hawker_search '{"query":"bedok"}'

# List available tools and datasets
npx @altronis/sgdata-mcp list
npx @altronis/sgdata-mcp datasets
```

### Standalone (kick the tyres)

```bash
# Run the MCP server directly
npx -y @altronis/sgdata-mcp

# Smoke-test via stdio
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | npx -y @altronis/sgdata-mcp
```

---

## What's in the box

### Datasets (24)

| # | Dataset | Agency | Tools |
|---|---------|--------|-------|
| 1 | ACRA Corporate Entities (~2M+) | ACRA | 3 |
| 2 | HDB Resale Flat Prices (2017+) | HDB | 2 |
| 3 | COE Bidding Results | LTA | 3 |
| 4 | MOE Schools | MOE | 3 |
| 5 | HDB Carpark Information | HDB | 3 |
| 6 | GDP YoY Growth (quarterly) | SingStat | 3 |
| 7 | Consumer Price Index (monthly) | SingStat | 3 |
| 8 | MOM Median Gross Monthly Income | MOM | 2 |
| 9 | Employment by Sector (annual) | SingStat | 3 |
| 10 | URA Private Residential Transactions | URA | 3 |
| 11 | International Visitor Arrivals | STB | 3 |
| 12 | Retail Sales Index (monthly) | SingStat | 3 |
| 13 | MAS Exchange Rates (monthly avg) | MAS | 3 |
| 14 | IRAS Tax Collection (annual) | IRAS | 3 |
| 15 | ECDA Childcare & Kindergarten Centres | ECDA | 3 |
| 16 | **Unemployment Rate (quarterly)** | MOM | 2 |
| 17 | **Population Indicators (annual)** | SingStat | 2 |
| 18 | **Infectious Disease Cases (weekly)** | MOH | 3 |
| 19 | **Electricity Generation (monthly)** | EMA | 2 |
| 20 | **Live-Births by Sex/Ethnicity (monthly)** | SingStat | 2 |
| 21 | **Crime Cases Recorded (annual)** | SPF | 3 |
| 22 | **Tourism Receipts (annual)** | STB | 2 |
| 23 | **Government Hawker Centres** | NEA | 2 |
| 24 | **Business Entity Formations (annual)** | ACRA/DOS | 3 |

Plus **3 generic fallback tools**, **1 visualization tool**, **2 cross-dataset tools**, and **1 natural language query tool**. Total: **71 tools.**

---

### New in v0.3.0

#### Data visualization — `sg_visualize`

Generate ASCII sparkline charts and summary statistics from any time series.
Returns sparklines, min/max/mean/latest, period-over-period change, and
chart-ready JSON for frontend rendering.

```
SG Unemployment Rate (SA): ▁█████▄▄████
Latest: 2 % | Change: +0 (+0%) | Range: 1.8–2 | Mean: 1.97
```

#### Cross-dataset queries — `sg_cross_dataset`

Compare any two datasets side-by-side over time. Automatically aligns
different time granularities (monthly, quarterly, annual):

```json
{
  "dataset_a": "cpi_monthly",
  "dataset_b": "retail_sales",
  "limit": 5
}
```

Returns aligned rows with both values for correlation analysis.

#### Natural language queries — `sg_ask`

Ask questions in plain English — the tool routes to the right dataset
automatically:

```
"What is Singapore's unemployment rate?" → sg_unemployment_latest
"How many dengue cases?" → sg_disease_latest
"COE prices" → sg_coe_latest
"Crime statistics" → sg_crime_latest
```

#### CLI mode — no MCP client needed

Query data directly from your terminal:

```bash
sgdata-cli query "Singapore population growth"
sgdata-cli tool sg_crime_compare '{"year":"2024"}'
sgdata-cli datasets
```

---

### Tools (71)

#### Meta tools

| Tool | Description |
|------|-------------|
| `sg_ask` | Natural language query — ask any question about Singapore data in plain English |
| `sg_visualize` | ASCII sparkline + summary stats + chart-ready JSON from any numeric series |
| `sg_cross_dataset` | Compare two datasets over time with automatic period alignment |
| `sg_list_datasets` | List all 24 curated datasets with IDs, names, and agencies |

#### Generic tools — any data.gov.sg dataset

| Tool | Description |
|------|-------------|
| `sg_search_datasets` | Full-text discovery across all data.gov.sg datasets |
| `sg_dataset_schema` | Column labels, agency, format for any dataset ID |
| `sg_dataset_query` | Query any dataset with filters, auto-downloads and caches |

#### Curated dataset tools (64)

**ACRA** (3): `sg_acra_search_entities`, `sg_acra_get_entity`, `sg_acra_formations_by_ssic`

**HDB Resale** (2): `sg_hdb_resale_search`, `sg_hdb_resale_stats`

**COE** (3): `sg_coe_latest`, `sg_coe_history`, `sg_coe_demand_supply`

**MOE Schools** (3): `sg_moe_search_schools`, `sg_moe_school_by_name`, `sg_moe_schools_near`

**HDB Carparks** (3): `sg_hdb_carpark_lookup`, `sg_hdb_carparks_by_address`, `sg_hdb_carparks_by_type`

**GDP** (3): `sg_gdp_latest`, `sg_gdp_history`, `sg_gdp_industry_compare`

**CPI** (3): `sg_cpi_latest`, `sg_cpi_history`, `sg_cpi_yoy`

**Income** (2): `sg_median_income_lookup`, `sg_median_income_history`

**Employment** (3): `sg_employment_by_sector`, `sg_employment_sector_history`, `sg_employment_growth`

**URA Property** (3): `sg_ura_private_txn_latest`, `sg_ura_private_txn_history`, `sg_ura_new_sale_pipeline`

**Visitor Arrivals** (3): `sg_visitors_latest`, `sg_visitors_history`, `sg_visitors_top_sources`

**Retail Sales** (3): `sg_retail_sales_latest`, `sg_retail_sales_history`, `sg_retail_sales_yoy`

**MAS FX** (3): `sg_fx_rate`, `sg_fx_history`, `sg_fx_basket`

**IRAS Tax** (3): `sg_iras_collection`, `sg_iras_collection_history`, `sg_iras_tax_mix`

**ECDA Childcare** (3): `sg_ecda_search_centres`, `sg_ecda_centres_near`, `sg_ecda_vacancy_summary`

**Unemployment** (2): `sg_unemployment_latest`, `sg_unemployment_history`

**Population** (2): `sg_population_latest`, `sg_population_history`

**Disease/Health** (3): `sg_disease_latest`, `sg_disease_trend`, `sg_disease_list`

**Electricity** (2): `sg_electricity_latest`, `sg_electricity_history`

**Births** (2): `sg_births_latest`, `sg_births_history`

**Crime** (3): `sg_crime_latest`, `sg_crime_history`, `sg_crime_compare`

**Tourism** (2): `sg_tourism_latest`, `sg_tourism_history`

**Hawker Centres** (2): `sg_hawker_search`, `sg_hawker_stats`

**Business Formations** (3): `sg_formations_latest`, `sg_formations_history`, `sg_formations_compare`

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

---

## Caching policy

- **Location.** `~/.sgdata-mcp/sgdata.sqlite` by default.
- **Override.** Set `SGDATA_MCP_CACHE_DIR=/custom/path`.
- **Refresh cadence.** Per-dataset — daily for ECDA, weekly for HDB/COE/disease,
  monthly for ACRA/CPI/GDP/FX/retail/visitors/births/electricity, quarterly for
  MOE/URA/employment/unemployment, annually for IRAS/income/crime/population/tourism.
- **Wipe.** `rm ~/.sgdata-mcp/sgdata.sqlite` — next query rebuilds.
- **Disk.** ~480 MB with ACRA, under 20 MB without.

---

## Comparison

| | `@altronis/sgdata-mcp` | `sgdata-mcp` (by vdineshk) |
|---|---|---|
| Tools | **71** | 5 |
| Coverage | Corporate registry, real estate, prices, labour, tourism, FX, tax, public services, crime, health, demographics, energy | Real-time weather, traffic, carpark availability |
| CLI mode | Yes | No |
| Data visualization | Yes (sparklines + chart-ready JSON) | No |
| Cross-dataset queries | Yes | No |
| NL query routing | Yes | No |
| Caching | Yes (SQLite) | No |
| API keys | None | None |

Both packages complement each other — install both for the full picture.

---

## Disclaimer

This tool fetches and caches data from [data.gov.sg](https://data.gov.sg).
While we take care to preserve data integrity during ingestion, **you should
independently verify any data before making decisions based on it**.

- **Data accuracy.** All data originates from Singapore government agencies via
  data.gov.sg. We do not alter source values, but column mappings, wide-to-long
  transformations, and caching may introduce discrepancies. Always cross-check
  critical figures against the [official source](https://data.gov.sg).
- **Not professional advice.** This tool is not a substitute for professional
  financial, legal, medical, or policy advice. GDP figures, crime statistics,
  disease counts, property prices, and other data are provided for informational
  purposes only.
- **Staleness.** Cached data may be hours to weeks behind the source depending
  on the dataset's refresh window. Check `ingestedAt` timestamps if freshness
  matters.
- **No warranty.** This software is provided "as is" under the MIT licence,
  without warranty of any kind.

---

## FAQ

**Do I need an API key?** No. data.gov.sg open datasets are public.

**Where is the data stored?** On your machine, in `~/.sgdata-mcp/sgdata.sqlite`.

**How often is data refreshed?** Per-dataset, from daily to annually.

**Is this production-ready?** Yes. 71 tools, all tested against live data.
File issues on GitHub if you hit anything sharp.

**Can I add my own dataset?** Yes — either use the generic tools for ad-hoc
queries, or open a PR adding a handler under `src/datasets/`.

---

## License

MIT

## Attribution

Contains information from [data.gov.sg](https://data.gov.sg) under the
[Singapore Open Data Licence v1.0](https://beta.data.gov.sg/open-data-licence).

---

## Contributing

Found a bug? Want a dataset added? Open an issue or PR on
[GitHub](https://github.com/sypherin/sgdata-mcp).

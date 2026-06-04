# Changelog

## 0.4.1 — 2026-06-04

### Bug fixes

- **`sg_dataset_query` hung on very large datasets.** It ingested the entire
  dataset into the local SQLite cache before querying, which blew the call's
  time budget on multi-hundred-MB datasets (e.g. Historical Rainfall, ~1.2 GB).
  It now size-gates: datasets over 20 MB are paged server-side via
  `datastore_search` (bounded, no full download), and if a large dataset has no
  server-side endpoint it returns a clear "too large — use the curated tool"
  error instead of hanging. A 60s ingest time-guard covers size-unreported
  datasets. Normal/small datasets are unchanged (fast cached SQL).
- **`sg_fx_rate` / `sg_fx_history` returned null/empty for ISO currency codes.**
  "USD" never matched the MAS label "US Dollar". Added an ISO-4217 → label map
  and space-insensitive matching, so `USD`, `GBP`, `JPY`, `EUR`, etc. resolve.

### Improvements

- **`sg_tourism_latest` now emits `data_freshness`.** STB's annual receipts
  dataset stops at 2014; the response now carries the same `frozen` freshness
  warning that `sg_disease_*` does, instead of presenting 2014 as current.
- **`_history` tools now return an `available` list on a no-match.** When a
  `crime_type` / `source` / `currency` filter matches nothing, the response
  includes the valid labels so callers can self-correct (was a silent empty).

## 0.4.0 — 2026-05-19

### Bug fixes

- **`sg_disease_*` was silently returning stale 2022 data.** MOH's Weekly
  Infectious Disease Bulletin dataset on data.gov.sg
  (`d_ca168b2cb763640d72c4600a68f9909e`) stopped updating at epi week
  2022-W52, and the tools surfaced the cached values without any indication
  to the caller. The data is now annotated with a `frozen` freshness level
  and a warning string pointing users to `moh.gov.sg`.
- **`sg_hdb_resale_stats` crashed with `RangeError: Maximum call stack size
  exceeded` on unfiltered calls.** `Math.min(...prices)` and
  `Math.max(...prices)` blew the call stack when `prices` had 200k+
  elements (one row per transaction since 2017). Replaced spread with a
  linear reducer.
- **`sg_fx_basket` failed with a raw 404 instead of degrading gracefully.**
  data.gov.sg's v2 metadata endpoint started returning 404 for the MAS FX
  dataset (`d_b2b7ffe00aaec3936ed379369fdf531b`) even though the underlying
  data is still queryable via the v1 `datastore_search` path. The downloader
  now falls back to cached rows if metadata is unreachable, and surfaces a
  helpful error message if no cache exists.
- Bumped MCP `serverInfo.version` from a hardcoded `0.3.0` to track
  `package.json` accurately.

### Feature: `data_freshness` metadata

Every `_latest` tool now returns a `data_freshness` block alongside the
data:

```json
{
  "data_freshness": {
    "last_period": "2026-Q1",
    "last_record_date": "2026-03-31",
    "age_days": 49,
    "level": "fresh",
    "warning": null
  }
}
```

`level` is `fresh`, `ok`, `stale`, or `frozen`. Cadence-aware thresholds:

| kind | stale at | frozen at |
|---|---|---|
| weekly | 21 days | 180 days |
| monthly | 60 days | 365 days |
| quarterly | 150 days | 540 days |
| annual | 540 days | 1095 days |

When `level` is `stale` or `frozen`, `warning` is a human-readable string
explaining the situation.

Wired into: `sg_disease_latest`, `sg_disease_trend`, `sg_coe_latest`,
`sg_gdp_latest`, `sg_cpi_latest`, `sg_unemployment_latest`,
`sg_population_latest`, `sg_ura_private_txn_latest`. Other tools will be
covered in subsequent point releases.

### Docs

- New `## Data freshness` section in README documenting the new field and
  listing known-frozen upstream datasets.
- Tool descriptions for the disease family now flag the upstream freeze
  inline so MCP clients (which surface tool descriptions to the model)
  warn appropriately without needing a separate read of the docs.

---

## 0.3.2 — 2026-04-10

Monthly business formations + cessations + net growth tools via SingStat
Table Builder.

## 0.3.1 — 2026-04-10

Annual formation counts by industry via SingStat Table Builder.

## 0.3.0 — 2026-04-10

8 new datasets, CLI mode, ASCII sparkline visualization, cross-dataset
correlation queries, natural language query routing.

## 0.2.0 — 2026-04-08

Initial public release.

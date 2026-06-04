/**
 * Curated high-value SingStat (DOS) tables — SingStat Table Builder API.
 *
 * These tables are NOT on data.gov.sg's download pipeline, so (exactly like
 * business_formations.ts) this module calls the SingStat Table Builder API
 * directly and caches the parsed result in memory with a 24-hour TTL.
 *
 *   GET https://tablebuilder.singstat.gov.sg/api/table/tabledata/{resourceId}
 *
 * Verified resource IDs (each confirmed HTTP 200 + real rows on 2026-06-04):
 *   M810871  Key Indicators On Household Market Income Among Resident
 *            Households, Annual                        (updated 11/02/2026)
 *   M182941  Average Monthly Nominal Earnings Per Employee, Annual
 *                                                       (updated 04/03/2026)
 *   M810481  Death And Death Rates, Annual             (updated 03/06/2026)
 *   M830101  Key Indicators On Marriages, Annual       (updated 07/07/2025)
 *   M830201  Key Indicators On Divorces, Annual        (updated 07/07/2025)
 *   M451001  Merchandise Trade By Commodity Section,
 *            (At Current Prices), Monthly              (updated 18/05/2026)
 *   M182201  Resident Labour Force Participation Rate Aged 15 Years And
 *            Over By Age And Sex, End June, Annual     (updated 30/01/2026)
 *
 * The SingStat response shape is:
 *   { Data: { title, frequency, dataLastUpdated, row: [
 *       { seriesNo, rowText, uoM, footnote, columns: [{key, value}, ...] }
 *   ] }, StatusCode, ... }
 *
 * Wide tables hit the API's ~5000-cell limit, which truncates per-series
 * columns. To get a full, untruncated series we fetch one series at a time
 * via the `seriesNoORrowNo` query param (same idea as business_formations.ts
 * using `search`). All other (smaller) tables are fetched whole.
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

const API_BASE = "https://tablebuilder.singstat.gov.sg/api/table/tabledata";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const UA = "Mozilla/5.0 (sgdata-mcp)";

const TABLE_HOUSEHOLD_INCOME = "M810871";
const TABLE_WAGES = "M182941";
const TABLE_DEATHS = "M810481";
const TABLE_MARRIAGES = "M830101";
const TABLE_DIVORCES = "M830201";
const TABLE_TRADE = "M451001";
const TABLE_LFPR = "M182201";

// ---------------------------------------------------------------------------
// Registry entries (so the generic layer / discovery can resolve these ids)
// ---------------------------------------------------------------------------

export const householdIncomeEntry: DatasetEntry = {
  id: "household_income",
  datasetId: "singstat_M810871",
  shardCollection: false,
  name: "Key Indicators On Household Market Income Among Resident Households, Annual",
  description:
    "Annual median/average monthly household income from work, by decile, " +
    "plus Gini coefficients. From DOS via SingStat Table Builder.",
  agency: "DOS",
  refreshDays: 90,
  tags: ["income", "household", "gini", "inequality", "singstat", "dos"],
};

export const wagesEntry: DatasetEntry = {
  id: "wages",
  datasetId: "singstat_M182941",
  shardCollection: false,
  name: "Average Monthly Nominal Earnings Per Employee, Annual",
  description:
    "Annual average monthly nominal earnings per employee (overall economy). " +
    "From MOM/DOS via SingStat Table Builder.",
  agency: "MOM/DOS",
  refreshDays: 90,
  tags: ["wages", "earnings", "salary", "income", "mom", "singstat"],
};

export const deathsEntry: DatasetEntry = {
  id: "deaths",
  datasetId: "singstat_M810481",
  shardCollection: false,
  name: "Death And Death Rates, Annual",
  description:
    "Annual crude death rate and infant mortality rate. From DOS / Registry " +
    "of Births & Deaths via SingStat Table Builder.",
  agency: "DOS/ICA",
  refreshDays: 90,
  tags: ["deaths", "mortality", "demography", "singstat", "dos"],
};

export const marriagesEntry: DatasetEntry = {
  id: "marriages",
  datasetId: "singstat_M830101",
  shardCollection: false,
  name: "Key Indicators On Marriages, Annual",
  description:
    "Annual total/first/re-marriages, inter-ethnic marriage share and more. " +
    "From DOS / Registry of Marriages via SingStat Table Builder.",
  agency: "DOS",
  refreshDays: 90,
  tags: ["marriages", "demography", "social", "singstat", "dos"],
};

export const divorcesEntry: DatasetEntry = {
  id: "divorces",
  datasetId: "singstat_M830201",
  shardCollection: false,
  name: "Key Indicators On Divorces, Annual",
  description:
    "Annual total divorces & annulments, median age of divorcees and median " +
    "duration of marriage. From DOS via SingStat Table Builder.",
  agency: "DOS",
  refreshDays: 90,
  tags: ["divorces", "demography", "social", "singstat", "dos"],
};

export const tradeEntry: DatasetEntry = {
  id: "trade",
  datasetId: "singstat_M451001",
  shardCollection: false,
  name: "Merchandise Trade By Commodity Section, (At Current Prices), Monthly",
  description:
    "Monthly total merchandise trade (imports + exports) by commodity " +
    "section, split into Oil / Non-Oil. From Enterprise Singapore / DOS " +
    "via SingStat Table Builder.",
  agency: "EnterpriseSG/DOS",
  refreshDays: 30,
  tags: ["trade", "imports", "exports", "merchandise", "economy", "singstat"],
};

export const labourForceEntry: DatasetEntry = {
  id: "labour_force",
  datasetId: "singstat_M182201",
  shardCollection: false,
  name: "Resident Labour Force Participation Rate Aged 15 Years And Over By Age And Sex, End June, Annual",
  description:
    "Annual resident labour force participation rate (LFPR), overall and by " +
    "age band. From MOM/DOS via SingStat Table Builder.",
  agency: "MOM/DOS",
  refreshDays: 90,
  tags: ["labour", "lfpr", "participation", "employment", "mom", "singstat"],
};

export const singstatExtraEntries: DatasetEntry[] = [
  householdIncomeEntry,
  wagesEntry,
  deathsEntry,
  marriagesEntry,
  divorcesEntry,
  tradeEntry,
  labourForceEntry,
];

// ---------------------------------------------------------------------------
// Types + shared helpers
// ---------------------------------------------------------------------------

interface SingStatColumn {
  key: string; // "2024" or "2026 Apr"
  value: string;
}

interface SingStatRow {
  seriesNo: string;
  rowText: string;
  uoM: string;
  footnote: string;
  columns: SingStatColumn[];
}

interface SingStatTable {
  title: string;
  frequency: string;
  lastUpdated: string;
  rows: SingStatRow[];
}

interface SeriesPoint {
  period: string; // "2024" or "2026 Apr"
  sortKey: string;
  value: number;
}

const MONTH_ABBRS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function periodSortKey(key: string): string {
  // "2026 Apr" -> "2026-04"; "2024" -> "2024"
  const parts = key.trim().split(/\s+/);
  if (parts.length === 2 && MONTH_ABBRS[parts[1]]) {
    return `${parts[0]}-${MONTH_ABBRS[parts[1]]}`;
  }
  return key.trim();
}

function toNumber(v: string): number | null {
  if (v == null) return null;
  const cleaned = String(v).replace(/,/g, "").trim();
  if (cleaned === "" || cleaned === "na" || cleaned === "-" || cleaned === "n.a.") {
    return null;
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Build a clean, sorted (oldest -> newest) numeric series from a row. */
function rowToSeries(row: SingStatRow): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (const col of row.columns ?? []) {
    const n = toNumber(col.value);
    if (n != null) {
      points.push({ period: col.key, sortKey: periodSortKey(col.key), value: n });
    }
  }
  points.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return points;
}

// ---------------------------------------------------------------------------
// Cached fetchers
// ---------------------------------------------------------------------------

/** Cache for whole-table fetches, keyed by tableId. */
const _tableCache = new Map<string, { table: SingStatTable; fetchedAt: number }>();
/** Cache for single-series fetches, keyed by "tableId:seriesNo". */
const _seriesCache = new Map<string, { table: SingStatTable; fetchedAt: number }>();

function parseTable(json: any): SingStatTable {
  const D = json?.Data ?? {};
  const rows: SingStatRow[] = Array.isArray(D.row) ? D.row : [];
  return {
    title: D.title ?? "",
    frequency: D.frequency ?? "",
    lastUpdated: D.dataLastUpdated ?? "",
    rows,
  };
}

/** Fetch a full table (all series). Used for the small annual tables. */
async function fetchTable(tableId: string): Promise<SingStatTable> {
  const cached = _tableCache.get(tableId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.table;
  }
  const res = await fetch(`${API_BASE}/${tableId}?limit=5000`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) {
    throw new Error(`SingStat API (${tableId}) returned ${res.status}: ${res.statusText}`);
  }
  const table = parseTable(await res.json());
  if (!table.rows.length) {
    throw new Error(`SingStat API (${tableId}) returned empty data`);
  }
  _tableCache.set(tableId, { table, fetchedAt: Date.now() });
  return table;
}

/**
 * Fetch ONE full series via `seriesNoORrowNo`, avoiding the 5000-cell cap that
 * truncates wide monthly tables (e.g. M451001 has 748 monthly columns/series).
 */
async function fetchSeries(tableId: string, seriesNo: string): Promise<SingStatTable> {
  const key = `${tableId}:${seriesNo}`;
  const cached = _seriesCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.table;
  }
  const url = `${API_BASE}/${tableId}?seriesNoORrowNo=${encodeURIComponent(seriesNo)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    throw new Error(`SingStat API (${tableId}) returned ${res.status}: ${res.statusText}`);
  }
  const table = parseTable(await res.json());
  if (!table.rows.length) {
    throw new Error(`SingStat API (${tableId}) returned no rows for series ${seriesNo}`);
  }
  _seriesCache.set(key, { table, fetchedAt: Date.now() });
  return table;
}

/** Pick a row by exact rowText match (case-insensitive), else by seriesNo. */
function findRow(rows: SingStatRow[], wanted: string): SingStatRow | undefined {
  const w = wanted.trim().toLowerCase();
  return (
    rows.find((r) => (r.rowText ?? "").trim().toLowerCase() === w) ??
    rows.find((r) => r.seriesNo === wanted) ??
    rows.find((r) => (r.rowText ?? "").toLowerCase().includes(w))
  );
}

/**
 * Apply optional year + limit filtering, then build a latest snapshot + a
 * short trailing time series. Shared by all single-series tools.
 */
function buildSeriesResult(
  source: string,
  table: SingStatTable,
  row: SingStatRow,
  opts: { year?: string; limit?: number },
) {
  let series = rowToSeries(row);

  if (opts.year) {
    // Match annual ("2024") or monthly ("2024 Apr") periods starting w/ year.
    series = series.filter((p) => p.period.startsWith(opts.year!));
    if (!series.length) {
      return {
        source,
        indicator: row.rowText,
        uom: row.uoM || null,
        error: `No data for year ${opts.year}.`,
      };
    }
  }

  const limit = opts.limit ?? 12;
  const trimmed = opts.year ? series : series.slice(-limit);

  const latest = series[series.length - 1] ?? null;
  const prev = series.length >= 2 ? series[series.length - 2] : null;
  const change = latest && prev ? latest.value - prev.value : null;
  const pct =
    latest && prev && prev.value !== 0
      ? `${(((latest.value - prev.value) / prev.value) * 100).toFixed(1)}%`
      : null;

  return {
    source,
    table_title: table.title,
    last_updated: table.lastUpdated,
    indicator: row.rowText,
    uom: row.uoM || null,
    latest: latest
      ? { period: latest.period, value: latest.value, change, change_pct: pct }
      : null,
    count: trimmed.length,
    series: trimmed.map((p) => ({ period: p.period, value: p.value })),
  };
}

/** Wrap a handler so any thrown error becomes a clean {error} payload. */
function safe(
  fn: (input: unknown) => Promise<unknown>,
): (input: unknown) => Promise<unknown> {
  return async (input: unknown) => {
    try {
      return await fn(input);
    } catch (e: any) {
      return { error: e?.message ?? String(e) };
    }
  };
}

// Shared input schemas
const yearLimitSchema = z.object({
  year: z
    .union([z.string(), z.number()])
    .optional()
    .describe("Filter to a specific year (e.g. 2024). Defaults to latest."),
  limit: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .describe("Number of recent periods to return in the series. Default 12."),
});

function parseYearLimit(input: unknown): { year?: string; limit?: number } {
  const p = yearLimitSchema.parse(input);
  return { year: p.year != null ? String(p.year) : undefined, limit: p.limit };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export function createSingstatExtraTools(
  _cache: DatasetCache,
  _downloader: DatasetDownloader,
): ToolDef[] {
  return [
    // ── Household income ──────────────────────────────────────────────────
    {
      name: "sg_household_income",
      description:
        "Singapore resident household income from work. Returns the median " +
        "monthly household income (or, with `indicator`, a chosen series such " +
        "as average income, a specific decile, or the Gini coefficient). " +
        "Annual, from DOS via SingStat (M810871).",
      inputSchema: z.object({
        indicator: z
          .string()
          .optional()
          .describe(
            "Series to return (substring match). Examples: 'Median Monthly " +
            "Household Market Income', 'Average Monthly Household Market " +
            "Income Per Household Member', 'Gini'. Default = median income.",
          ),
        year: z.union([z.string(), z.number()]).optional(),
        limit: z.number().int().positive().max(200).optional(),
      }),
      handler: safe(async (input: unknown) => {
        const p = z
          .object({
            indicator: z.string().optional(),
            year: z.union([z.string(), z.number()]).optional(),
            limit: z.number().int().positive().max(200).optional(),
          })
          .parse(input);
        const table = await fetchTable(TABLE_HOUSEHOLD_INCOME);
        const wanted = p.indicator ?? "Median Monthly Household Market Income";
        const row = findRow(table.rows, wanted);
        if (!row) {
          return {
            error: `No indicator matching "${wanted}".`,
            available_indicators: table.rows
              .filter((r) => !r.seriesNo.includes("."))
              .map((r) => r.rowText)
              .slice(0, 30),
          };
        }
        return buildSeriesResult(
          "SingStat Table Builder (M810871)",
          table,
          row,
          { year: p.year != null ? String(p.year) : undefined, limit: p.limit },
        );
      }),
    },

    // ── Wages / earnings ──────────────────────────────────────────────────
    {
      name: "sg_wages",
      description:
        "Average monthly nominal earnings per employee in Singapore (overall " +
        "economy). Annual time series, from MOM/DOS via SingStat (M182941).",
      inputSchema: yearLimitSchema,
      handler: safe(async (input: unknown) => {
        const opts = parseYearLimit(input);
        const table = await fetchTable(TABLE_WAGES);
        const row = findRow(table.rows, "Overall Economy") ?? table.rows[0]!;
        return buildSeriesResult(
          "SingStat Table Builder (M182941)",
          table,
          row,
          opts,
        );
      }),
    },

    // ── Deaths / mortality ────────────────────────────────────────────────
    {
      name: "sg_deaths",
      description:
        "Singapore mortality indicators: crude death rate and infant " +
        "mortality rate. Annual, from DOS via SingStat (M810481). Use " +
        "`indicator` to choose ('Crude Death Rate' or 'Infant Mortality " +
        "Rate'); defaults to crude death rate.",
      inputSchema: z.object({
        indicator: z
          .string()
          .optional()
          .describe("'Crude Death Rate' or 'Infant Mortality Rate'."),
        year: z.union([z.string(), z.number()]).optional(),
        limit: z.number().int().positive().max(200).optional(),
      }),
      handler: safe(async (input: unknown) => {
        const p = z
          .object({
            indicator: z.string().optional(),
            year: z.union([z.string(), z.number()]).optional(),
            limit: z.number().int().positive().max(200).optional(),
          })
          .parse(input);
        const table = await fetchTable(TABLE_DEATHS);
        const row = findRow(table.rows, p.indicator ?? "Crude Death Rate");
        if (!row) {
          return {
            error: `No indicator matching "${p.indicator}".`,
            available_indicators: table.rows.map((r) => r.rowText),
          };
        }
        return buildSeriesResult(
          "SingStat Table Builder (M810481)",
          table,
          row,
          { year: p.year != null ? String(p.year) : undefined, limit: p.limit },
        );
      }),
    },

    // ── Marriages ─────────────────────────────────────────────────────────
    {
      name: "sg_marriages",
      description:
        "Singapore marriage statistics. Defaults to total marriages; use " +
        "`indicator` for other series (e.g. 'First Marriages', 'Resident " +
        "Marriages', 'Proportion Of Inter-Ethnic Marriages'). Annual, from " +
        "DOS via SingStat (M830101).",
      inputSchema: z.object({
        indicator: z
          .string()
          .optional()
          .describe("Series to return (substring match). Default 'Total Marriages'."),
        year: z.union([z.string(), z.number()]).optional(),
        limit: z.number().int().positive().max(200).optional(),
      }),
      handler: safe(async (input: unknown) => {
        const p = z
          .object({
            indicator: z.string().optional(),
            year: z.union([z.string(), z.number()]).optional(),
            limit: z.number().int().positive().max(200).optional(),
          })
          .parse(input);
        const table = await fetchTable(TABLE_MARRIAGES);
        const row = findRow(table.rows, p.indicator ?? "Total Marriages");
        if (!row) {
          return {
            error: `No indicator matching "${p.indicator}".`,
            available_indicators: table.rows.map((r) => r.rowText),
          };
        }
        return buildSeriesResult(
          "SingStat Table Builder (M830101)",
          table,
          row,
          { year: p.year != null ? String(p.year) : undefined, limit: p.limit },
        );
      }),
    },

    // ── Divorces ──────────────────────────────────────────────────────────
    {
      name: "sg_divorces",
      description:
        "Singapore divorce statistics. Defaults to total divorces & " +
        "annulments; use `indicator` for other series (e.g. 'Civil " +
        "Divorces', 'Muslim Divorces', 'Median Duration Of Marriage For " +
        "Divorces'). Annual, from DOS via SingStat (M830201).",
      inputSchema: z.object({
        indicator: z
          .string()
          .optional()
          .describe(
            "Series to return (substring match). Default 'Total Divorces And " +
            "Annulments'.",
          ),
        year: z.union([z.string(), z.number()]).optional(),
        limit: z.number().int().positive().max(200).optional(),
      }),
      handler: safe(async (input: unknown) => {
        const p = z
          .object({
            indicator: z.string().optional(),
            year: z.union([z.string(), z.number()]).optional(),
            limit: z.number().int().positive().max(200).optional(),
          })
          .parse(input);
        const table = await fetchTable(TABLE_DIVORCES);
        const row = findRow(table.rows, p.indicator ?? "Total Divorces And Annulments");
        if (!row) {
          return {
            error: `No indicator matching "${p.indicator}".`,
            available_indicators: table.rows.map((r) => r.rowText),
          };
        }
        return buildSeriesResult(
          "SingStat Table Builder (M830201)",
          table,
          row,
          { year: p.year != null ? String(p.year) : undefined, limit: p.limit },
        );
      }),
    },

    // ── Merchandise trade (imports + exports) ─────────────────────────────
    {
      name: "sg_trade",
      description:
        "Singapore total merchandise trade (imports + exports) by commodity " +
        "section, monthly, in thousand dollars. Defaults to total trade; use " +
        "`segment` to pick a sub-series: 'total' | 'oil' | 'non-oil' | " +
        "'petroleum' | 'oil-bunkers'. From EnterpriseSG/DOS via SingStat " +
        "(M451001). Monthly series are fetched per-segment to avoid the " +
        "API's cell limit.",
      inputSchema: z.object({
        segment: z
          .enum(["total", "oil", "non-oil", "petroleum", "oil-bunkers"])
          .optional()
          .describe("Trade segment. Default 'total'."),
        year: z.union([z.string(), z.number()]).optional(),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Recent months to return. Default 12."),
      }),
      handler: safe(async (input: unknown) => {
        const p = z
          .object({
            segment: z
              .enum(["total", "oil", "non-oil", "petroleum", "oil-bunkers"])
              .optional(),
            year: z.union([z.string(), z.number()]).optional(),
            limit: z.number().int().positive().max(200).optional(),
          })
          .parse(input);
        const segMap: Record<string, string> = {
          total: "1",
          oil: "1.1",
          "petroleum": "1.1.1",
          "oil-bunkers": "1.1.2",
          "non-oil": "1.2",
        };
        const seriesNo = segMap[p.segment ?? "total"];
        // Fetch the single full series (untruncated, 748 monthly cols).
        const table = await fetchSeries(TABLE_TRADE, seriesNo);
        const row = table.rows.find((r) => r.seriesNo === seriesNo) ?? table.rows[0]!;
        return buildSeriesResult(
          "SingStat Table Builder (M451001)",
          table,
          row,
          { year: p.year != null ? String(p.year) : undefined, limit: p.limit },
        );
      }),
    },

    // ── Labour force participation rate ───────────────────────────────────
    {
      name: "sg_labour_force",
      description:
        "Singapore resident labour force participation rate (LFPR), aged 15+. " +
        "Defaults to the overall total rate; use `indicator` for an age band " +
        "(e.g. '25 - 29 Years'). Annual (end-June), from MOM/DOS via " +
        "SingStat (M182201).",
      inputSchema: z.object({
        indicator: z
          .string()
          .optional()
          .describe(
            "Series to return (substring match). Default 'Total Resident " +
            "Participation Rate'. Age bands like '25 - 29 Years' are available.",
          ),
        year: z.union([z.string(), z.number()]).optional(),
        limit: z.number().int().positive().max(200).optional(),
      }),
      handler: safe(async (input: unknown) => {
        const p = z
          .object({
            indicator: z.string().optional(),
            year: z.union([z.string(), z.number()]).optional(),
            limit: z.number().int().positive().max(200).optional(),
          })
          .parse(input);
        const table = await fetchTable(TABLE_LFPR);
        const row = findRow(table.rows, p.indicator ?? "Total Resident Participation Rate");
        if (!row) {
          return {
            error: `No indicator matching "${p.indicator}".`,
            available_indicators: table.rows
              .map((r) => r.rowText)
              .slice(0, 30),
          };
        }
        return buildSeriesResult(
          "SingStat Table Builder (M182201)",
          table,
          row,
          { year: p.year != null ? String(p.year) : undefined, limit: p.limit },
        );
      }),
    },
  ];
}

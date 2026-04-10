/**
 * Business Entity Formations & Cessations — SingStat Table Builder.
 *
 * Source: SingStat Table Builder API (free, no auth, JSON).
 *   M085851: Formation of All Business Entities By Detailed Industry, Annual.
 *   M085831: Formation of All Business Entities By Detailed Industry, Monthly.
 *   M085841: Cessation of All Business Entities By Detailed Industry, Monthly.
 * Data from ACRA, aggregated by DOS/SingStat.
 *
 * This handler does NOT use the data.gov.sg download pipeline. It calls the
 * SingStat Table Builder API directly and caches the parsed result in memory
 * with a 24-hour TTL. The response is ~50 KB of JSON, so no SQLite needed.
 *
 * Monthly tables have 434 columns (Jan 1990 – present). The API cell limit
 * is 5000, so we use the `search` query param to fetch one row at a time
 * rather than paginating.
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

const TABLE_ANNUAL = "M085851";
const TABLE_MONTHLY_FORMATIONS = "M085831";
const TABLE_MONTHLY_CESSATIONS = "M085841";
const API_BASE = "https://tablebuilder.singstat.gov.sg/api/table/tabledata";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const businessFormationsEntry: DatasetEntry = {
  id: "business_formations",
  datasetId: "singstat_M085851",
  shardCollection: false,
  name: "Formation of All Business Entities By Detailed Industry, Annual",
  description:
    "Annual business entity formation counts by SSIC industry code, " +
    "from ACRA via SingStat Table Builder. Covers all SSIC divisions " +
    "(2-digit and selected 4-digit codes) from 1990 to present.",
  agency: "ACRA/DOS",
  refreshDays: 30,
  tags: ["formations", "companies", "acra", "ssic", "industry", "singstat"],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SingStatColumn {
  key: string;    // "2020", "2021", etc.
  value: string;  // "6133"
}

interface SingStatRow {
  seriesNo: string;
  rowText: string;
  uoM: string;
  footnote: string;
  columns: SingStatColumn[];
}

interface ParsedIndustry {
  seriesNo: string;
  ssic: string;       // "62", "10-32", "Total"
  description: string; // "Computer Programming, Consultancy And Other..."
  values: Record<string, number>;  // { "2020": 5123, "2021": 5456, ... }
}

interface MonthlyPoint {
  month: string;      // "2026 Feb"
  sortKey: string;    // "2026-02"
  value: number;
}

interface MonthlySeries {
  ssic: string;
  description: string;
  points: MonthlyPoint[];
}

// ---------------------------------------------------------------------------
// In-memory caches
// ---------------------------------------------------------------------------

let _cache: { data: ParsedIndustry[]; years: string[]; fetchedAt: number } | null = null;

/** Monthly cache keyed by "tableId:searchTerm" */
const _monthlyCache = new Map<string, { series: MonthlySeries; fetchedAt: number }>();

function parseRow(row: SingStatRow): ParsedIndustry {
  // Extract SSIC code from rowText like "SSIC 62 Computer Programming..."
  // or "SSIC 10-32 Manufacturing" or "Total"
  const match = row.rowText.match(/^SSIC\s+([\d-]+)\s+(.+)$/i);
  const ssic = match ? match[1] : row.rowText === "Total" ? "Total" : row.seriesNo;
  const description = match ? match[2] : row.rowText;

  const values: Record<string, number> = {};
  for (const col of row.columns) {
    const n = parseInt(col.value, 10);
    if (Number.isFinite(n)) {
      values[col.key] = n;
    }
  }

  return { seriesNo: row.seriesNo, ssic, description, values };
}

async function fetchFormations(): Promise<{ industries: ParsedIndustry[]; years: string[] }> {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return { industries: _cache.data, years: _cache.years };
  }

  const res = await fetch(`${API_BASE}/${TABLE_ANNUAL}`);
  if (!res.ok) {
    throw new Error(`SingStat API returned ${res.status}: ${res.statusText}`);
  }
  const json = await res.json();
  const rows: SingStatRow[] = json?.Data?.row ?? [];

  if (!rows.length) {
    throw new Error("SingStat API returned empty data");
  }

  const industries = rows.map(parseRow);

  // Extract available years from the first row's columns
  const years = (rows[0]?.columns ?? [])
    .map((c: SingStatColumn) => c.key)
    .filter((k: string) => /^\d{4}$/.test(k));

  _cache = { data: industries, years, fetchedAt: Date.now() };
  return { industries, years };
}

// ---------------------------------------------------------------------------
// Monthly fetch helper
// ---------------------------------------------------------------------------

const MONTH_ABBRS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function monthKeyToSort(key: string): string {
  // "2026 Feb" → "2026-02"
  const parts = key.split(" ");
  if (parts.length !== 2) return key;
  return `${parts[0]}-${MONTH_ABBRS[parts[1]] ?? "00"}`;
}

/**
 * Fetch a single row from a monthly table using the `search` query param.
 * The API has a 5000-cell limit. Monthly tables have 434 cols/row, so
 * fetching one row at a time avoids pagination entirely (~15 KB per request).
 */
async function fetchMonthlySeries(
  tableId: string,
  ssic: string,
): Promise<MonthlySeries> {
  const searchTerm = ssic.toLowerCase() === "total" ? "Total" : `SSIC ${ssic}`;
  const cacheKey = `${tableId}:${searchTerm}`;
  const cached = _monthlyCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.series;
  }

  const url = `${API_BASE}/${tableId}?search=${encodeURIComponent(searchTerm)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`SingStat API (${tableId}) returned ${res.status}: ${res.statusText}`);
  }
  const json = await res.json();
  const rows: SingStatRow[] = json?.Data?.row ?? [];

  if (!rows.length) {
    throw new Error(
      `No data found for "${searchTerm}" in table ${tableId}. ` +
      `Use sg_formations_latest to discover available SSIC codes.`,
    );
  }

  // Take the first matching row
  const row = rows[0];
  const parsed = parseRow(row);

  const points: MonthlyPoint[] = [];
  for (const col of row.columns) {
    const n = parseInt(col.value, 10);
    if (Number.isFinite(n) && /^\d{4}\s\w{3}$/.test(col.key)) {
      points.push({
        month: col.key,
        sortKey: monthKeyToSort(col.key),
        value: n,
      });
    }
  }
  points.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const series: MonthlySeries = {
    ssic: parsed.ssic,
    description: parsed.description,
    points,
  };

  _monthlyCache.set(cacheKey, { series, fetchedAt: Date.now() });
  return series;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export function createBusinessFormationsTools(
  _cacheUnused: DatasetCache,
  _downloaderUnused: DatasetDownloader,
): ToolDef[] {
  return [
    {
      name: "sg_formations_latest",
      description:
        "Get the latest year's business formation counts by industry in " +
        "Singapore. Shows how many new companies were registered in each " +
        "SSIC sector. Data from ACRA via SingStat.",
      inputSchema: z.object({
        year: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Year to query (e.g. 2025). Defaults to latest available."),
        top_n: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe("Return top N industries by formation count. Default 15."),
      }),
      handler: async (input: unknown) => {
        const p = z
          .object({
            year: z.union([z.string(), z.number()]).optional(),
            top_n: z.number().int().positive().max(50).optional(),
          })
          .parse(input);

        const { industries, years } = await fetchFormations();
        const targetYear = p.year ? String(p.year) : years[years.length - 1];
        const topN = p.top_n ?? 15;

        // Filter to 2-digit SSIC level (seriesNo depth = 3, like "1.5.1")
        // and sort by formation count
        const withCounts = industries
          .filter((ind) => ind.values[targetYear] != null && ind.ssic !== "Total")
          .map((ind) => ({
            ssic: ind.ssic,
            description: ind.description,
            formations: ind.values[targetYear] ?? 0,
            series_no: ind.seriesNo,
          }))
          .sort((a, b) => b.formations - a.formations);

        const total = industries.find((i) => i.ssic === "Total");

        return {
          source: "SingStat Table Builder (M085851)",
          year: targetYear,
          total_formations: total?.values[targetYear] ?? null,
          top_industries: withCounts.slice(0, topN),
          count: withCounts.length,
        };
      },
    },

    {
      name: "sg_formations_history",
      description:
        "Get the historical time series of business formations for a " +
        "specific industry/SSIC code. Returns annual counts from 1990 " +
        "to present. Use SSIC code (e.g. '62' for IT) or 'Total' for " +
        "all industries.",
      inputSchema: z.object({
        ssic: z
          .string()
          .describe(
            "SSIC code to query (e.g. '62' for Computer Programming/IT, " +
            "'70' for Management Consultancy, 'Total' for all industries).",
          ),
        years_back: z
          .number()
          .int()
          .positive()
          .max(40)
          .optional()
          .describe("Limit to last N years. Default: all available."),
      }),
      handler: async (input: unknown) => {
        const p = z
          .object({
            ssic: z.string(),
            years_back: z.number().int().positive().max(40).optional(),
          })
          .parse(input);

        const { industries, years } = await fetchFormations();

        // Find matching industry
        const target = p.ssic.toLowerCase() === "total"
          ? industries.find((i) => i.ssic === "Total")
          : industries.find(
              (i) => i.ssic === p.ssic || i.ssic.toLowerCase() === p.ssic.toLowerCase(),
            );

        if (!target) {
          // Return available SSIC codes for discovery
          const available = industries
            .filter((i) => i.ssic !== "Total" && !i.ssic.includes("-"))
            .map((i) => `${i.ssic}: ${i.description}`)
            .slice(0, 30);
          return {
            error: `No industry found for SSIC "${p.ssic}".`,
            available_ssic_codes: available,
          };
        }

        const targetYears = p.years_back ? years.slice(-p.years_back) : years;
        const series = targetYears
          .filter((y) => target.values[y] != null)
          .map((y) => ({
            year: y,
            formations: target.values[y],
          }));

        // Derive basic stats
        const vals = series.map((s) => s.formations);
        const latest = vals[vals.length - 1] ?? 0;
        const prev = vals.length >= 2 ? vals[vals.length - 2] : null;
        const yoyChange = prev != null ? latest - prev : null;
        const yoyPct = prev ? ((yoyChange! / prev) * 100).toFixed(1) : null;

        return {
          source: "SingStat Table Builder (M085851)",
          ssic: target.ssic,
          description: target.description,
          count: series.length,
          series,
          latest: {
            year: targetYears[targetYears.length - 1],
            formations: latest,
            yoy_change: yoyChange,
            yoy_pct: yoyPct ? `${yoyPct}%` : null,
          },
        };
      },
    },

    {
      name: "sg_formations_compare",
      description:
        "Compare business formation counts across multiple industries " +
        "for a given year. Great for spotting which sectors are growing " +
        "fastest. Optionally filter by SSIC codes.",
      inputSchema: z.object({
        year: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Year to compare. Defaults to latest available."),
        ssic_codes: z
          .array(z.string())
          .optional()
          .describe(
            "List of SSIC codes to compare (e.g. ['62', '70', '47']). " +
            "If omitted, returns all industries sorted by formations.",
          ),
      }),
      handler: async (input: unknown) => {
        const p = z
          .object({
            year: z.union([z.string(), z.number()]).optional(),
            ssic_codes: z.array(z.string()).optional(),
          })
          .parse(input);

        const { industries, years } = await fetchFormations();
        const targetYear = p.year ? String(p.year) : years[years.length - 1];
        const prevYear = String(Number(targetYear) - 1);

        let filtered = industries.filter((i) => i.ssic !== "Total");
        if (p.ssic_codes?.length) {
          const codes = new Set(p.ssic_codes.map((c) => c.toLowerCase()));
          filtered = filtered.filter((i) => codes.has(i.ssic.toLowerCase()));
        }

        const compared = filtered
          .filter((i) => i.values[targetYear] != null)
          .map((i) => {
            const curr = i.values[targetYear] ?? 0;
            const prev = i.values[prevYear];
            const yoyChange = prev != null ? curr - prev : null;
            const yoyPct = prev ? ((yoyChange! / prev) * 100).toFixed(1) : null;
            return {
              ssic: i.ssic,
              description: i.description,
              formations: curr,
              prev_year_formations: prev ?? null,
              yoy_change: yoyChange,
              yoy_pct: yoyPct ? `${yoyPct}%` : null,
            };
          })
          .sort((a, b) => b.formations - a.formations);

        const total = industries.find((i) => i.ssic === "Total");

        return {
          source: "SingStat Table Builder (M085851)",
          year: targetYear,
          total_formations: total?.values[targetYear] ?? null,
          industries: compared,
          count: compared.length,
        };
      },
    },

    // ── Monthly tools ──────────────────────────────────────────────────

    {
      name: "sg_formations_monthly",
      description:
        "Get monthly business formation counts for a specific industry " +
        "or all industries (Total). Returns monthly time series from " +
        "Jan 1990 to present. Data from ACRA via SingStat Table Builder.",
      inputSchema: z.object({
        ssic: z
          .string()
          .optional()
          .describe(
            "SSIC code (e.g. '62' for IT, '70' for Management Consultancy). " +
            "Default 'Total' for all industries.",
          ),
        months_back: z
          .number()
          .int()
          .positive()
          .max(434)
          .optional()
          .describe("Limit to last N months. Default 24."),
      }),
      handler: async (input: unknown) => {
        const p = z
          .object({
            ssic: z.string().optional(),
            months_back: z.number().int().positive().max(434).optional(),
          })
          .parse(input);

        const ssic = p.ssic || "Total";
        const monthsBack = p.months_back ?? 24;
        const series = await fetchMonthlySeries(TABLE_MONTHLY_FORMATIONS, ssic);
        const points = series.points.slice(-monthsBack);

        const vals = points.map((pt) => pt.value);
        const latest = vals[vals.length - 1] ?? 0;
        const prev = vals.length >= 2 ? vals[vals.length - 2] : null;
        const momChange = prev != null ? latest - prev : null;
        const momPct = prev ? ((momChange! / prev) * 100).toFixed(1) : null;

        return {
          source: `SingStat Table Builder (${TABLE_MONTHLY_FORMATIONS})`,
          ssic: series.ssic,
          description: series.description,
          count: points.length,
          series: points,
          latest: {
            month: points[points.length - 1]?.month ?? null,
            formations: latest,
            mom_change: momChange,
            mom_pct: momPct ? `${momPct}%` : null,
          },
        };
      },
    },

    {
      name: "sg_cessations_monthly",
      description:
        "Get monthly business cessation (closure/deregistration) counts " +
        "for a specific industry or all industries (Total). Returns " +
        "monthly time series from Jan 1990 to present. Data from ACRA " +
        "via SingStat Table Builder.",
      inputSchema: z.object({
        ssic: z
          .string()
          .optional()
          .describe(
            "SSIC code (e.g. '62' for IT, '70' for Management Consultancy). " +
            "Default 'Total' for all industries.",
          ),
        months_back: z
          .number()
          .int()
          .positive()
          .max(434)
          .optional()
          .describe("Limit to last N months. Default 24."),
      }),
      handler: async (input: unknown) => {
        const p = z
          .object({
            ssic: z.string().optional(),
            months_back: z.number().int().positive().max(434).optional(),
          })
          .parse(input);

        const ssic = p.ssic || "Total";
        const monthsBack = p.months_back ?? 24;
        const series = await fetchMonthlySeries(TABLE_MONTHLY_CESSATIONS, ssic);
        const points = series.points.slice(-monthsBack);

        const vals = points.map((pt) => pt.value);
        const latest = vals[vals.length - 1] ?? 0;
        const prev = vals.length >= 2 ? vals[vals.length - 2] : null;
        const momChange = prev != null ? latest - prev : null;
        const momPct = prev ? ((momChange! / prev) * 100).toFixed(1) : null;

        return {
          source: `SingStat Table Builder (${TABLE_MONTHLY_CESSATIONS})`,
          ssic: series.ssic,
          description: series.description,
          count: points.length,
          series: points,
          latest: {
            month: points[points.length - 1]?.month ?? null,
            cessations: latest,
            mom_change: momChange,
            mom_pct: momPct ? `${momPct}%` : null,
          },
        };
      },
    },

    {
      name: "sg_net_formations",
      description:
        "Get net business growth (formations minus cessations) by month " +
        "for a specific industry or all industries. Positive = more " +
        "companies created than closed. Data from ACRA via SingStat.",
      inputSchema: z.object({
        ssic: z
          .string()
          .optional()
          .describe(
            "SSIC code (e.g. '62' for IT). Default 'Total' for all industries.",
          ),
        months_back: z
          .number()
          .int()
          .positive()
          .max(434)
          .optional()
          .describe("Limit to last N months. Default 24."),
      }),
      handler: async (input: unknown) => {
        const p = z
          .object({
            ssic: z.string().optional(),
            months_back: z.number().int().positive().max(434).optional(),
          })
          .parse(input);

        const ssic = p.ssic || "Total";
        const monthsBack = p.months_back ?? 24;

        // Fetch both in parallel
        const [formations, cessations] = await Promise.all([
          fetchMonthlySeries(TABLE_MONTHLY_FORMATIONS, ssic),
          fetchMonthlySeries(TABLE_MONTHLY_CESSATIONS, ssic),
        ]);

        // Build cessation lookup by sortKey
        const cessMap = new Map<string, number>();
        for (const pt of cessations.points) {
          cessMap.set(pt.sortKey, pt.value);
        }

        // Compute net for each month
        const netSeries = formations.points
          .map((pt) => {
            const cess = cessMap.get(pt.sortKey) ?? 0;
            return {
              month: pt.month,
              sortKey: pt.sortKey,
              formations: pt.value,
              cessations: cess,
              net: pt.value - cess,
            };
          })
          .slice(-monthsBack);

        const nets = netSeries.map((s) => s.net);
        const latestNet = nets[nets.length - 1] ?? 0;
        const avgNet =
          nets.length > 0
            ? Math.round(nets.reduce((a, b) => a + b, 0) / nets.length)
            : 0;
        const positiveMonths = nets.filter((n) => n > 0).length;

        return {
          source: "SingStat Table Builder (M085831 + M085841)",
          ssic: formations.ssic,
          description: formations.description,
          count: netSeries.length,
          series: netSeries,
          summary: {
            latest_month: netSeries[netSeries.length - 1]?.month ?? null,
            latest_net: latestNet,
            avg_monthly_net: avgNet,
            positive_months: positiveMonths,
            total_months: netSeries.length,
            total_net: nets.reduce((a, b) => a + b, 0),
          },
        };
      },
    },
  ];
}

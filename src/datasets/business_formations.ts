/**
 * Business Entity Formations & Cessations — SingStat Table Builder.
 *
 * Source: SingStat Table Builder API (free, no auth, JSON).
 * Table M085851: Formation of All Business Entities By Detailed Industry, Annual.
 * Data from ACRA, aggregated by DOS/SingStat.
 *
 * This handler does NOT use the data.gov.sg download pipeline. It calls the
 * SingStat Table Builder API directly and caches the parsed result in memory
 * with a 24-hour TTL. The response is ~50 KB of JSON, so no SQLite needed.
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

const TABLE_ID = "M085851";
const API_URL = `https://tablebuilder.singstat.gov.sg/api/table/tabledata/${TABLE_ID}`;
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

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

let _cache: { data: ParsedIndustry[]; years: string[]; fetchedAt: number } | null = null;

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

  const res = await fetch(API_URL);
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
  ];
}

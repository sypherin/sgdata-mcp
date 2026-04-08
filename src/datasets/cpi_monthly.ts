/**
 * Consumer Price Index (CPI), 2024 Base, Monthly.
 *
 * Dataset: d_bdaff844e3ef89d39fceb962ff8f0791 — wide format.
 * Rows: ~780 CPI sub-indices (e.g. "All Items", "Food", "Transport").
 * Columns: "DataSeries" + one column per month, e.g. "2026Feb", "2026Jan".
 *
 * Cache sanitizes digit-prefixed column names, so "2026Feb" becomes
 * "_2026Feb".
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const cpiMonthlyEntry: DatasetEntry = {
  id: "cpi_monthly",
  datasetId: "d_bdaff844e3ef89d39fceb962ff8f0791",
  shardCollection: false,
  name: "Consumer Price Index (Monthly, 2024=100)",
  description:
    "SingStat monthly CPI by sub-index, wide format. One row per CPI " +
    "category, one column per month.",
  agency: "SingStat",
  refreshDays: 30,
  tags: ["economy", "cpi", "inflation", "singstat"],
};

type Row = Record<string, string | null>;

const MONTH_RE = /^_?(\d{4})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/;
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function monthKeyToSortable(col: string): string {
  const m = col.match(MONTH_RE);
  if (!m) return "0000-00";
  const monthIdx = MONTH_NAMES.indexOf(m[2]!);
  return `${m[1]}-${String(monthIdx + 1).padStart(2, "0")}`;
}

function extractMonthCols(row: Row): string[] {
  return Object.keys(row).filter((k) => MONTH_RE.test(k));
}

function sortMonthsDesc(cols: string[]): string[] {
  return [...cols].sort((a, b) =>
    monthKeyToSortable(b).localeCompare(monthKeyToSortable(a)),
  );
}

function prettyMonth(col: string): string {
  const m = col.match(MONTH_RE);
  return m ? `${m[1]}-${m[2]}` : col;
}

function matchCategory(row: Row, needle?: string): boolean {
  if (!needle) return true;
  const ds = (row.DataSeries as string | null) ?? "";
  return ds.toLowerCase().includes(needle.toLowerCase());
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/** Monthly column 12 months prior to `col`, or null if not found in `row`. */
function yearAgoCol(col: string, row: Row): string | null {
  const m = col.match(MONTH_RE);
  if (!m) return null;
  const year = Number(m[1]) - 1;
  const monthName = m[2];
  const candidateA = `_${year}${monthName}`;
  const candidateB = `${year}${monthName}`;
  if (candidateA in row) return candidateA;
  if (candidateB in row) return candidateB;
  return null;
}

export function createCpiMonthlyTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  const latestInput = z.object({
    category: z.string().optional(),
  });

  const historyInput = z.object({
    category: z.string(),
    months_back: z.number().int().positive().max(600).optional(),
  });

  const yoyInput = z.object({
    category: z.string(),
    month: z.string().optional(),
  });

  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(cpiMonthlyEntry);
    return cache.query<Row>(cpiMonthlyEntry.datasetId, { limit: 5000 });
  }

  return [
    {
      name: "sg_cpi_latest",
      description:
        "Most recent CPI index value and YoY change for a matching " +
        "sub-index (substring match on DataSeries). Defaults to 'All Items'.",
      inputSchema: latestInput,
      handler: async (input: unknown) => {
        const p = latestInput.parse(input);
        const rows = await fetchAll();
        const needle = p.category ?? "All Items";
        const matching = rows.filter((r) => matchCategory(r, needle));
        if (matching.length === 0) {
          return {
            datasetId: cpiMonthlyEntry.datasetId,
            query: needle,
            matches: [],
          };
        }
        const cols = extractMonthCols(matching[0]!);
        const sorted = sortMonthsDesc(cols);
        const latestCol = sorted[0];
        return {
          datasetId: cpiMonthlyEntry.datasetId,
          query: needle,
          latest_month: latestCol ? prettyMonth(latestCol) : null,
          matches: matching.map((r) => {
            const latestVal = latestCol ? toNumber(r[latestCol]) : null;
            const yaCol = latestCol ? yearAgoCol(latestCol, r) : null;
            const yaVal = yaCol ? toNumber(r[yaCol]) : null;
            const yoy =
              latestVal != null && yaVal != null && yaVal !== 0
                ? ((latestVal - yaVal) / yaVal) * 100
                : null;
            return {
              category: r.DataSeries,
              value: latestVal,
              year_ago_value: yaVal,
              yoy_pct: yoy,
            };
          }),
        };
      },
    },
    {
      name: "sg_cpi_history",
      description:
        "Monthly CPI time series for a single sub-index (substring match " +
        "on DataSeries). Returns oldest-to-newest, trimmed to last N " +
        "months if months_back is given.",
      inputSchema: historyInput,
      handler: async (input: unknown) => {
        const p = historyInput.parse(input);
        const rows = await fetchAll();
        const hit = rows.find((r) => matchCategory(r, p.category));
        if (!hit) {
          return {
            datasetId: cpiMonthlyEntry.datasetId,
            category: p.category,
            series: [],
          };
        }
        const cols = extractMonthCols(hit);
        const asc = sortMonthsDesc(cols).reverse();
        const trimmed = p.months_back ? asc.slice(-p.months_back) : asc;
        return {
          datasetId: cpiMonthlyEntry.datasetId,
          category: hit.DataSeries,
          count: trimmed.length,
          series: trimmed.map((col) => ({
            month: prettyMonth(col),
            value: toNumber(hit[col]),
          })),
        };
      },
    },
    {
      name: "sg_cpi_yoy",
      description:
        "Year-on-year inflation rate for a single CPI sub-index in a " +
        "given month. If month is omitted, uses the most recent month. " +
        "Month format: '2026Feb' or '2026-Feb'.",
      inputSchema: yoyInput,
      handler: async (input: unknown) => {
        const p = yoyInput.parse(input);
        const rows = await fetchAll();
        const hit = rows.find((r) => matchCategory(r, p.category));
        if (!hit) {
          return {
            datasetId: cpiMonthlyEntry.datasetId,
            category: p.category,
            month: p.month,
            yoy_pct: null,
          };
        }
        let col: string | null = null;
        if (p.month) {
          const normalized = p.month.replace(/[-_/\s]/g, "");
          const candidates = [`_${normalized}`, normalized];
          for (const c of candidates) if (c in hit) col = c;
        } else {
          col = sortMonthsDesc(extractMonthCols(hit))[0] ?? null;
        }
        if (!col) {
          return {
            datasetId: cpiMonthlyEntry.datasetId,
            category: hit.DataSeries,
            month: p.month,
            error: "Unknown month column",
          };
        }
        const latestVal = toNumber(hit[col]);
        const yaCol = yearAgoCol(col, hit);
        const yaVal = yaCol ? toNumber(hit[yaCol]) : null;
        const yoy =
          latestVal != null && yaVal != null && yaVal !== 0
            ? ((latestVal - yaVal) / yaVal) * 100
            : null;
        return {
          datasetId: cpiMonthlyEntry.datasetId,
          category: hit.DataSeries,
          month: prettyMonth(col),
          value: latestVal,
          year_ago_value: yaVal,
          yoy_pct: yoy,
        };
      },
    },
  ];
}

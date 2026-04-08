/**
 * Retail Sales Index, Monthly (2017=100, chained volume).
 *
 * Dataset: d_6b78d625911483860e162288a4000a0c — wide format, ~30 rows.
 * Columns: "DataSeries" (sub-industry) + monthly columns "2025Dec", …
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const retailSalesEntry: DatasetEntry = {
  id: "retail_sales",
  datasetId: "d_6b78d625911483860e162288a4000a0c",
  shardCollection: false,
  name: "Retail Sales Index, Monthly",
  description:
    "SingStat Retail Sales Index (2017=100, chained volume) by " +
    "sub-industry, wide format.",
  agency: "SingStat",
  refreshDays: 30,
  tags: ["economy", "retail", "singstat", "monthly"],
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

export function createRetailSalesTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  const latestInput = z.object({
    category: z.string().optional(),
  });

  const historyInput = z.object({
    category: z.string().optional(),
    months_back: z.number().int().positive().max(600).optional(),
  });

  const yoyInput = z.object({
    category: z.string(),
    month: z.string().optional(),
  });

  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(retailSalesEntry);
    return cache.query<Row>(retailSalesEntry.datasetId, { limit: 1000 });
  }

  return [
    {
      name: "sg_retail_sales_latest",
      description:
        "Most recent retail sales index value for a matching sub-industry " +
        "(substring match on DataSeries). Defaults to 'Total'.",
      inputSchema: latestInput,
      handler: async (input: unknown) => {
        const p = latestInput.parse(input);
        const rows = await fetchAll();
        const needle = p.category ?? "Total";
        const matching = rows.filter((r) => matchCategory(r, needle));
        if (matching.length === 0) {
          return {
            datasetId: retailSalesEntry.datasetId,
            query: needle,
            matches: [],
          };
        }
        const cols = extractMonthCols(matching[0]!);
        const sorted = sortMonthsDesc(cols);
        const latestCol = sorted[0];
        return {
          datasetId: retailSalesEntry.datasetId,
          query: needle,
          latest_month: latestCol ? prettyMonth(latestCol) : null,
          matches: matching.map((r) => ({
            category: r.DataSeries,
            index: latestCol ? toNumber(r[latestCol]) : null,
          })),
        };
      },
    },
    {
      name: "sg_retail_sales_history",
      description:
        "Monthly retail sales index time series for a sub-industry. " +
        "Defaults to 'Total'. Returns oldest-to-newest, trimmed to last " +
        "N months if given.",
      inputSchema: historyInput,
      handler: async (input: unknown) => {
        const p = historyInput.parse(input);
        const rows = await fetchAll();
        const needle = p.category ?? "Total";
        const hit = rows.find((r) => matchCategory(r, needle));
        if (!hit) {
          return {
            datasetId: retailSalesEntry.datasetId,
            category: needle,
            series: [],
          };
        }
        const cols = extractMonthCols(hit);
        const asc = sortMonthsDesc(cols).reverse();
        const trimmed = p.months_back ? asc.slice(-p.months_back) : asc;
        return {
          datasetId: retailSalesEntry.datasetId,
          category: hit.DataSeries,
          count: trimmed.length,
          series: trimmed.map((col) => ({
            month: prettyMonth(col),
            index: toNumber(hit[col]),
          })),
        };
      },
    },
    {
      name: "sg_retail_sales_yoy",
      description:
        "Year-on-year percent change in retail sales index for a " +
        "sub-industry in a given month (defaults to most recent month).",
      inputSchema: yoyInput,
      handler: async (input: unknown) => {
        const p = yoyInput.parse(input);
        const rows = await fetchAll();
        const hit = rows.find((r) => matchCategory(r, p.category));
        if (!hit) {
          return {
            datasetId: retailSalesEntry.datasetId,
            category: p.category,
            yoy_pct: null,
          };
        }
        let col: string | null = null;
        if (p.month) {
          const normalized = p.month.replace(/[-_/\s]/g, "");
          for (const c of [`_${normalized}`, normalized]) if (c in hit) col = c;
        } else {
          col = sortMonthsDesc(extractMonthCols(hit))[0] ?? null;
        }
        if (!col) {
          return {
            datasetId: retailSalesEntry.datasetId,
            category: hit.DataSeries,
            month: p.month,
            error: "Unknown month column",
          };
        }
        const cur = toNumber(hit[col]);
        const yaCol = yearAgoCol(col, hit);
        const ya = yaCol ? toNumber(hit[yaCol]) : null;
        const yoy =
          cur != null && ya != null && ya !== 0 ? ((cur - ya) / ya) * 100 : null;
        return {
          datasetId: retailSalesEntry.datasetId,
          category: hit.DataSeries,
          month: prettyMonth(col),
          index: cur,
          year_ago_index: ya,
          yoy_pct: yoy,
        };
      },
    },
  ];
}

/**
 * MAS Exchange Rates (Average for Period), Monthly.
 *
 * Dataset: d_b2b7ffe00aaec3936ed379369fdf531b — wide format, ~30 rows.
 * Columns: "DataSeries" (currency pair) + monthly columns "2026Jan", …
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const masFxEntry: DatasetEntry = {
  id: "mas_fx",
  datasetId: "d_b2b7ffe00aaec3936ed379369fdf531b",
  shardCollection: false,
  name: "MAS Exchange Rates (Average for Period), Monthly",
  description:
    "MAS monthly average SGD exchange rates by currency pair, wide format. " +
    "Values are SGD per unit (except where the DataSeries label says " +
    "'Per 100').",
  agency: "MAS",
  refreshDays: 30,
  tags: ["economy", "fx", "mas", "monthly"],
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

function matchCurrency(row: Row, needle?: string): boolean {
  if (!needle) return true;
  const ds = (row.DataSeries as string | null) ?? "";
  return ds.toLowerCase().includes(needle.toLowerCase());
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

export function createMasFxTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  const rateInput = z.object({
    currency: z.string(),
    month: z.string().optional(),
  });

  const historyInput = z.object({
    currency: z.string(),
    months_back: z.number().int().positive().max(600).optional(),
  });

  const basketInput = z.object({
    month: z.string().optional(),
  });

  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(masFxEntry);
    return cache.query<Row>(masFxEntry.datasetId, { limit: 1000 });
  }

  return [
    {
      name: "sg_fx_rate",
      description:
        "Monthly SGD exchange rate for a given currency. Currency is " +
        "matched as a substring against DataSeries (e.g. 'U S Dollar', " +
        "'Euro', 'Japanese Yen'). If month is omitted, returns the most " +
        "recent month. Note the 'Per 100' note in the DataSeries label " +
        "when present.",
      inputSchema: rateInput,
      handler: async (input: unknown) => {
        const p = rateInput.parse(input);
        const rows = await fetchAll();
        const hit = rows.find((r) => matchCurrency(r, p.currency));
        if (!hit) {
          return { datasetId: masFxEntry.datasetId, currency: p.currency, rate: null };
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
            datasetId: masFxEntry.datasetId,
            currency: hit.DataSeries,
            month: p.month,
            error: "Unknown month column",
          };
        }
        return {
          datasetId: masFxEntry.datasetId,
          currency: hit.DataSeries,
          month: prettyMonth(col),
          rate: toNumber(hit[col]),
        };
      },
    },
    {
      name: "sg_fx_history",
      description:
        "Monthly SGD rate time series for a single currency. Returns " +
        "oldest-to-newest, trimmed to last N months.",
      inputSchema: historyInput,
      handler: async (input: unknown) => {
        const p = historyInput.parse(input);
        const rows = await fetchAll();
        const hit = rows.find((r) => matchCurrency(r, p.currency));
        if (!hit) {
          return { datasetId: masFxEntry.datasetId, currency: p.currency, series: [] };
        }
        const cols = extractMonthCols(hit);
        const asc = sortMonthsDesc(cols).reverse();
        const trimmed = p.months_back ? asc.slice(-p.months_back) : asc;
        return {
          datasetId: masFxEntry.datasetId,
          currency: hit.DataSeries,
          count: trimmed.length,
          series: trimmed.map((col) => ({
            month: prettyMonth(col),
            rate: toNumber(hit[col]),
          })),
        };
      },
    },
    {
      name: "sg_fx_basket",
      description:
        "All major SGD currency pairs for a single month. If month is " +
        "omitted, uses the most recent month.",
      inputSchema: basketInput,
      handler: async (input: unknown) => {
        const p = basketInput.parse(input);
        const rows = await fetchAll();
        if (rows.length === 0) {
          return { datasetId: masFxEntry.datasetId, rates: [] };
        }
        let col: string | null = null;
        if (p.month) {
          const normalized = p.month.replace(/[-_/\s]/g, "");
          for (const c of [`_${normalized}`, normalized]) if (c in rows[0]!) col = c;
        } else {
          col = sortMonthsDesc(extractMonthCols(rows[0]!))[0] ?? null;
        }
        if (!col) {
          return { datasetId: masFxEntry.datasetId, error: "Unknown month column" };
        }
        return {
          datasetId: masFxEntry.datasetId,
          month: prettyMonth(col),
          rates: rows.map((r) => ({
            currency: r.DataSeries,
            rate: toNumber(r[col!]),
          })),
        };
      },
    },
  ];
}

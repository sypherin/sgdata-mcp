/**
 * Electricity Generation, Monthly.
 *
 * Dataset: d_ae4afbaf5bc96bde19d8ce85810ab9f4 — wide format.
 * Rows: generation sources (Total, Steam, Gas Turbine/CCGT, etc.).
 * Columns: "DataSeries" + monthly columns like "2025Dec", "2025Nov", ...
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const electricityEntry: DatasetEntry = {
  id: "electricity",
  datasetId: "d_ae4afbaf5bc96bde19d8ce85810ab9f4",
  shardCollection: false,
  name: "Electricity Generation, Monthly",
  description:
    "EMA monthly electricity generation in GWh by source (total, steam, " +
    "gas turbine/CCGT, others).",
  agency: "EMA",
  refreshDays: 30,
  tags: ["energy", "electricity", "ema", "infrastructure"],
};

type Row = Record<string, string | null>;

const MONTH_RE = /^_?(\d{4})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/;
const MONTH_IDX: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function extractMonthCols(row: Row): string[] {
  return Object.keys(row).filter((k) => MONTH_RE.test(k));
}

function monthColToSortable(col: string): string {
  const m = col.match(MONTH_RE);
  if (!m) return "0000-00";
  return `${m[1]}-${MONTH_IDX[m[2]] ?? "00"}`;
}

function sortMonthsDesc(cols: string[]): string[] {
  return [...cols].sort((a, b) =>
    monthColToSortable(b).localeCompare(monthColToSortable(a)),
  );
}

function prettyMonth(col: string): string {
  const m = col.match(MONTH_RE);
  return m ? `${m[1]} ${m[2]}` : col;
}

function matchSource(row: Row, needle?: string): boolean {
  if (!needle) return true;
  const ds = (row.DataSeries as string | null) ?? "";
  return ds.toLowerCase().includes(needle.toLowerCase());
}

export function createElectricityTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(electricityEntry);
    return cache.query<Row>(electricityEntry.datasetId, { limit: 1000 });
  }

  return [
    {
      name: "sg_electricity_latest",
      description:
        "Get the most recent month's electricity generation figures " +
        "by source. Optionally filter by source (e.g. 'Total', 'Gas').",
      inputSchema: z.object({
        source: z.string().optional(),
      }),
      handler: async (input: unknown) => {
        const p = z.object({ source: z.string().optional() }).parse(input);
        const rows = await fetchAll();
        const matching = rows.filter((r) => matchSource(r, p.source));
        if (!matching.length)
          return { datasetId: electricityEntry.datasetId, matches: [] };
        const monthCols = extractMonthCols(matching[0]!);
        const sorted = sortMonthsDesc(monthCols);
        const latestCol = sorted[0];
        return {
          datasetId: electricityEntry.datasetId,
          latest_month: latestCol ? prettyMonth(latestCol) : null,
          count: matching.length,
          sources: matching.map((r) => ({
            source: r.DataSeries,
            generation_gwh: latestCol ? r[latestCol] : null,
          })),
        };
      },
    },
    {
      name: "sg_electricity_history",
      description:
        "Monthly electricity generation time series for a given source " +
        "(e.g. 'Total', 'Gas Turbine / Combined Cycle'). Returns " +
        "oldest-to-newest, optionally trimmed to last N months.",
      inputSchema: z.object({
        source: z.string(),
        months_back: z.number().int().positive().max(600).optional(),
      }),
      handler: async (input: unknown) => {
        const p = z
          .object({
            source: z.string(),
            months_back: z.number().int().positive().max(600).optional(),
          })
          .parse(input);
        const rows = await fetchAll();
        const hit = rows.find((r) => matchSource(r, p.source));
        if (!hit)
          return {
            datasetId: electricityEntry.datasetId,
            source: p.source,
            series: [],
          };
        const cols = extractMonthCols(hit);
        const asc = sortMonthsDesc(cols).reverse();
        const trimmed = p.months_back ? asc.slice(-p.months_back) : asc;
        return {
          datasetId: electricityEntry.datasetId,
          source: hit.DataSeries,
          count: trimmed.length,
          series: trimmed.map((col) => ({
            month: prettyMonth(col),
            generation_gwh: hit[col],
          })),
        };
      },
    },
  ];
}

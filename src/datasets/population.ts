/**
 * Indicators On Population, Annual.
 *
 * Dataset: d_3d227e5d9fdec73f3bcadce671c333a6 — wide format.
 * Rows: ~30 indicators (Total Population, Residents, Citizens, PRs,
 * Non-Residents, Growth Rate, Median Age, Dependency Ratio, etc.).
 * Columns: "DataSeries" + one column per year, e.g. "2025", "2024", ...
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const populationEntry: DatasetEntry = {
  id: "population",
  datasetId: "d_3d227e5d9fdec73f3bcadce671c333a6",
  shardCollection: false,
  name: "Indicators On Population, Annual",
  description:
    "SingStat annual population indicators — total population, residents, " +
    "citizens, PRs, non-residents, growth rate, median age, dependency ratio.",
  agency: "SingStat",
  refreshDays: 90,
  tags: ["population", "demographics", "singstat"],
};

type Row = Record<string, string | null>;

const YEAR_RE = /^_?(\d{4})$/;

function extractYearCols(row: Row): string[] {
  return Object.keys(row).filter((k) => YEAR_RE.test(k));
}

function sortYearsDesc(cols: string[]): string[] {
  return [...cols].sort((a, b) => {
    const ya = Number(a.replace(/^_/, ""));
    const yb = Number(b.replace(/^_/, ""));
    return yb - ya;
  });
}

function prettyYear(col: string): string {
  return col.replace(/^_/, "");
}

function matchIndicator(row: Row, needle?: string): boolean {
  if (!needle) return true;
  const ds = (row.DataSeries as string | null) ?? "";
  return ds.toLowerCase().includes(needle.toLowerCase());
}

export function createPopulationTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(populationEntry);
    return cache.query<Row>(populationEntry.datasetId, { limit: 1000 });
  }

  return [
    {
      name: "sg_population_latest",
      description:
        "Get the most recent annual population figure for a matching " +
        "indicator (substring match, e.g. 'Total Population', 'Median Age', " +
        "'Dependency Ratio'). Omit indicator to get all.",
      inputSchema: z.object({
        indicator: z.string().optional(),
      }),
      handler: async (input: unknown) => {
        const p = z.object({ indicator: z.string().optional() }).parse(input);
        const rows = await fetchAll();
        const matching = rows.filter((r) => matchIndicator(r, p.indicator));
        if (!matching.length)
          return { datasetId: populationEntry.datasetId, matches: [] };
        const yearCols = extractYearCols(matching[0]!);
        const sorted = sortYearsDesc(yearCols);
        const latestCol = sorted[0];
        return {
          datasetId: populationEntry.datasetId,
          latest_year: latestCol ? prettyYear(latestCol) : null,
          count: matching.length,
          indicators: matching.map((r) => ({
            indicator: r.DataSeries,
            value: latestCol ? r[latestCol] : null,
          })),
        };
      },
    },
    {
      name: "sg_population_history",
      description:
        "Annual time series for a single population indicator (e.g. " +
        "'Total Population'). Returns oldest-to-newest, optionally " +
        "trimmed to last N years.",
      inputSchema: z.object({
        indicator: z.string(),
        years_back: z.number().int().positive().max(100).optional(),
      }),
      handler: async (input: unknown) => {
        const p = z
          .object({
            indicator: z.string(),
            years_back: z.number().int().positive().max(100).optional(),
          })
          .parse(input);
        const rows = await fetchAll();
        const hit = rows.find((r) => matchIndicator(r, p.indicator));
        if (!hit)
          return {
            datasetId: populationEntry.datasetId,
            indicator: p.indicator,
            series: [],
          };
        const cols = extractYearCols(hit);
        const asc = sortYearsDesc(cols).reverse();
        const trimmed = p.years_back ? asc.slice(-p.years_back) : asc;
        return {
          datasetId: populationEntry.datasetId,
          indicator: hit.DataSeries,
          count: trimmed.length,
          series: trimmed.map((col) => ({
            year: prettyYear(col),
            value: hit[col],
          })),
        };
      },
    },
  ];
}

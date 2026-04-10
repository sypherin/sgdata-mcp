/**
 * Live-Births By Sex And Ethnic Group, Monthly.
 *
 * Dataset: d_d05c760928eb5eaa58006d83462b834e — wide format.
 * Rows: breakdowns by sex/ethnic group (e.g. "Total Live-Births",
 * "Males", "Females", "Chinese", "Malays", "Indians").
 * Columns: "DataSeries" + monthly columns like "2025Mar", "2025Feb", ...
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const birthsEntry: DatasetEntry = {
  id: "births",
  datasetId: "d_d05c760928eb5eaa58006d83462b834e",
  shardCollection: false,
  name: "Live-Births By Sex And Ethnic Group, Monthly",
  description:
    "SingStat monthly live-birth counts by sex and ethnic group.",
  agency: "SingStat",
  refreshDays: 30,
  tags: ["population", "births", "demographics", "singstat"],
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

export function createBirthsTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(birthsEntry);
    return cache.query<Row>(birthsEntry.datasetId, { limit: 1000 });
  }

  return [
    {
      name: "sg_births_latest",
      description:
        "Get the most recent month's live-birth counts by sex and " +
        "ethnic group. Optionally filter by category (e.g. 'Total', " +
        "'Males', 'Chinese').",
      inputSchema: z.object({
        category: z.string().optional(),
      }),
      handler: async (input: unknown) => {
        const p = z.object({ category: z.string().optional() }).parse(input);
        const rows = await fetchAll();
        const matching = p.category
          ? rows.filter((r) =>
              ((r.DataSeries as string) ?? "")
                .toLowerCase()
                .includes(p.category!.toLowerCase()),
            )
          : rows;
        if (!matching.length)
          return { datasetId: birthsEntry.datasetId, matches: [] };
        const monthCols = extractMonthCols(matching[0]!);
        const sorted = sortMonthsDesc(monthCols);
        const latestCol = sorted[0];
        return {
          datasetId: birthsEntry.datasetId,
          latest_month: latestCol ? prettyMonth(latestCol) : null,
          count: matching.length,
          categories: matching.map((r) => ({
            category: r.DataSeries,
            births: latestCol ? r[latestCol] : null,
          })),
        };
      },
    },
    {
      name: "sg_births_history",
      description:
        "Monthly live-birth count time series for a category (e.g. " +
        "'Total Live-Births'). Returns oldest-to-newest.",
      inputSchema: z.object({
        category: z.string(),
        months_back: z.number().int().positive().max(600).optional(),
      }),
      handler: async (input: unknown) => {
        const p = z
          .object({
            category: z.string(),
            months_back: z.number().int().positive().max(600).optional(),
          })
          .parse(input);
        const rows = await fetchAll();
        const hit = rows.find((r) =>
          ((r.DataSeries as string) ?? "")
            .toLowerCase()
            .includes(p.category.toLowerCase()),
        );
        if (!hit)
          return {
            datasetId: birthsEntry.datasetId,
            category: p.category,
            series: [],
          };
        const cols = extractMonthCols(hit);
        const asc = sortMonthsDesc(cols).reverse();
        const trimmed = p.months_back ? asc.slice(-p.months_back) : asc;
        return {
          datasetId: birthsEntry.datasetId,
          category: hit.DataSeries,
          count: trimmed.length,
          series: trimmed.map((col) => ({
            month: prettyMonth(col),
            births: hit[col],
          })),
        };
      },
    },
  ];
}

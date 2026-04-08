/**
 * GDP Year-on-Year Growth Rate, Quarterly.
 *
 * Dataset: d_a5ff719648a0e6d4b4c623ee383ab686 — wide format.
 * Rows: ~80 industry breakdowns (e.g. "GDP At Constant 2015 Market Prices",
 * "Manufacturing", "Construction", "Services Producing Industries").
 * Columns: "DataSeries" + one column per quarter, e.g. "20254Q", "20253Q" …
 *
 * The cache sanitizes identifiers, so quarter columns become "_20254Q" etc.
 * (leading digit gets a "_" prefix). DataSeries stays "DataSeries".
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const gdpYoyEntry: DatasetEntry = {
  id: "gdp_yoy",
  datasetId: "d_a5ff719648a0e6d4b4c623ee383ab686",
  shardCollection: false,
  name: "GDP Year-on-Year Growth Rate, Quarterly",
  description:
    "SingStat quarterly GDP YoY growth by industry, in wide format. One row " +
    "per industry; one column per quarter.",
  agency: "SingStat",
  refreshDays: 30,
  tags: ["economy", "gdp", "singstat", "macro"],
};

type Row = Record<string, string | null>;

/** Match cache-sanitized quarter column names like "_20254Q". */
const QUARTER_RE = /^_?(\d{4})([1-4])Q$/;

function extractQuarterCols(row: Row): string[] {
  return Object.keys(row).filter((k) => QUARTER_RE.test(k));
}

function quarterKeyToSortable(col: string): string {
  const m = col.match(QUARTER_RE);
  if (!m) return "0000-0";
  return `${m[1]}-${m[2]}`;
}

function sortQuartersDesc(cols: string[]): string[] {
  return [...cols].sort((a, b) =>
    quarterKeyToSortable(b).localeCompare(quarterKeyToSortable(a)),
  );
}

function prettyQuarter(col: string): string {
  const m = col.match(QUARTER_RE);
  return m ? `${m[1]}Q${m[2]}` : col;
}

function matchIndustry(row: Row, needle?: string): boolean {
  if (!needle) return true;
  const ds = (row.DataSeries as string | null) ?? "";
  return ds.toLowerCase().includes(needle.toLowerCase());
}

export function createGdpYoyTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  const latestInput = z.object({
    industry: z.string().optional(),
  });

  const historyInput = z.object({
    industry: z.string(),
    quarters_back: z.number().int().positive().max(200).optional(),
  });

  const compareInput = z.object({
    quarter: z.string(),
  });

  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(gdpYoyEntry);
    return cache.query<Row>(gdpYoyEntry.datasetId, { limit: 1000 });
  }

  return [
    {
      name: "sg_gdp_latest",
      description:
        "Get the most recent YoY GDP growth rate for a matching industry " +
        "(substring match on DataSeries, e.g. 'Manufacturing'). Omit " +
        "industry to get the headline 'GDP At Constant 2015 Market Prices'.",
      inputSchema: latestInput,
      handler: async (input: unknown) => {
        const p = latestInput.parse(input);
        const rows = await fetchAll();
        const needle = p.industry ?? "GDP At Constant";
        const matching = rows.filter((r) => matchIndustry(r, needle));
        if (matching.length === 0) {
          return {
            datasetId: gdpYoyEntry.datasetId,
            query: needle,
            matches: [],
          };
        }
        const quarterCols = extractQuarterCols(matching[0]!);
        const sorted = sortQuartersDesc(quarterCols);
        const latestCol = sorted[0];
        return {
          datasetId: gdpYoyEntry.datasetId,
          query: needle,
          latest_quarter: latestCol ? prettyQuarter(latestCol) : null,
          matches: matching.map((r) => ({
            industry: r.DataSeries,
            yoy_growth: latestCol ? r[latestCol] : null,
          })),
        };
      },
    },
    {
      name: "sg_gdp_history",
      description:
        "Time series of YoY GDP growth for a single industry (substring " +
        "match on DataSeries). Returns oldest-to-newest, trimmed to the " +
        "last N quarters if quarters_back is given.",
      inputSchema: historyInput,
      handler: async (input: unknown) => {
        const p = historyInput.parse(input);
        const rows = await fetchAll();
        const hit = rows.find((r) => matchIndustry(r, p.industry));
        if (!hit) {
          return {
            datasetId: gdpYoyEntry.datasetId,
            industry: p.industry,
            series: [],
          };
        }
        const cols = extractQuarterCols(hit);
        const asc = sortQuartersDesc(cols).reverse();
        const trimmed = p.quarters_back
          ? asc.slice(-p.quarters_back)
          : asc;
        const series = trimmed.map((col) => ({
          quarter: prettyQuarter(col),
          yoy_growth: hit[col],
        }));
        return {
          datasetId: gdpYoyEntry.datasetId,
          industry: hit.DataSeries,
          count: series.length,
          series,
        };
      },
    },
    {
      name: "sg_gdp_industry_compare",
      description:
        "Rank all industries by YoY growth for a given quarter (e.g. " +
        "'2025Q4', '20254Q'). Returns every industry row with its growth " +
        "value, sorted descending.",
      inputSchema: compareInput,
      handler: async (input: unknown) => {
        const p = compareInput.parse(input);
        const rows = await fetchAll();
        // Accept "2025Q4", "2025q4", or "20254Q"
        const norm = p.quarter.toUpperCase().replace(/Q/g, "");
        // norm is like "20254" — last digit is quarter, first 4 are year
        if (!/^\d{5}$/.test(norm)) {
          return {
            datasetId: gdpYoyEntry.datasetId,
            error: `Unrecognized quarter '${p.quarter}'. Use '2025Q4' or '20254Q'.`,
          };
        }
        const year = norm.slice(0, 4);
        const q = norm.slice(4, 5);
        const col = `_${year}${q}Q`;
        const fallback = `${year}${q}Q`;
        const useCol = rows[0] && col in rows[0] ? col : fallback;
        const ranked = rows
          .map((r) => ({
            industry: r.DataSeries,
            yoy_growth: r[useCol],
            numeric: Number(r[useCol]),
          }))
          .filter((x) => Number.isFinite(x.numeric))
          .sort((a, b) => b.numeric - a.numeric);
        return {
          datasetId: gdpYoyEntry.datasetId,
          quarter: `${year}Q${q}`,
          count: ranked.length,
          rows: ranked,
        };
      },
    },
  ];
}

/**
 * Crime Cases Recorded, Annual.
 *
 * Dataset: d_ca0b908cf06a267ca06acbd5feb4465c — wide format.
 * Rows: crime types (Robbery, Housebreaking, Theft, Cheating, etc.).
 * Columns: "DataSeries" + one column per year, e.g. "2025", "2024", ...
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const crimeEntry: DatasetEntry = {
  id: "crime",
  datasetId: "d_ca0b908cf06a267ca06acbd5feb4465c",
  shardCollection: false,
  name: "Crime Cases Recorded, Annual",
  description:
    "SPF annual crime case counts by type — robbery, housebreaking, " +
    "theft, cheating, outrage of modesty, and more.",
  agency: "SPF",
  refreshDays: 90,
  tags: ["crime", "safety", "spf", "social"],
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

export function createCrimeTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(crimeEntry);
    return cache.query<Row>(crimeEntry.datasetId, { limit: 1000 });
  }

  return [
    {
      name: "sg_crime_latest",
      description:
        "Get the most recent year's crime case counts by type. " +
        "Optionally filter by crime type (substring match, e.g. " +
        "'Robbery', 'Cheating', 'Scam').",
      inputSchema: z.object({
        crime_type: z.string().optional(),
      }),
      handler: async (input: unknown) => {
        const p = z.object({ crime_type: z.string().optional() }).parse(input);
        const rows = await fetchAll();
        const matching = p.crime_type
          ? rows.filter((r) =>
              ((r.DataSeries as string) ?? "")
                .toLowerCase()
                .includes(p.crime_type!.toLowerCase()),
            )
          : rows;
        if (!matching.length)
          return { datasetId: crimeEntry.datasetId, matches: [] };
        const yearCols = extractYearCols(matching[0]!);
        const sorted = sortYearsDesc(yearCols);
        const latestCol = sorted[0];
        return {
          datasetId: crimeEntry.datasetId,
          latest_year: latestCol ? prettyYear(latestCol) : null,
          count: matching.length,
          crimes: matching.map((r) => ({
            crime_type: r.DataSeries,
            cases: latestCol ? r[latestCol] : null,
          })),
        };
      },
    },
    {
      name: "sg_crime_history",
      description:
        "Annual crime case count time series for a specific crime " +
        "type (e.g. 'Total Crimes', 'Cheating'). Returns oldest-to-newest.",
      inputSchema: z.object({
        crime_type: z.string(),
        years_back: z.number().int().positive().max(100).optional(),
      }),
      handler: async (input: unknown) => {
        const p = z
          .object({
            crime_type: z.string(),
            years_back: z.number().int().positive().max(100).optional(),
          })
          .parse(input);
        const rows = await fetchAll();
        const hit = rows.find((r) =>
          ((r.DataSeries as string) ?? "")
            .toLowerCase()
            .includes(p.crime_type.toLowerCase()),
        );
        if (!hit)
          return {
            datasetId: crimeEntry.datasetId,
            crime_type: p.crime_type,
            series: [],
          };
        const cols = extractYearCols(hit);
        const asc = sortYearsDesc(cols).reverse();
        const trimmed = p.years_back ? asc.slice(-p.years_back) : asc;
        return {
          datasetId: crimeEntry.datasetId,
          crime_type: hit.DataSeries,
          count: trimmed.length,
          series: trimmed.map((col) => ({
            year: prettyYear(col),
            cases: hit[col],
          })),
        };
      },
    },
    {
      name: "sg_crime_compare",
      description:
        "Rank all crime types by case count for a given year. Returns " +
        "every crime type sorted descending by number of cases.",
      inputSchema: z.object({
        year: z.string(),
      }),
      handler: async (input: unknown) => {
        const p = z.object({ year: z.string() }).parse(input);
        const rows = await fetchAll();
        const col = `_${p.year}`;
        const fallback = p.year;
        const useCol =
          rows[0] && col in rows[0] ? col : fallback;
        const ranked = rows
          .map((r) => ({
            crime_type: r.DataSeries,
            cases: r[useCol],
            numeric: Number(String(r[useCol] ?? "").replace(/,/g, "")),
          }))
          .filter((x) => Number.isFinite(x.numeric))
          .sort((a, b) => b.numeric - a.numeric);
        return {
          datasetId: crimeEntry.datasetId,
          year: p.year,
          count: ranked.length,
          crimes: ranked,
        };
      },
    },
  ];
}

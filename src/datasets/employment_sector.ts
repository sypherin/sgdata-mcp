/**
 * Employment (Persons) by Sector, Annual.
 *
 * Dataset: d_d2518fed6cc2014f0cd061b4570a9592 — wide format, ~25 rows.
 * Columns: "DataSeries" (sector) + annual columns "2023", "2022", …
 * Cache sanitizes digit-prefixed column names, so "2023" → "_2023".
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const employmentSectorEntry: DatasetEntry = {
  id: "employment_sector",
  datasetId: "d_d2518fed6cc2014f0cd061b4570a9592",
  shardCollection: false,
  name: "Employment (Persons) by Sector, Annual",
  description:
    "SingStat annual employment counts by sector, wide format. One row " +
    "per sector, one column per year.",
  agency: "SingStat",
  refreshDays: 90,
  tags: ["labour", "employment", "singstat", "sector"],
};

type Row = Record<string, string | null>;

const YEAR_RE = /^_?(\d{4})$/;

function extractYearCols(row: Row): string[] {
  return Object.keys(row).filter((k) => YEAR_RE.test(k));
}

function yearOf(col: string): number {
  const m = col.match(YEAR_RE);
  return m ? Number(m[1]) : 0;
}

function sortYearsAsc(cols: string[]): string[] {
  return [...cols].sort((a, b) => yearOf(a) - yearOf(b));
}

function matchSector(row: Row, needle?: string): boolean {
  if (!needle) return true;
  const ds = (row.DataSeries as string | null) ?? "";
  return ds.toLowerCase().includes(needle.toLowerCase());
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

export function createEmploymentSectorTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  const latestInput = z.object({
    year: z.number().int().optional(),
    sector: z.string().optional(),
  });

  const historyInput = z.object({
    sector: z.string(),
    years_back: z.number().int().positive().max(100).optional(),
  });

  const growthInput = z.object({
    sector: z.string(),
    base_year: z.number().int(),
    target_year: z.number().int(),
  });

  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(employmentSectorEntry);
    return cache.query<Row>(employmentSectorEntry.datasetId, { limit: 1000 });
  }

  function yearCol(row: Row, year: number): string | null {
    const a = `_${year}`;
    const b = `${year}`;
    if (a in row) return a;
    if (b in row) return b;
    return null;
  }

  return [
    {
      name: "sg_employment_by_sector",
      description:
        "Employment counts by sector for a given year. If year is omitted, " +
        "uses the most recent year. If sector is supplied, filters to rows " +
        "whose DataSeries contains that substring.",
      inputSchema: latestInput,
      handler: async (input: unknown) => {
        const p = latestInput.parse(input);
        const rows = await fetchAll();
        const matching = rows.filter((r) => matchSector(r, p.sector));
        if (matching.length === 0) {
          return {
            datasetId: employmentSectorEntry.datasetId,
            year: p.year,
            rows: [],
          };
        }
        let year = p.year;
        if (year == null) {
          const cols = extractYearCols(matching[0]!);
          const sorted = sortYearsAsc(cols);
          const last = sorted[sorted.length - 1];
          year = last ? yearOf(last) : 0;
        }
        return {
          datasetId: employmentSectorEntry.datasetId,
          year,
          rows: matching.map((r) => {
            const col = yearCol(r, year!);
            return {
              sector: r.DataSeries,
              employment: col ? toNumber(r[col]) : null,
            };
          }),
        };
      },
    },
    {
      name: "sg_employment_sector_history",
      description:
        "Employment time series for a single sector (substring match on " +
        "DataSeries), oldest-to-newest. Optionally trimmed to last N years.",
      inputSchema: historyInput,
      handler: async (input: unknown) => {
        const p = historyInput.parse(input);
        const rows = await fetchAll();
        const hit = rows.find((r) => matchSector(r, p.sector));
        if (!hit) {
          return {
            datasetId: employmentSectorEntry.datasetId,
            sector: p.sector,
            series: [],
          };
        }
        const cols = sortYearsAsc(extractYearCols(hit));
        const trimmed = p.years_back ? cols.slice(-p.years_back) : cols;
        return {
          datasetId: employmentSectorEntry.datasetId,
          sector: hit.DataSeries,
          count: trimmed.length,
          series: trimmed.map((col) => ({
            year: yearOf(col),
            employment: toNumber(hit[col]),
          })),
        };
      },
    },
    {
      name: "sg_employment_growth",
      description:
        "Percent change in employment for a sector between two years " +
        "(substring match on DataSeries).",
      inputSchema: growthInput,
      handler: async (input: unknown) => {
        const p = growthInput.parse(input);
        const rows = await fetchAll();
        const hit = rows.find((r) => matchSector(r, p.sector));
        if (!hit) {
          return {
            datasetId: employmentSectorEntry.datasetId,
            sector: p.sector,
            error: "sector not found",
          };
        }
        const baseCol = yearCol(hit, p.base_year);
        const targetCol = yearCol(hit, p.target_year);
        const base = baseCol ? toNumber(hit[baseCol]) : null;
        const target = targetCol ? toNumber(hit[targetCol]) : null;
        const growth =
          base != null && target != null && base !== 0
            ? ((target - base) / base) * 100
            : null;
        return {
          datasetId: employmentSectorEntry.datasetId,
          sector: hit.DataSeries,
          base_year: p.base_year,
          target_year: p.target_year,
          base_employment: base,
          target_employment: target,
          growth_pct: growth,
        };
      },
    },
  ];
}

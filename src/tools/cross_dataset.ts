/**
 * Cross-dataset query tool — compare/correlate two datasets over time.
 *
 * Allows queries like "compare GDP growth vs unemployment rate" by
 * joining two time-series datasets on their time dimension.
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader } from "../core/index.js";
import { listDatasets, type DatasetEntry } from "../core/registry.js";
import type { ToolDef } from "./index.js";

const CrossDatasetInput = z.object({
  dataset_a: z
    .string()
    .describe("ID or name of the first dataset (e.g. 'gdp_yoy', 'unemployment')"),
  dataset_b: z
    .string()
    .describe("ID or name of the second dataset (e.g. 'cpi_monthly', 'crime')"),
  limit: z.number().int().positive().max(200).optional(),
});

type Row = Record<string, string | null>;

const MONTH_MAP: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};
const MONTH_TO_Q: Record<string, string> = {
  "01": "Q1", "02": "Q1", "03": "Q1",
  "04": "Q2", "05": "Q2", "06": "Q2",
  "07": "Q3", "08": "Q3", "09": "Q3",
  "10": "Q4", "11": "Q4", "12": "Q4",
};

/**
 * Normalize various period formats to a canonical sortable form.
 * - "20254Q" / "2025Q4" → "2025-Q4"
 * - "2025Dec" / "2025-12" → "2025-12"
 * - "2025-03" (quarterly meaning) → "2025-Q1"
 * - "2025" → "2025"
 */
function normalizePeriod(raw: string): { canonical: string; granularity: "Y" | "Q" | "M" } {
  // Quarter: "20254Q" or "2025Q4"
  let m = raw.match(/^(\d{4})(\d)Q$/);
  if (m) return { canonical: `${m[1]}-Q${m[2]}`, granularity: "Q" };
  m = raw.match(/^(\d{4})Q(\d)$/i);
  if (m) return { canonical: `${m[1]}-Q${m[2]}`, granularity: "Q" };

  // Month name: "2025Dec"
  m = raw.match(/^(\d{4})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/);
  if (m) return { canonical: `${m[1]}-${MONTH_MAP[m[2]]!}`, granularity: "M" };

  // YYYY-MM: "2025-12"
  m = raw.match(/^(\d{4})-(\d{2})$/);
  if (m) return { canonical: raw, granularity: "M" };

  // Plain year: "2025"
  m = raw.match(/^(\d{4})$/);
  if (m) return { canonical: raw, granularity: "Y" };

  return { canonical: raw, granularity: "Y" };
}

/** Coarsen month to quarter: "2025-12" → "2025-Q4" */
function monthToQuarter(monthPeriod: string): string {
  const m = monthPeriod.match(/^(\d{4})-(\d{2})$/);
  if (!m) return monthPeriod;
  return `${m[1]}-${MONTH_TO_Q[m[2]] ?? "Q1"}`;
}

/** Coarsen month or quarter to year: "2025-Q4" → "2025", "2025-12" → "2025" */
function toYear(period: string): string {
  return period.slice(0, 4);
}

function findDataset(query: string): DatasetEntry | undefined {
  const all = listDatasets();
  const q = query.toLowerCase();
  return (
    all.find((d) => d.id === q) ??
    all.find((d) => d.datasetId === query) ??
    all.find((d) => d.id.includes(q)) ??
    all.find((d) => (d.name ?? "").toLowerCase().includes(q))
  );
}

interface TimePoint {
  raw: string;
  canonical: string;
  granularity: "Y" | "Q" | "M";
  value: number;
}

function extractWideTimeSeries(rows: Row[]): TimePoint[] {
  // Use first row (headline) by default
  const target = rows[0];
  if (!target) return [];

  const periodCols = Object.keys(target).filter(
    (k) => k !== "DataSeries" && k !== "rowid",
  );
  return periodCols
    .map((col) => {
      const v = Number(String(target[col] ?? "").replace(/,/g, ""));
      const raw = col.replace(/^_/, "");
      const norm = normalizePeriod(raw);
      return { raw, canonical: norm.canonical, granularity: norm.granularity, value: v };
    })
    .filter((x) => Number.isFinite(x.value))
    .sort((a, b) => a.canonical.localeCompare(b.canonical));
}

function extractFlatTimeSeries(rows: Row[]): TimePoint[] {
  const cols = Object.keys(rows[0] ?? {});
  const periodKey = cols.find((k) =>
    ["period", "month", "year", "quarter", "epi_week"].includes(k.toLowerCase()),
  ) ?? "period";
  const valKey = cols.find(
    (k) =>
      k !== periodKey &&
      k !== "rowid" &&
      !["residential_status", "disease", "components", "flat_type"].includes(k) &&
      rows.some((r) => {
        const n = Number(String(r[k] ?? "").replace(/,/g, ""));
        return Number.isFinite(n) && n !== 0;
      }),
  );
  if (!valKey) return [];

  return rows
    .map((r) => {
      const raw = (r[periodKey] as string) ?? "";
      const v = Number(String(r[valKey] ?? "").replace(/,/g, ""));
      const norm = normalizePeriod(raw);
      return { raw, canonical: norm.canonical, granularity: norm.granularity, value: v };
    })
    .filter((x) => x.raw && Number.isFinite(x.value))
    .sort((a, b) => a.canonical.localeCompare(b.canonical));
}

function isWideFormat(rows: Row[]): boolean {
  return rows.length > 0 && "DataSeries" in (rows[0] ?? {});
}

/**
 * Align two time series to a common granularity by coarsening
 * the finer one (months→quarters, quarters→years).
 */
function alignGranularity(
  a: TimePoint[],
  b: TimePoint[],
): { seriesA: Map<string, number>; seriesB: Map<string, number> } {
  const gA = a[0]?.granularity ?? "Y";
  const gB = b[0]?.granularity ?? "Y";
  const granOrder = { Y: 0, Q: 1, M: 2 };
  const target = granOrder[gA] <= granOrder[gB] ? gA : gB;

  function coarsen(pts: TimePoint[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const pt of pts) {
      let key = pt.canonical;
      if (target === "Y") key = toYear(key);
      else if (target === "Q" && pt.granularity === "M") key = monthToQuarter(key);
      // For duplicate keys (e.g. multiple months → same quarter), take the latest
      map.set(key, pt.value);
    }
    return map;
  }

  return { seriesA: coarsen(a), seriesB: coarsen(b) };
}

export function createCrossDatasetTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  return [
    {
      name: "sg_cross_dataset",
      description:
        "Compare two Singapore datasets side-by-side over time. " +
        "Joins both datasets on their time dimension (year/quarter/month) " +
        "and returns aligned rows for correlation analysis. " +
        "Examples: compare GDP vs unemployment, CPI vs retail sales, " +
        "births vs population. Use dataset short IDs like 'gdp_yoy', " +
        "'unemployment', 'cpi_monthly', 'crime', etc.",
      inputSchema: CrossDatasetInput,
      handler: async (input: unknown) => {
        const p = CrossDatasetInput.parse(input);
        const entryA = findDataset(p.dataset_a);
        const entryB = findDataset(p.dataset_b);
        if (!entryA) return { error: `Dataset '${p.dataset_a}' not found. Use sg_list_datasets to see available datasets.` };
        if (!entryB) return { error: `Dataset '${p.dataset_b}' not found. Use sg_list_datasets to see available datasets.` };

        await downloader.ensureFresh(entryA);
        await downloader.ensureFresh(entryB);

        const rowsA = cache.query<Row>(entryA.datasetId, { limit: 100000 });
        const rowsB = cache.query<Row>(entryB.datasetId, { limit: 100000 });

        const ptsA = isWideFormat(rowsA)
          ? extractWideTimeSeries(rowsA)
          : extractFlatTimeSeries(rowsA);
        const ptsB = isWideFormat(rowsB)
          ? extractWideTimeSeries(rowsB)
          : extractFlatTimeSeries(rowsB);

        if (!ptsA.length || !ptsB.length) {
          return {
            dataset_a: { id: entryA.id, name: entryA.name },
            dataset_b: { id: entryB.id, name: entryB.name },
            error: "One or both datasets returned no time-series data.",
            debug_a_periods: ptsA.slice(0, 3).map((p) => p.canonical),
            debug_b_periods: ptsB.slice(0, 3).map((p) => p.canonical),
          };
        }

        // Align granularity then join
        const { seriesA, seriesB } = alignGranularity(ptsA, ptsB);
        const joined: Array<Record<string, unknown>> = [];
        for (const [period, valA] of seriesA) {
          const valB = seriesB.get(period);
          if (valB !== undefined) {
            joined.push({ period, [entryA.id]: valA, [entryB.id]: valB });
          }
        }
        joined.sort((a, b) =>
          String(a.period).localeCompare(String(b.period)),
        );

        const limit = p.limit ?? 50;
        const trimmed = joined.slice(-limit);

        return {
          dataset_a: { id: entryA.id, name: entryA.name },
          dataset_b: { id: entryB.id, name: entryB.name },
          granularity: ptsA[0]?.granularity + " vs " + ptsB[0]?.granularity,
          matched_periods: joined.length,
          showing: trimmed.length,
          data: trimmed,
        };
      },
    },
    {
      name: "sg_list_datasets",
      description:
        "List all available curated Singapore datasets with their IDs, " +
        "names, and agencies. Use this to discover dataset IDs for " +
        "sg_cross_dataset or other tools.",
      inputSchema: z.object({}),
      handler: async () => {
        const all = listDatasets();
        return {
          count: all.length,
          datasets: all.map((d) => ({
            id: d.id,
            name: d.name,
            agency: d.agency,
            tags: d.tags,
          })),
        };
      },
    },
  ];
}

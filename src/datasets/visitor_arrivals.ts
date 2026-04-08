/**
 * International Visitor Arrivals by Place of Residence, Monthly.
 *
 * Dataset: d_7e7b2ee60c6ffc962f80fef129cf306e — wide format, ~50 rows.
 * Columns: "DataSeries" (source country) + monthly columns "2026Jan", …
 * Cache sanitizes digit-prefixed column names, so "2026Jan" → "_2026Jan".
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const visitorArrivalsEntry: DatasetEntry = {
  id: "visitor_arrivals",
  datasetId: "d_7e7b2ee60c6ffc962f80fef129cf306e",
  collectionId: "1622",
  shardCollection: false,
  name: "International Visitor Arrivals, Monthly",
  description:
    "STB monthly international visitor arrivals by source country/region, " +
    "wide format.",
  agency: "STB",
  refreshDays: 30,
  tags: ["tourism", "visitors", "stb", "monthly"],
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

function matchCountry(row: Row, needle?: string): boolean {
  if (!needle) return true;
  const ds = (row.DataSeries as string | null) ?? "";
  return ds.toLowerCase().includes(needle.toLowerCase());
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

export function createVisitorArrivalsTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  const latestInput = z.object({
    country: z.string().optional(),
  });

  const historyInput = z.object({
    country: z.string().optional(),
    months_back: z.number().int().positive().max(600).optional(),
  });

  const topInput = z.object({
    month: z.string().optional(),
    n: z.number().int().positive().max(50).optional(),
  });

  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(visitorArrivalsEntry);
    return cache.query<Row>(visitorArrivalsEntry.datasetId, { limit: 5000 });
  }

  return [
    {
      name: "sg_visitors_latest",
      description:
        "Most recent monthly visitor arrivals for a matching source country " +
        "(substring match). Defaults to 'Total International Visitor Arrivals'.",
      inputSchema: latestInput,
      handler: async (input: unknown) => {
        const p = latestInput.parse(input);
        const rows = await fetchAll();
        const needle = p.country ?? "Total International";
        const matching = rows.filter((r) => matchCountry(r, needle));
        if (matching.length === 0) {
          return { datasetId: visitorArrivalsEntry.datasetId, query: needle, matches: [] };
        }
        const cols = extractMonthCols(matching[0]!);
        const sorted = sortMonthsDesc(cols);
        const latestCol = sorted[0];
        return {
          datasetId: visitorArrivalsEntry.datasetId,
          query: needle,
          latest_month: latestCol ? prettyMonth(latestCol) : null,
          matches: matching.map((r) => ({
            source: r.DataSeries,
            visitors: latestCol ? toNumber(r[latestCol]) : null,
          })),
        };
      },
    },
    {
      name: "sg_visitors_history",
      description:
        "Monthly visitor arrivals time series for a source country. " +
        "Defaults to 'Total International' if no country given. " +
        "Returns oldest-to-newest, trimmed to last N months.",
      inputSchema: historyInput,
      handler: async (input: unknown) => {
        const p = historyInput.parse(input);
        const rows = await fetchAll();
        const needle = p.country ?? "Total International";
        const hit = rows.find((r) => matchCountry(r, needle));
        if (!hit) {
          return {
            datasetId: visitorArrivalsEntry.datasetId,
            country: needle,
            series: [],
          };
        }
        const cols = extractMonthCols(hit);
        const asc = sortMonthsDesc(cols).reverse();
        const trimmed = p.months_back ? asc.slice(-p.months_back) : asc;
        return {
          datasetId: visitorArrivalsEntry.datasetId,
          country: hit.DataSeries,
          count: trimmed.length,
          series: trimmed.map((col) => ({
            month: prettyMonth(col),
            visitors: toNumber(hit[col]),
          })),
        };
      },
    },
    {
      name: "sg_visitors_top_sources",
      description:
        "Top N source countries by visitor arrivals for a given month. " +
        "If month is omitted, uses the most recent month. Excludes the " +
        "'Total' row.",
      inputSchema: topInput,
      handler: async (input: unknown) => {
        const p = topInput.parse(input);
        const n = p.n ?? 10;
        const rows = await fetchAll();
        if (rows.length === 0) {
          return { datasetId: visitorArrivalsEntry.datasetId, top: [] };
        }
        let col: string | null = null;
        if (p.month) {
          const normalized = p.month.replace(/[-_/\s]/g, "");
          const candidates = [`_${normalized}`, normalized];
          for (const c of candidates) if (c in rows[0]!) col = c;
        } else {
          col = sortMonthsDesc(extractMonthCols(rows[0]!))[0] ?? null;
        }
        if (!col) {
          return {
            datasetId: visitorArrivalsEntry.datasetId,
            error: "Unknown month column",
          };
        }
        const ranked = rows
          .filter(
            (r) =>
              !((r.DataSeries as string | null) ?? "")
                .toLowerCase()
                .includes("total"),
          )
          .map((r) => ({
            source: r.DataSeries,
            visitors: toNumber(r[col!]),
          }))
          .filter((x) => x.visitors != null)
          .sort((a, b) => (b.visitors ?? 0) - (a.visitors ?? 0))
          .slice(0, n);
        return {
          datasetId: visitorArrivalsEntry.datasetId,
          month: prettyMonth(col),
          top: ranked,
        };
      },
    },
  ];
}

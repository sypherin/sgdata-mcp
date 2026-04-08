/**
 * IRAS Collection by Tax Type, Annual.
 *
 * Dataset: d_21e22578cabce897e8b27801e5596140 — ~200 rows.
 * Columns: financial_year, tax_type, tax_collected.
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const irasTaxCollectionEntry: DatasetEntry = {
  id: "iras_tax_collection",
  datasetId: "d_21e22578cabce897e8b27801e5596140",
  shardCollection: false,
  name: "IRAS Collection by Tax Type, Annual",
  description:
    "IRAS annual tax collection totals by tax type (Corporate Income Tax, " +
    "GST, Property Tax, Stamp Duty, etc.).",
  agency: "IRAS",
  refreshDays: 90,
  tags: ["tax", "iras", "fiscal", "annual"],
};

type Row = Record<string, string | null>;

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function matchTaxType(row: Row, needle?: string): boolean {
  if (!needle) return true;
  const t = (row.tax_type as string | null) ?? "";
  return t.toLowerCase().includes(needle.toLowerCase());
}

export function createIrasTaxCollectionTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  const lookupInput = z.object({
    tax_type: z.string().optional(),
    financial_year: z.string().optional(),
  });

  const historyInput = z.object({
    tax_type: z.string(),
    years_back: z.number().int().positive().max(100).optional(),
  });

  const mixInput = z.object({
    financial_year: z.string(),
  });

  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(irasTaxCollectionEntry);
    return cache.query<Row>(irasTaxCollectionEntry.datasetId, { limit: 5000 });
  }

  return [
    {
      name: "sg_iras_collection",
      description:
        "Look up IRAS tax collection by tax_type (substring match) and/or " +
        "financial_year. If both omitted, returns the most recent year's " +
        "full breakdown.",
      inputSchema: lookupInput,
      handler: async (input: unknown) => {
        const p = lookupInput.parse(input);
        const rows = await fetchAll();
        let filtered = rows.filter((r) => matchTaxType(r, p.tax_type));
        if (p.financial_year) {
          filtered = filtered.filter(
            (r) => (r.financial_year as string | null) === p.financial_year,
          );
        }
        if (!p.financial_year && !p.tax_type) {
          // Return latest year
          const years = Array.from(
            new Set(
              rows
                .map((r) => r.financial_year as string | null)
                .filter((y): y is string => !!y),
            ),
          ).sort();
          const latest = years[years.length - 1];
          filtered = rows.filter((r) => r.financial_year === latest);
        }
        return {
          datasetId: irasTaxCollectionEntry.datasetId,
          rows: filtered,
        };
      },
    },
    {
      name: "sg_iras_collection_history",
      description:
        "Annual tax collection time series for a single tax_type " +
        "(substring match). Oldest-to-newest, trimmed to last N years.",
      inputSchema: historyInput,
      handler: async (input: unknown) => {
        const p = historyInput.parse(input);
        const rows = await fetchAll();
        const filtered = rows
          .filter((r) => matchTaxType(r, p.tax_type))
          .sort((a, b) =>
            ((a.financial_year as string) ?? "").localeCompare(
              (b.financial_year as string) ?? "",
            ),
          );
        const trimmed = p.years_back ? filtered.slice(-p.years_back) : filtered;
        return {
          datasetId: irasTaxCollectionEntry.datasetId,
          tax_type: p.tax_type,
          count: trimmed.length,
          rows: trimmed,
        };
      },
    },
    {
      name: "sg_iras_tax_mix",
      description:
        "Percentage breakdown of IRAS total collection by tax type for a " +
        "given financial_year.",
      inputSchema: mixInput,
      handler: async (input: unknown) => {
        const p = mixInput.parse(input);
        const rows = await fetchAll();
        const yearRows = rows.filter(
          (r) => (r.financial_year as string | null) === p.financial_year,
        );
        const total = yearRows
          .map((r) => toNumber(r.tax_collected) ?? 0)
          .reduce((a, b) => a + b, 0);
        const mix = yearRows
          .map((r) => {
            const amt = toNumber(r.tax_collected) ?? 0;
            return {
              tax_type: r.tax_type,
              tax_collected: amt,
              share_pct: total > 0 ? (amt / total) * 100 : null,
            };
          })
          .sort((a, b) => b.tax_collected - a.tax_collected);
        return {
          datasetId: irasTaxCollectionEntry.datasetId,
          financial_year: p.financial_year,
          total_collected: total,
          mix,
        };
      },
    },
  ];
}

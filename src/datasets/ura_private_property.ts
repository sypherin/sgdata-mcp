/**
 * URA Private Residential Property Transactions, Quarterly.
 *
 * Dataset: d_7c69c943d5f0d89d6a9a773d2b51f337 — ~600 rows.
 * Columns: quarter, type_of_sale, sale_status, units.
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const uraPrivatePropertyEntry: DatasetEntry = {
  id: "ura_private_property",
  datasetId: "d_7c69c943d5f0d89d6a9a773d2b51f337",
  shardCollection: false,
  name: "URA Private Residential Property Transactions",
  description:
    "URA quarterly private residential transaction counts by type of sale " +
    "(New Sale, Sub-Sale, Resale) and sale status.",
  agency: "URA",
  refreshDays: 30,
  tags: ["real-estate", "property", "ura", "transactions"],
};

type Row = Record<string, string | null>;

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/** URA quarter format is typically 'YYYYQn', e.g. '2025Q4'. */
function quarterSortKey(q: string | null | undefined): string {
  if (!q) return "0000-0";
  const m = q.match(/^(\d{4}).*?(\d)/);
  return m ? `${m[1]}-${m[2]}` : q;
}

export function createUraPrivatePropertyTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  const latestInput = z.object({});

  const historyInput = z.object({
    type_of_sale: z.string().optional(),
    quarters_back: z.number().int().positive().max(200).optional(),
  });

  const pipelineInput = z.object({
    quarters_back: z.number().int().positive().max(200).optional(),
  });

  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(uraPrivatePropertyEntry);
    return cache.query<Row>(uraPrivatePropertyEntry.datasetId, { limit: 10000 });
  }

  return [
    {
      name: "sg_ura_private_txn_latest",
      description:
        "Latest quarter of URA private residential transactions, broken " +
        "down by type_of_sale and sale_status.",
      inputSchema: latestInput,
      handler: async (input: unknown) => {
        latestInput.parse(input);
        const rows = await fetchAll();
        if (rows.length === 0) {
          return { datasetId: uraPrivatePropertyEntry.datasetId, latest_quarter: null, rows: [] };
        }
        const sorted = [...rows].sort((a, b) =>
          quarterSortKey(b.quarter as string).localeCompare(
            quarterSortKey(a.quarter as string),
          ),
        );
        const latestQuarter = sorted[0]!.quarter;
        const latestRows = sorted.filter((r) => r.quarter === latestQuarter);
        return {
          datasetId: uraPrivatePropertyEntry.datasetId,
          latest_quarter: latestQuarter,
          rows: latestRows,
        };
      },
    },
    {
      name: "sg_ura_private_txn_history",
      description:
        "URA private residential transaction volumes over time, " +
        "optionally filtered to a single type_of_sale ('New Sale', " +
        "'Sub-Sale', 'Resale'). Oldest-to-newest, optionally trimmed.",
      inputSchema: historyInput,
      handler: async (input: unknown) => {
        const p = historyInput.parse(input);
        const rows = await fetchAll();
        const filtered = rows.filter((r) => {
          if (
            p.type_of_sale &&
            ((r.type_of_sale as string | null) ?? "").toLowerCase() !==
              p.type_of_sale.toLowerCase()
          ) {
            return false;
          }
          return true;
        });
        const sorted = filtered.sort((a, b) =>
          quarterSortKey(a.quarter as string).localeCompare(
            quarterSortKey(b.quarter as string),
          ),
        );
        // Rough trim: rows-per-quarter varies, so approximate
        const quarters = Array.from(new Set(sorted.map((r) => r.quarter)));
        const trimmedQuarters = p.quarters_back
          ? quarters.slice(-p.quarters_back)
          : quarters;
        const keep = new Set(trimmedQuarters);
        return {
          datasetId: uraPrivatePropertyEntry.datasetId,
          type_of_sale: p.type_of_sale ?? "all",
          count: sorted.filter((r) => keep.has(r.quarter as string | null)).length,
          rows: sorted.filter((r) => keep.has(r.quarter as string | null)),
        };
      },
    },
    {
      name: "sg_ura_new_sale_pipeline",
      description:
        "New sale volume only, quarter-by-quarter, for pipeline analysis. " +
        "Returns summed units per quarter across all sale_status values.",
      inputSchema: pipelineInput,
      handler: async (input: unknown) => {
        const p = pipelineInput.parse(input);
        const rows = await fetchAll();
        const newSales = rows.filter(
          (r) =>
            ((r.type_of_sale as string | null) ?? "").toLowerCase() ===
            "new sale",
        );
        const byQuarter = new Map<string, number>();
        for (const r of newSales) {
          const q = (r.quarter as string | null) ?? "";
          const u = toNumber(r.units) ?? 0;
          byQuarter.set(q, (byQuarter.get(q) ?? 0) + u);
        }
        const series = Array.from(byQuarter.entries())
          .map(([quarter, units]) => ({ quarter, units }))
          .sort((a, b) =>
            quarterSortKey(a.quarter).localeCompare(quarterSortKey(b.quarter)),
          );
        const trimmed = p.quarters_back
          ? series.slice(-p.quarters_back)
          : series;
        return {
          datasetId: uraPrivatePropertyEntry.datasetId,
          count: trimmed.length,
          series: trimmed,
        };
      },
    },
  ];
}

/**
 * HDB Resale Flat Prices (Jan 2017+).
 *
 * Dataset: d_8b84c4ee58e3cfc0ece0d773c8ca6abc — single CSV, ~210k rows.
 * Columns (human labels, via cache): month, town, flat_type, block,
 * street_name, storey_range, floor_area_sqm, flat_model, lease_commence_date,
 * remaining_lease, resale_price.
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const hdbResaleEntry: DatasetEntry = {
  id: "hdb_resale",
  datasetId: "d_8b84c4ee58e3cfc0ece0d773c8ca6abc",
  collectionId: "189",
  shardCollection: false,
  name: "HDB Resale Flat Prices (Jan 2017+)",
  description:
    "HDB resale transactions from Jan 2017 onwards, refreshed monthly by HDB.",
  agency: "HDB",
  refreshDays: 7,
  tags: ["housing", "hdb", "real-estate", "transactions"],
};

type Row = Record<string, string | null>;

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function createHdbResaleTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  const searchInput = z.object({
    town: z.string().optional(),
    flat_type: z.string().optional(),
    month_from: z.string().optional(),
    month_to: z.string().optional(),
    min_price: z.number().optional(),
    max_price: z.number().optional(),
    limit: z.number().int().positive().max(500).optional(),
    offset: z.number().int().nonnegative().optional(),
  });

  const statsInput = z.object({
    town: z.string().optional(),
    flat_type: z.string().optional(),
    month_from: z.string().optional(),
    month_to: z.string().optional(),
  });

  async function fetchRows(
    where: Record<string, string | number>,
    like: Record<string, string>,
    limit = 100000,
  ): Promise<Row[]> {
    await downloader.ensureFresh(hdbResaleEntry);
    return cache.query<Row>(hdbResaleEntry.datasetId, { where, like, limit });
  }

  function filterByMonthAndPrice(
    rows: Row[],
    opts: {
      month_from?: string;
      month_to?: string;
      min_price?: number;
      max_price?: number;
    },
  ): Row[] {
    return rows.filter((r) => {
      const m = r.month as string | null;
      if (opts.month_from && (!m || m < opts.month_from)) return false;
      if (opts.month_to && (!m || m > opts.month_to)) return false;
      const p = toNumber(r.resale_price);
      if (opts.min_price != null && (p == null || p < opts.min_price)) return false;
      if (opts.max_price != null && (p == null || p > opts.max_price)) return false;
      return true;
    });
  }

  return [
    {
      name: "sg_hdb_resale_search",
      description:
        "Search HDB resale flat transactions (Jan 2017+). Filters: town, " +
        "flat_type (e.g. '4 ROOM'), month range (YYYY-MM), price range. " +
        "Returns paginated transaction rows.",
      inputSchema: searchInput,
      handler: async (input: unknown) => {
        const p = searchInput.parse(input);
        const limit = p.limit ?? 50;
        const offset = p.offset ?? 0;

        const where: Record<string, string | number> = {};
        if (p.town) where.town = p.town.toUpperCase();
        if (p.flat_type) where.flat_type = p.flat_type.toUpperCase();

        const all = await fetchRows(where, {}, 200000);
        const filtered = filterByMonthAndPrice(all, p);
        const page = filtered.slice(offset, offset + limit);
        return {
          datasetId: hdbResaleEntry.datasetId,
          total: filtered.length,
          returned: page.length,
          offset,
          limit,
          rows: page,
        };
      },
    },
    {
      name: "sg_hdb_resale_stats",
      description:
        "Aggregate HDB resale statistics (count, median, mean, min, max resale " +
        "price) for a filtered slice. Filters: town, flat_type, month range.",
      inputSchema: statsInput,
      handler: async (input: unknown) => {
        const p = statsInput.parse(input);
        const where: Record<string, string | number> = {};
        if (p.town) where.town = p.town.toUpperCase();
        if (p.flat_type) where.flat_type = p.flat_type.toUpperCase();

        const all = await fetchRows(where, {}, 200000);
        const filtered = filterByMonthAndPrice(all, p);
        const prices = filtered
          .map((r) => toNumber(r.resale_price))
          .filter((n): n is number => n != null);
        return {
          datasetId: hdbResaleEntry.datasetId,
          filters: p,
          count: filtered.length,
          median: median(prices),
          mean: mean(prices),
          min: prices.length ? Math.min(...prices) : null,
          max: prices.length ? Math.max(...prices) : null,
        };
      },
    },
  ];
}

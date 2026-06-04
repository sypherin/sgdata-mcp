/**
 * HDB Resale Flat Prices (Jan 2017+).
 *
 * Dataset: d_8b84c4ee58e3cfc0ece0d773c8ca6abc — single CSV, ~232k rows.
 * Columns (raw field ids, via datastore_search): month, town, flat_type,
 * block, street_name, storey_range, floor_area_sqm, flat_model,
 * lease_commence_date, remaining_lease, resale_price.
 *
 * NOTE (2026-06): this module used to call `downloader.ensureFresh()` +
 * full-table `cache.query()`, which ingested the ENTIRE ~23 MB / 232k-row
 * table into local SQLite on every use. We now fetch only the relevant
 * subset from data.gov.sg's server-side `datastore_search` API instead —
 * exact filters (town, flat_type) are pushed server-side; range filters
 * (month_from/to, min/max price) and pagination are applied client-side on
 * the (already-narrowed) fetched subset. We NEVER ingest the full table.
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import { datastoreSearch } from "../core/index.js";
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

/**
 * Hard ceiling on how many rows we will ever pull from datastore_search for a
 * single tool call. data.gov.sg caps a single page at ~10k records, so we
 * page with offset until we either exhaust the server-side-filtered subset or
 * hit this cap. This keeps an unfiltered call from dragging the whole 232k
 * table down — it bounds the fetch instead.
 */
const MAX_FETCH_ROWS = 50000;
/** Per-request page size for datastore_search (server max is ~10k). */
const PAGE_SIZE = 10000;

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
  _cache: DatasetCache,
  _downloader: DatasetDownloader,
): ToolDef[] {
  // cache + downloader are intentionally unused now: this dataset is served
  // entirely via server-side datastore_search, never ingested locally.
  void _cache;
  void _downloader;

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

  /**
   * Fetch the server-side-filtered subset for the given exact filters (town,
   * flat_type) from datastore_search, paging with offset up to `maxRows`.
   *
   * Bounded by design:
   *   - If a narrowing exact filter is supplied (town and/or flat_type), the
   *     server returns only that subset (e.g. town=BEDOK ≈ 12k rows) and we
   *     page through all of it (capped at MAX_FETCH_ROWS).
   *   - If NO exact filter is supplied, we deliberately do NOT pull all 232k
   *     rows: we fetch a single bounded page (most-recent rows aren't
   *     orderable via this legacy endpoint, so it's the dataset's natural
   *     order — `bounded: true` is surfaced so callers know it's a slice).
   *
   * Returns the fetched rows plus a `bounded` flag and the server-reported
   * `total` for the filtered subset.
   */
  async function fetchSubset(
    where: Record<string, string>,
    maxRows: number,
  ): Promise<{ rows: Row[]; total: number; bounded: boolean }> {
    const filters = Object.keys(where).length > 0 ? where : undefined;

    // Probe the subset size first (limit=1 returns the server-side total).
    const probe = await datastoreSearch<Row>(hdbResaleEntry.datasetId, {
      limit: 1,
      filters,
    });
    const total = probe.total;

    // No narrowing filter → grab only a bounded page, never the whole table.
    const targetRows = filters ? Math.min(total, maxRows) : Math.min(PAGE_SIZE, maxRows);

    const rows: Row[] = [];
    let offset = 0;
    while (rows.length < targetRows) {
      const pageLimit = Math.min(PAGE_SIZE, targetRows - rows.length);
      const res = await datastoreSearch<Row>(hdbResaleEntry.datasetId, {
        limit: pageLimit,
        offset,
        filters,
      });
      if (res.records.length === 0) break;
      rows.push(...res.records);
      offset += res.records.length;
      if (res.records.length < pageLimit) break; // exhausted the subset
    }

    // `bounded` = true means rows is a capped slice, not the complete subset.
    const bounded = !filters || total > rows.length;
    return { rows, total, bounded };
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

        // Exact filters pushed server-side via datastore_search.
        const where: Record<string, string> = {};
        if (p.town) where.town = p.town.toUpperCase();
        if (p.flat_type) where.flat_type = p.flat_type.toUpperCase();

        try {
          const { rows, bounded } = await fetchSubset(where, MAX_FETCH_ROWS);
          // Range filters (month/price) + pagination are applied client-side
          // on the already-narrowed subset (datastore_search can't do them).
          const filtered = filterByMonthAndPrice(rows, p);
          const page = filtered.slice(offset, offset + limit);
          return {
            datasetId: hdbResaleEntry.datasetId,
            // `total` reflects rows matching ALL filters within the fetched
            // (bounded) subset. When `bounded` is true it's a lower bound on
            // the true total — the subset was capped to avoid a full ingest.
            total: filtered.length,
            returned: page.length,
            offset,
            limit,
            bounded,
            rows: page,
            source: "datastore_search (server-side; no local ingest)",
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            datasetId: hdbResaleEntry.datasetId,
            error: `datastore_search failed for HDB resale: ${message}`,
          };
        }
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
        const where: Record<string, string> = {};
        if (p.town) where.town = p.town.toUpperCase();
        if (p.flat_type) where.flat_type = p.flat_type.toUpperCase();

        try {
          // Gather the town/flat_type subset server-side (paged with offset,
          // bounded by MAX_FETCH_ROWS) and compute stats over it client-side.
          const { rows, bounded } = await fetchSubset(where, MAX_FETCH_ROWS);
          const filtered = filterByMonthAndPrice(rows, p);
          const prices = filtered
            .map((r) => toNumber(r.resale_price))
            .filter((n): n is number => n != null);
          // Single linear pass for min/max — avoids spreading a huge array into
          // Math.min/Math.max (RangeError on very large slices).
          let minPrice: number | null = null;
          let maxPrice: number | null = null;
          for (const n of prices) {
            if (minPrice === null || n < minPrice) minPrice = n;
            if (maxPrice === null || n > maxPrice) maxPrice = n;
          }
          return {
            datasetId: hdbResaleEntry.datasetId,
            filters: p,
            // `count` is over the fetched subset; `bounded: true` means the
            // subset was capped (stats are computed on that bounded slice).
            count: filtered.length,
            bounded,
            median: median(prices),
            mean: mean(prices),
            min: minPrice,
            max: maxPrice,
            source: "datastore_search (server-side; no local ingest)",
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            datasetId: hdbResaleEntry.datasetId,
            error: `datastore_search failed for HDB resale stats: ${message}`,
          };
        }
      },
    },
  ];
}

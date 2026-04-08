/**
 * COE Bidding Results / Prices.
 *
 * Dataset: d_69b3380ad7e51aff3a7dcc84eba52b8a — ~2,500 rows.
 * Columns: month, bidding_no, vehicle_class, quota, bids_success,
 * bids_received, premium.
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const coeBiddingEntry: DatasetEntry = {
  id: "coe_bidding",
  datasetId: "d_69b3380ad7e51aff3a7dcc84eba52b8a",
  shardCollection: false,
  name: "COE Bidding Results",
  description:
    "LTA Certificate of Entitlement bidding results by vehicle category, " +
    "refreshed after each bidding exercise (twice a month).",
  agency: "LTA",
  refreshDays: 7,
  tags: ["transport", "coe", "lta", "vehicles"],
};

type Row = Record<string, string | null>;

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse month + bidding_no into a sortable key so we can identify the
 * "most recent" exercise cleanly. month is YYYY-MM, bidding_no is 1 or 2.
 */
function exerciseKey(r: Row): string {
  const m = (r.month as string | null) ?? "";
  const b = (r.bidding_no as string | null) ?? "0";
  return `${m}-${b.padStart(2, "0")}`;
}

export function createCoeBiddingTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  const latestInput = z.object({
    vehicle_class: z.string().optional(),
  });

  const historyInput = z.object({
    vehicle_class: z.string(),
    months_back: z.number().int().positive().max(240).optional(),
  });

  const demandInput = z.object({
    vehicle_class: z.string(),
    months_back: z.number().int().positive().max(240).optional(),
  });

  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(coeBiddingEntry);
    return cache.query<Row>(coeBiddingEntry.datasetId, { limit: 100000 });
  }

  return [
    {
      name: "sg_coe_latest",
      description:
        "Get the most recent COE bidding result per vehicle category. If " +
        "vehicle_class is supplied (e.g. 'Category A'), returns just that " +
        "one; otherwise returns the latest exercise across all categories.",
      inputSchema: latestInput,
      handler: async (input: unknown) => {
        const p = latestInput.parse(input);
        const rows = await fetchAll();
        const byCategory = new Map<string, Row>();
        for (const r of rows) {
          const cat = (r.vehicle_class as string | null) ?? "";
          if (p.vehicle_class && cat !== p.vehicle_class) continue;
          const prev = byCategory.get(cat);
          if (!prev || exerciseKey(r) > exerciseKey(prev)) {
            byCategory.set(cat, r);
          }
        }
        const latest = Array.from(byCategory.values()).sort((a, b) =>
          ((a.vehicle_class as string) ?? "").localeCompare(
            (b.vehicle_class as string) ?? "",
          ),
        );
        return {
          datasetId: coeBiddingEntry.datasetId,
          count: latest.length,
          latest,
        };
      },
    },
    {
      name: "sg_coe_history",
      description:
        "COE premium time series for a single vehicle category. " +
        "Returns bidding exercises in chronological order (oldest first), " +
        "optionally trimmed to the last N months.",
      inputSchema: historyInput,
      handler: async (input: unknown) => {
        const p = historyInput.parse(input);
        const rows = (await fetchAll()).filter(
          (r) => (r.vehicle_class as string | null) === p.vehicle_class,
        );
        rows.sort((a, b) => exerciseKey(a).localeCompare(exerciseKey(b)));
        const trimmed = p.months_back
          ? rows.slice(-p.months_back * 2)
          : rows;
        return {
          datasetId: coeBiddingEntry.datasetId,
          vehicle_class: p.vehicle_class,
          count: trimmed.length,
          rows: trimmed,
        };
      },
    },
    {
      name: "sg_coe_demand_supply",
      description:
        "COE oversubscription ratio (bids_received / quota) for a single " +
        "vehicle category over the last N months. Values > 1.0 indicate " +
        "bids exceeded quota.",
      inputSchema: demandInput,
      handler: async (input: unknown) => {
        const p = demandInput.parse(input);
        const rows = (await fetchAll()).filter(
          (r) => (r.vehicle_class as string | null) === p.vehicle_class,
        );
        rows.sort((a, b) => exerciseKey(a).localeCompare(exerciseKey(b)));
        const trimmed = p.months_back
          ? rows.slice(-p.months_back * 2)
          : rows;
        const series = trimmed.map((r) => {
          const q = toNumber(r.quota) ?? 0;
          const br = toNumber(r.bids_received) ?? 0;
          return {
            month: r.month,
            bidding_no: r.bidding_no,
            quota: q,
            bids_received: br,
            ratio: q > 0 ? br / q : null,
          };
        });
        return {
          datasetId: coeBiddingEntry.datasetId,
          vehicle_class: p.vehicle_class,
          count: series.length,
          series,
        };
      },
    },
  ];
}

/**
 * List of Government Markets & Hawker Centres.
 *
 * Dataset: d_68a42f09f350881996d83f9cd73ab02f
 * Columns: name_of_centre, location_of_centre, type_of_centre, owner,
 * no_of_stalls, no_of_cooked_food_stalls, no_of_mkt_produce_stalls.
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const hawkerCentresEntry: DatasetEntry = {
  id: "hawker_centres",
  datasetId: "d_68a42f09f350881996d83f9cd73ab02f",
  shardCollection: false,
  name: "List of Government Markets & Hawker Centres",
  description:
    "NEA list of all government markets and hawker centres, including " +
    "stall counts by type (cooked food, market produce).",
  agency: "NEA",
  refreshDays: 90,
  tags: ["food", "hawker", "nea", "infrastructure"],
};

type Row = Record<string, string | null>;

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export function createHawkerCentresTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(hawkerCentresEntry);
    return cache.query<Row>(hawkerCentresEntry.datasetId, { limit: 100000 });
  }

  return [
    {
      name: "sg_hawker_search",
      description:
        "Search for hawker centres by name or location (substring match). " +
        "Returns name, location, type, stall counts.",
      inputSchema: z.object({
        query: z.string().optional(),
        type: z
          .enum(["Market", "Hawker Centre", "Market/Hawker Centre"])
          .optional(),
      }),
      handler: async (input: unknown) => {
        const p = z
          .object({
            query: z.string().optional(),
            type: z
              .enum(["Market", "Hawker Centre", "Market/Hawker Centre"])
              .optional(),
          })
          .parse(input);
        let rows = await fetchAll();
        if (p.query) {
          const q = p.query.toLowerCase();
          rows = rows.filter(
            (r) =>
              (r.name_of_centre ?? "").toLowerCase().includes(q) ||
              (r.location_of_centre ?? "").toLowerCase().includes(q),
          );
        }
        if (p.type) {
          rows = rows.filter(
            (r) =>
              (r.type_of_centre ?? "").toLowerCase() ===
              p.type!.toLowerCase(),
          );
        }
        return {
          datasetId: hawkerCentresEntry.datasetId,
          count: rows.length,
          centres: rows.map((r) => ({
            name: r.name_of_centre,
            location: r.location_of_centre,
            type: r.type_of_centre,
            owner: r.owner,
            total_stalls: toNum(r.no_of_stalls),
            cooked_food_stalls: toNum(r.no_of_cooked_food_stalls),
            market_produce_stalls: toNum(r.no_of_mkt_produce_stalls),
          })),
        };
      },
    },
    {
      name: "sg_hawker_stats",
      description:
        "Summary statistics of all hawker centres — total count, " +
        "breakdown by type, total stalls nationwide.",
      inputSchema: z.object({}),
      handler: async () => {
        const rows = await fetchAll();
        const byType = new Map<string, number>();
        let totalStalls = 0;
        let cookedFood = 0;
        let marketProduce = 0;
        for (const r of rows) {
          const t = (r.type_of_centre ?? "Other").trim();
          byType.set(t, (byType.get(t) ?? 0) + 1);
          totalStalls += toNum(r.no_of_stalls) ?? 0;
          cookedFood += toNum(r.no_of_cooked_food_stalls) ?? 0;
          marketProduce += toNum(r.no_of_mkt_produce_stalls) ?? 0;
        }
        return {
          datasetId: hawkerCentresEntry.datasetId,
          total_centres: rows.length,
          by_type: Object.fromEntries(byType),
          total_stalls: totalStalls,
          cooked_food_stalls: cookedFood,
          market_produce_stalls: marketProduce,
        };
      },
    },
  ];
}

/**
 * HDB Carpark Information (static metadata).
 *
 * Dataset: d_23f946fa557947f93a8043bbef41dd09 — ~2,200 carparks.
 * Columns: car_park_no, address, x_coord, y_coord, car_park_type,
 * type_of_parking_system, short_term_parking, free_parking, night_parking,
 * car_park_decks, gantry_height, car_park_basement.
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const hdbCarparksEntry: DatasetEntry = {
  id: "hdb_carparks",
  datasetId: "d_23f946fa557947f93a8043bbef41dd09",
  shardCollection: false,
  name: "HDB Carpark Information",
  description:
    "Static reference table of HDB carparks (location, type, parking system, " +
    "decks, gantry height). Not the real-time availability feed.",
  agency: "HDB",
  refreshDays: 30,
  tags: ["transport", "carpark", "hdb", "reference"],
};

type Row = Record<string, string | null>;

function isYes(v: unknown): boolean {
  if (v == null) return false;
  const s = String(v).trim().toUpperCase();
  return s === "YES" || s === "Y";
}

export function createHdbCarparksTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  const lookupInput = z.object({
    car_park_no: z.string().min(1),
  });

  const addressInput = z.object({
    query: z.string().min(1),
    limit: z.number().int().positive().max(500).optional(),
  });

  const byTypeInput = z.object({
    car_park_type: z.string().optional(),
    has_night_parking: z.boolean().optional(),
    free_parking: z.string().optional(),
    limit: z.number().int().positive().max(500).optional(),
    offset: z.number().int().nonnegative().optional(),
  });

  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(hdbCarparksEntry);
    return cache.query<Row>(hdbCarparksEntry.datasetId, { limit: 20000 });
  }

  return [
    {
      name: "sg_hdb_carpark_lookup",
      description:
        "Exact-match lookup for a single HDB carpark by car_park_no " +
        "(e.g. 'BJ55', 'ACB'). Returns all reference columns for that carpark.",
      inputSchema: lookupInput,
      handler: async (input: unknown) => {
        const p = lookupInput.parse(input);
        const all = await fetchAll();
        const needle = p.car_park_no.toUpperCase();
        const hit = all.find(
          (r) => ((r.car_park_no as string | null) ?? "").toUpperCase() === needle,
        );
        return {
          datasetId: hdbCarparksEntry.datasetId,
          car_park_no: p.car_park_no,
          carpark: hit ?? null,
        };
      },
    },
    {
      name: "sg_hdb_carparks_by_address",
      description:
        "Substring search over HDB carpark addresses. Useful for 'find all " +
        "carparks in Tampines' or 'carparks on Ang Mo Kio Ave 3'.",
      inputSchema: addressInput,
      handler: async (input: unknown) => {
        const p = addressInput.parse(input);
        const limit = p.limit ?? 50;
        const needle = p.query.toUpperCase();
        const all = await fetchAll();
        const matches = all.filter((r) =>
          ((r.address as string | null) ?? "").toUpperCase().includes(needle),
        );
        return {
          datasetId: hdbCarparksEntry.datasetId,
          query: p.query,
          total: matches.length,
          rows: matches.slice(0, limit),
        };
      },
    },
    {
      name: "sg_hdb_carparks_by_type",
      description:
        "Filter HDB carparks by type (e.g. 'MULTI-STOREY CAR PARK', " +
        "'SURFACE CAR PARK'), night_parking availability, or free_parking " +
        "text (e.g. 'SUN & PH FR 7AM-10.30PM').",
      inputSchema: byTypeInput,
      handler: async (input: unknown) => {
        const p = byTypeInput.parse(input);
        const limit = p.limit ?? 50;
        const offset = p.offset ?? 0;
        const all = await fetchAll();
        const typeNeedle = p.car_park_type?.toUpperCase();
        const freeNeedle = p.free_parking?.toUpperCase();
        const filtered = all.filter((r) => {
          if (
            typeNeedle &&
            ((r.car_park_type as string | null) ?? "").toUpperCase() !== typeNeedle
          ) {
            return false;
          }
          if (p.has_night_parking != null) {
            if (isYes(r.night_parking) !== p.has_night_parking) return false;
          }
          if (
            freeNeedle &&
            !((r.free_parking as string | null) ?? "")
              .toUpperCase()
              .includes(freeNeedle)
          ) {
            return false;
          }
          return true;
        });
        return {
          datasetId: hdbCarparksEntry.datasetId,
          total: filtered.length,
          returned: Math.min(limit, Math.max(0, filtered.length - offset)),
          offset,
          limit,
          rows: filtered.slice(offset, offset + limit),
        };
      },
    },
  ];
}

/**
 * MOE General Information of Schools.
 *
 * Dataset: d_688b934f82c1059ed0a6993d2a829089 — ~350 rows.
 * Columns: school_name, address, postal_code, telephone_no, email_address,
 * mrt_desc, bus_desc, principal_name, dgp_code, zone_code, type_code,
 * nature_code, session_code, mainlevel_code, sap_ind, gifted_ind.
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const moeSchoolsEntry: DatasetEntry = {
  id: "moe_schools",
  datasetId: "d_688b934f82c1059ed0a6993d2a829089",
  collectionId: "457",
  shardCollection: false,
  name: "MOE General Information of Schools",
  description:
    "Directory of MOE-registered primary, secondary, and pre-university " +
    "schools in Singapore with address, zone, and programme indicators.",
  agency: "MOE",
  refreshDays: 90,
  tags: ["education", "moe", "schools", "directory"],
};

type Row = Record<string, string | null>;

function isYes(v: unknown): boolean {
  if (v == null) return false;
  return String(v).trim().toUpperCase() === "YES";
}

export function createMoeSchoolsTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  const searchInput = z.object({
    query: z.string().optional(),
    level: z.string().optional(),
    zone: z.string().optional(),
    sap: z.boolean().optional(),
    gifted: z.boolean().optional(),
    limit: z.number().int().positive().max(500).optional(),
    offset: z.number().int().nonnegative().optional(),
  });

  const byNameInput = z.object({
    name: z.string().min(1),
  });

  const nearInput = z.object({
    postal_code: z.string().min(2),
    prefix_length: z.number().int().min(1).max(6).optional(),
  });

  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(moeSchoolsEntry);
    return cache.query<Row>(moeSchoolsEntry.datasetId, { limit: 10000 });
  }

  return [
    {
      name: "sg_moe_search_schools",
      description:
        "Search MOE-registered schools by name substring, mainlevel " +
        "(PRIMARY/SECONDARY/MIXED LEVELS/JUNIOR COLLEGE/CENTRALISED INSTITUTE), " +
        "zone (NORTH/SOUTH/EAST/WEST), SAP status, and Gifted Education " +
        "Programme status.",
      inputSchema: searchInput,
      handler: async (input: unknown) => {
        const p = searchInput.parse(input);
        const limit = p.limit ?? 50;
        const offset = p.offset ?? 0;
        const all = await fetchAll();

        const q = p.query?.toLowerCase();
        const level = p.level?.toUpperCase();
        const zone = p.zone?.toUpperCase();

        const filtered = all.filter((r) => {
          if (
            q &&
            !((r.school_name as string | null) ?? "")
              .toLowerCase()
              .includes(q)
          ) {
            return false;
          }
          if (
            level &&
            ((r.mainlevel_code as string | null) ?? "").toUpperCase() !== level
          ) {
            return false;
          }
          if (
            zone &&
            ((r.zone_code as string | null) ?? "").toUpperCase() !== zone
          ) {
            return false;
          }
          if (p.sap != null && isYes(r.sap_ind) !== p.sap) return false;
          if (p.gifted != null && isYes(r.gifted_ind) !== p.gifted) return false;
          return true;
        });

        return {
          datasetId: moeSchoolsEntry.datasetId,
          total: filtered.length,
          returned: Math.min(limit, Math.max(0, filtered.length - offset)),
          offset,
          limit,
          rows: filtered.slice(offset, offset + limit),
        };
      },
    },
    {
      name: "sg_moe_school_by_name",
      description:
        "Exact-match lookup for a single MOE school by full school_name. " +
        "Falls back to the closest substring match if no exact hit.",
      inputSchema: byNameInput,
      handler: async (input: unknown) => {
        const p = byNameInput.parse(input);
        const all = await fetchAll();
        const needle = p.name.toUpperCase();
        const exact = all.find(
          (r) => ((r.school_name as string | null) ?? "").toUpperCase() === needle,
        );
        if (exact) return { datasetId: moeSchoolsEntry.datasetId, match: "exact", school: exact };
        const substring = all.find((r) =>
          ((r.school_name as string | null) ?? "").toUpperCase().includes(needle),
        );
        return {
          datasetId: moeSchoolsEntry.datasetId,
          match: substring ? "substring" : "none",
          school: substring ?? null,
        };
      },
    },
    {
      name: "sg_moe_schools_near",
      description:
        "Find schools whose postal_code shares a prefix with the supplied " +
        "postal_code. Default prefix length is 2 (Singapore postal sector). " +
        "Not a true geographic radius — use this as a cheap proximity proxy.",
      inputSchema: nearInput,
      handler: async (input: unknown) => {
        const p = nearInput.parse(input);
        const prefixLen = p.prefix_length ?? 2;
        const prefix = p.postal_code.slice(0, prefixLen);
        const all = await fetchAll();
        const matches = all.filter((r) =>
          ((r.postal_code as string | null) ?? "").startsWith(prefix),
        );
        return {
          datasetId: moeSchoolsEntry.datasetId,
          postal_code: p.postal_code,
          prefix,
          count: matches.length,
          rows: matches,
        };
      },
    },
  ];
}

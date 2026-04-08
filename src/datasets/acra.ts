/**
 * ACRA Information on Corporate Entities — sharded collection handler.
 *
 * ACRA's corporate entity registry is published on data.gov.sg as collection
 * id `2`, split across 27 CSV shards (one per first-letter-of-entity-name
 * plus an "others" bucket). Each shard is ~18 MB, total ~480 MB, ~2.0M rows.
 *
 * This module exposes the collection as a single logical dataset
 * (`acra_entities`) plus three curated tools that fan out across all shards
 * via the shared DatasetCache + DatasetDownloader.
 *
 * Contract notes:
 *   - `DatasetDownloader.ensureFresh()` only accepts a `DatasetEntry`, not a
 *     bare shard id, so we build synthetic per-shard entries on the fly. We
 *     deliberately mark them `shardCollection: false` so the downloader
 *     treats them as single-dataset refreshes.
 *   - `DatasetCache.query()` takes `{ where, like, limit, offset }` — it is
 *     SQLite-backed and all columns are stored as TEXT, so we do string
 *     comparison for dates and coerce counts manually.
 *   - First-letter → shard mapping is not documented for most of the 27
 *     shards (only A, W, Z, X, M, K, R, G are explicitly tagged in
 *     docs/datasets.md), so any single-UEN lookup has to fan out across
 *     every shard. See TODO near `sg_acra_get_entity` for a future
 *     optimization (a UEN → shard index in the cache layer).
 */

import { z } from "zod";

import {
  type DatasetCache,
  type DatasetDownloader,
  type DatasetEntry,
} from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

// ---------------------------------------------------------------------------
// Shard constants
// ---------------------------------------------------------------------------

/**
 * All 27 ACRA shard dataset IDs, transcribed from docs/datasets.md.
 * The `letter` annotation reflects whatever the docs explicitly tag; for
 * shards the docs don't tag we use `?` (unknown first letter).
 */
export interface AcraShard {
  datasetId: string;
  letter: string; // single uppercase letter, or "?" if unknown
}

export const ACRA_SHARDS: readonly AcraShard[] = [
  { datasetId: "d_8575e84912df3c28995b8e6e0e05205a", letter: "A" },
  { datasetId: "d_af2042c77ffaf0db5d75561ce9ef5688", letter: "W" },
  { datasetId: "d_0cc5f52a1f298b916f317800251057f3", letter: "?" },
  { datasetId: "d_4e3db8955fdcda6f9944097bef3d2724", letter: "Z" },
  { datasetId: "d_1cd970d8351b42be4a308d628a6dd9d3", letter: "X" },
  { datasetId: "d_e97e8e7fc55b85a38babf66b0fa46b73", letter: "?" },
  { datasetId: "d_df7d2d661c0c11a7c367c9ee4bf896c1", letter: "?" },
  { datasetId: "d_fa2ed456cf2b8597bb7e064b08fc3c7c", letter: "?" },
  { datasetId: "d_300ddc8da4e8f7bdc1bfc62d0d99e2e7", letter: "?" },
  { datasetId: "d_31af23fdb79119ed185c256f03cb5773", letter: "?" },
  { datasetId: "d_67e99e6eabc4aad9b5d48663b579746a", letter: "?" },
  { datasetId: "d_c0650f23e94c42e7a20921f4c5b75c24", letter: "?" },
  { datasetId: "d_3a3807c023c61ddfba947dc069eb53f2", letter: "?" },
  { datasetId: "d_478f45a9c541cbe679ca55d1cd2b970b", letter: "?" },
  { datasetId: "d_a2141adf93ec2a3c2ec2837b78d6d46e", letter: "?" },
  { datasetId: "d_181005ca270b45408b4cdfc954980ca2", letter: "?" },
  { datasetId: "d_9af9317c646a1c881bb5591c91817cc6", letter: "M" },
  { datasetId: "d_5c4ef48b025fdfbc80056401f06e3df9", letter: "?" },
  { datasetId: "d_5573b0db0575db32190a2ad27919a7aa", letter: "K" },
  { datasetId: "d_2b8c54b2a490d2fa36b925289e5d9572", letter: "R" },
  { datasetId: "d_85518d970b8178975850457f60f1e738", letter: "?" },
  { datasetId: "d_72f37e5c5d192951ddc5513c2b134482", letter: "?" },
  { datasetId: "d_4526d47d6714d3b052eed4a30b8b1ed6", letter: "?" },
  { datasetId: "d_b58303c68e9cf0d2ae93b73ffdbfbfa1", letter: "G" },
  { datasetId: "d_acbc938ec77af18f94cecc4a7c9ec720", letter: "?" },
  { datasetId: "d_4130f1d9d365d9f1633536e959f62bb7", letter: "?" },
  { datasetId: "d_124a9bd407c7a25f8335b93b86e50fdd", letter: "?" },
];

/** First (A-shard) used as the representative datasetId on the registry entry. */
const ACRA_REPRESENTATIVE_DATASET_ID = ACRA_SHARDS[0]!.datasetId;

/** Small concurrency limit so we don't hammer data.gov.sg. */
const ACRA_FETCH_CONCURRENCY = 3;

// ---------------------------------------------------------------------------
// Registry entries
// ---------------------------------------------------------------------------

export const acraEntries: DatasetEntry[] = [
  {
    id: "acra_entities",
    datasetId: ACRA_REPRESENTATIVE_DATASET_ID,
    collectionId: "2",
    shardCollection: true,
    name: "ACRA Information on Corporate Entities",
    description:
      "Full ACRA corporate entity registry: ~2M+ live and historical " +
      "business entities across 27 alphabetic shards. Includes UEN, entity " +
      "name, type, status, incorporation date, primary/secondary SSIC, " +
      "and registered address.",
    agency: "ACRA",
    refreshDays: 30,
    tags: ["companies", "registry", "acra", "corporate", "ssic", "uen"],
  },
];

// ---------------------------------------------------------------------------
// Sharding helpers
// ---------------------------------------------------------------------------

/** Build a synthetic single-dataset entry so the downloader can refresh one shard. */
function shardEntry(shardId: string): DatasetEntry {
  return {
    id: `acra_entities__shard_${shardId}`,
    datasetId: shardId,
    shardCollection: false,
    name: `ACRA shard ${shardId}`,
    description: "Synthetic per-shard entry used for ad-hoc refreshes.",
    agency: "ACRA",
    refreshDays: 30,
    tags: ["acra", "shard"],
  };
}

/**
 * Ensure every ACRA shard is downloaded + fresh. Runs with a tiny
 * concurrency limit so we don't hammer data.gov.sg. Safe to call on
 * every tool invocation — the downloader's TTL check short-circuits
 * hot shards cheaply.
 */
export async function ensureAllAcraShardsFresh(
  downloader: DatasetDownloader,
  log: (m: string) => void = () => {},
): Promise<void> {
  const queue = ACRA_SHARDS.map((s) => s.datasetId);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      const idx = cursor++;
      const shardId = queue[idx]!;
      try {
        await downloader.ensureFresh(shardEntry(shardId), log);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`[acra shard ${shardId}] refresh failed: ${msg}`);
      }
    }
  }

  const workers: Promise<void>[] = [];
  const n = Math.min(ACRA_FETCH_CONCURRENCY, queue.length);
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);
}

export interface QueryAllShardsOpts {
  where?: Record<string, string | number>;
  like?: Record<string, string>;
  /** Optional per-shard scan cap (pre-union). Defaults to 5000. */
  perShardLimit?: number;
}

/**
 * Run the same filter against every ACRA shard and union the rows. Caller
 * is responsible for any post-union sort + pagination — we return the raw
 * concatenated rows so count-style tools can avoid copying twice.
 */
export function queryAllAcraShards(
  cache: DatasetCache,
  opts: QueryAllShardsOpts = {},
): Array<Record<string, unknown>> {
  const { where, like, perShardLimit = 5000 } = opts;
  const all: Array<Record<string, unknown>> = [];
  for (const shard of ACRA_SHARDS) {
    const queryOpts: {
      where?: Record<string, string | number>;
      like?: Record<string, string>;
      limit: number;
    } = { limit: perShardLimit };
    if (where) queryOpts.where = where;
    if (like) queryOpts.like = like;
    const rows = cache.query<Record<string, unknown>>(shard.datasetId, queryOpts);
    for (const r of rows) all.push(r);
  }
  return all;
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

/**
 * Pull a column value regardless of whether ingestion stored it under the
 * raw header or a sanitized/labeled variant. Handles both snake_case and
 * human-label fall-back.
 */
function pick(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).length > 0) return String(v);
  }
  return undefined;
}

function entityName(row: Record<string, unknown>): string {
  return pick(row, "entity_name", "entityName") ?? "";
}

function uen(row: Record<string, unknown>): string {
  return pick(row, "uen", "UEN") ?? "";
}

function primarySsic(row: Record<string, unknown>): string {
  return pick(row, "primary_ssic_code", "primarySsicCode") ?? "";
}

function entityStatus(row: Record<string, unknown>): string {
  return (
    pick(row, "entity_status_description", "entityStatusDescription") ?? ""
  );
}

function incorporationDate(row: Record<string, unknown>): string {
  return (
    pick(
      row,
      "registration_incorporation_date",
      "registrationIncorporationDate",
    ) ?? ""
  );
}

function postalCode(row: Record<string, unknown>): string {
  return pick(row, "postal_code", "postalCode") ?? "";
}

// ---------------------------------------------------------------------------
// Tool 1: sg_acra_search_entities
// ---------------------------------------------------------------------------

const AcraSearchInput = z.object({
  query: z.string().min(1).optional(),
  ssic_prefix: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  incorporated_after: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, "YYYY-MM-DD")
    .optional(),
  incorporated_before: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, "YYYY-MM-DD")
    .optional(),
  postal_code_prefix: z.string().min(1).optional(),
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
});

type AcraSearchInput = z.infer<typeof AcraSearchInput>;

interface AcraSearchOutput {
  total: number;
  returned: number;
  offset: number;
  limit: number;
  rows: Array<Record<string, unknown>>;
}

async function handleAcraSearch(
  cache: DatasetCache,
  downloader: DatasetDownloader,
  rawInput: unknown,
): Promise<AcraSearchOutput> {
  const input = AcraSearchInput.parse(rawInput);
  const limit = input.limit ?? 50;
  const offset = input.offset ?? 0;

  await ensureAllAcraShardsFresh(downloader);

  // Push whatever we can down into SQLite via cache.query. Status is an
  // exact match; the rest are LIKE filters against TEXT columns.
  const where: Record<string, string | number> = {};
  const like: Record<string, string> = {};

  if (input.status) where["entity_status_description"] = input.status;
  if (input.query) like["entity_name"] = `%${input.query}%`;
  if (input.ssic_prefix) like["primary_ssic_code"] = `${input.ssic_prefix}%`;
  if (input.postal_code_prefix) {
    like["postal_code"] = `${input.postal_code_prefix}%`;
  }

  const unioned = queryAllAcraShards(cache, {
    where: Object.keys(where).length > 0 ? where : undefined,
    like: Object.keys(like).length > 0 ? like : undefined,
    perShardLimit: 5000,
  });

  // Date filters have to happen in JS — the column is TEXT but stored as
  // ISO-ish "YYYY-MM-DD" so lexicographic compare works.
  const after = input.incorporated_after;
  const before = input.incorporated_before;
  const dateFiltered = unioned.filter((row) => {
    if (!after && !before) return true;
    const d = incorporationDate(row);
    if (!d) return false;
    if (after && d < after) return false;
    if (before && d > before) return false;
    return true;
  });

  // Sort by entity_name for stable pagination across shards.
  dateFiltered.sort((a, b) => entityName(a).localeCompare(entityName(b)));

  const total = dateFiltered.length;
  const page = dateFiltered.slice(offset, offset + limit);

  return {
    total,
    returned: page.length,
    offset,
    limit,
    rows: page,
  };
}

// ---------------------------------------------------------------------------
// Tool 2: sg_acra_get_entity
// ---------------------------------------------------------------------------

const AcraGetEntityInput = z.object({
  uen: z.string().min(1, "uen is required"),
});

type AcraGetEntityInput = z.infer<typeof AcraGetEntityInput>;

interface AcraGetEntityOutput {
  found: boolean;
  uen: string;
  entity?: Record<string, unknown>;
  shardDatasetId?: string;
}

async function handleAcraGetEntity(
  cache: DatasetCache,
  downloader: DatasetDownloader,
  rawInput: unknown,
): Promise<AcraGetEntityOutput> {
  const { uen: targetUen } = AcraGetEntityInput.parse(rawInput);

  // TODO(perf): build a UEN → shard index in the cache layer so we can
  // skip 26 of the 27 shards on single-entity lookups. Today we fan out
  // across all shards because we don't know an entity's first-letter
  // from its UEN alone.
  await ensureAllAcraShardsFresh(downloader);

  for (const shard of ACRA_SHARDS) {
    const rows = cache.query<Record<string, unknown>>(shard.datasetId, {
      where: { uen: targetUen },
      limit: 1,
    });
    if (rows.length > 0) {
      return {
        found: true,
        uen: targetUen,
        entity: rows[0]!,
        shardDatasetId: shard.datasetId,
      };
    }
  }

  return { found: false, uen: targetUen };
}

// ---------------------------------------------------------------------------
// Tool 3: sg_acra_formations_by_ssic
// ---------------------------------------------------------------------------

const AcraFormationsInput = z.object({
  ssic_prefix: z.string().min(1, "ssic_prefix is required (e.g. '62')"),
  year: z
    .number()
    .int()
    .gte(1900)
    .lte(2100)
    .or(z.string().regex(/^\d{4}$/u).transform((s) => Number.parseInt(s, 10))),
});

type AcraFormationsInput = z.infer<typeof AcraFormationsInput>;

interface AcraFormationsOutput {
  ssic_prefix: string;
  year: number;
  count: number;
  sample: Array<{
    uen: string;
    entity_name: string;
    primary_ssic_code: string;
    registration_incorporation_date: string;
    entity_status_description: string;
  }>;
}

async function handleAcraFormations(
  cache: DatasetCache,
  downloader: DatasetDownloader,
  rawInput: unknown,
): Promise<AcraFormationsOutput> {
  const input = AcraFormationsInput.parse(rawInput);
  const yearNum = typeof input.year === "number" ? input.year : Number(input.year);
  const yearStr = String(yearNum);

  await ensureAllAcraShardsFresh(downloader);

  // Filter at the SQL layer where possible: SSIC prefix via LIKE, year via
  // LIKE on the date string ("YYYY-..."). Sharp enough that per-shard row
  // counts stay bounded.
  const unioned = queryAllAcraShards(cache, {
    like: {
      primary_ssic_code: `${input.ssic_prefix}%`,
      registration_incorporation_date: `${yearStr}-%`,
    },
    perShardLimit: 20000,
  });

  // Belt-and-braces JS filter in case the cache column got sanitized to a
  // slightly different key and the LIKE didn't match.
  const matches = unioned.filter((row) => {
    const ssic = primarySsic(row);
    const date = incorporationDate(row);
    return ssic.startsWith(input.ssic_prefix) && date.startsWith(`${yearStr}-`);
  });

  matches.sort((a, b) =>
    incorporationDate(a).localeCompare(incorporationDate(b)),
  );

  const sample = matches.slice(0, 25).map((row) => ({
    uen: uen(row),
    entity_name: entityName(row),
    primary_ssic_code: primarySsic(row),
    registration_incorporation_date: incorporationDate(row),
    entity_status_description: entityStatus(row),
  }));

  // silence unused warning for postalCode helper (kept for future filters)
  void postalCode;

  return {
    ssic_prefix: input.ssic_prefix,
    year: yearNum,
    count: matches.length,
    sample,
  };
}

// ---------------------------------------------------------------------------
// Factory — the server entrypoint calls this with live cache + downloader.
// ---------------------------------------------------------------------------

export function createAcraTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  return [
    {
      name: "sg_acra_search_entities",
      description:
        "Search the full ACRA corporate registry across all 27 alphabetic " +
        "shards. Filters: free-text substring on entity_name (`query`), " +
        "SSIC prefix (`ssic_prefix`, e.g. '62' for IT), exact entity status " +
        "(`status`, e.g. 'Live Company'), incorporation date window " +
        "(`incorporated_after` / `incorporated_before`, YYYY-MM-DD), and " +
        "postal code prefix (`postal_code_prefix`). Results are unioned " +
        "across shards, sorted by entity_name, and paginated via limit/offset.",
      inputSchema: AcraSearchInput,
      handler: (input: unknown) => handleAcraSearch(cache, downloader, input),
    },
    {
      name: "sg_acra_get_entity",
      description:
        "Look up a single ACRA corporate entity by exact UEN. Fans out " +
        "across all 27 shards because UEN → shard mapping is not known " +
        "upfront (future optimization: cache a UEN index). Returns the " +
        "full row including entity name, type, status, SSIC, and address, " +
        "or `found: false` if no match.",
      inputSchema: AcraGetEntityInput,
      handler: (input: unknown) =>
        handleAcraGetEntity(cache, downloader, input),
    },
    {
      name: "sg_acra_formations_by_ssic",
      description:
        "Count ACRA corporate entity formations for a given SSIC prefix " +
        "and calendar year. Useful for macro questions like 'how many " +
        "fintech (SSIC 64) companies were incorporated in 2025'. Returns " +
        "the match count plus a 25-row sample sorted by incorporation date.",
      inputSchema: AcraFormationsInput,
      handler: (input: unknown) =>
        handleAcraFormations(cache, downloader, input),
    },
  ];
}

/**
 * Metadata-only tool descriptor list. The handlers on these entries throw
 * on invocation — the server entrypoint MUST call `createAcraTools(cache,
 * downloader)` with live dependencies to get a working tool list. This
 * static export exists so a registry/tool-catalog layer can introspect
 * tool names, descriptions, and input schemas without booting core.
 */
export const acraTools: ToolDef[] = [
  {
    name: "sg_acra_search_entities",
    description:
      "Search the full ACRA corporate registry across all 27 alphabetic " +
      "shards (entity name substring, SSIC prefix, status, incorporation " +
      "date window, postal code prefix).",
    inputSchema: AcraSearchInput,
    handler: notWired("sg_acra_search_entities"),
  },
  {
    name: "sg_acra_get_entity",
    description:
      "Look up a single ACRA corporate entity by exact UEN. Fans out " +
      "across all 27 shards.",
    inputSchema: AcraGetEntityInput,
    handler: notWired("sg_acra_get_entity"),
  },
  {
    name: "sg_acra_formations_by_ssic",
    description:
      "Count ACRA corporate entity formations for a given SSIC prefix and " +
      "calendar year.",
    inputSchema: AcraFormationsInput,
    handler: notWired("sg_acra_formations_by_ssic"),
  },
];

function notWired(name: string): (input: unknown) => Promise<never> {
  return () => {
    throw new Error(
      `${name} is not wired — call createAcraTools(cache, downloader) ` +
        `from the server entrypoint and register the returned ToolDef[] ` +
        `instead of the static acraTools export.`,
    );
  };
}

/**
 * ACRA Information on Corporate Entities — server-side (datastore_search) handler.
 *
 * ACRA's corporate entity registry is published on data.gov.sg as collection
 * id `2`, split across 27 CSV shards (one per first-letter-of-entity-name
 * plus an "others" bucket). Each shard is ~18 MB, total ~480 MB, ~2.0M rows.
 *
 * This module exposes the collection as a single logical dataset
 * (`acra_entities`) plus three curated tools.
 *
 * BACKEND (2026-06 rewrite): all three tools now fetch ONLY the relevant
 * bounded subset from data.gov.sg's server-side `datastore_search` API. They
 * NO LONGER call `downloader.ensureFresh()` + full-table `cache.query()` (which
 * used to ingest the whole ~56 MB / 172k-row curated dataset — or, across all
 * 27 shards, ~480 MB — into local SQLite on every use). The `cache` /
 * `downloader` deps are kept in the factory signature for interface
 * compatibility but are intentionally unused.
 *
 *   - `sg_acra_get_entity` (by UEN)  → exact `filters={uen}` lookup (1 row max
 *     per shard) FANNED OUT across all 27 shards with bounded concurrency,
 *     early-stop on first hit (UEN is unique). A UEN can begin with any letter,
 *     so a single-shard lookup misses ~26/27 of the registry.
 *   - `sg_acra_search_entities`      → `q` (name) + `filters` (status) pushed
 *     server-side, FANNED OUT across all 27 shards (entities are sharded by
 *     first-letter-of-name); ssic_prefix / postal_code_prefix /
 *     incorporation-date window refined client-side on the bounded subset
 *     (datastore_search has no prefix/range ops). NOTE the legacy endpoint
 *     drops `filters` when `q` is present, so status is ALSO refined client-side.
 *   - `sg_acra_formations_by_ssic`   → bounded datastore_search fan-out across
 *     all 27 shards (preserving full-alphabet coverage), newest-first via
 *     `sort=registration_incorporation_date desc` with early-stop once the
 *     scan passes below the requested year. SSIC prefix + year are best-effort
 *     client-side refines. Never ingests a full shard.
 */

import { z } from "zod";

import {
  type DatasetCache,
  type DatasetDownloader,
  type DatasetEntry,
  datastoreSearch,
} from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

// ---------------------------------------------------------------------------
// Server-side fetch (datastore_search) — NO local ingest.
// ---------------------------------------------------------------------------
//
// NOTE (2026-06): the three ACRA tools used to call
// `ensureAllAcraShardsFresh()` (downloader.ensureFresh across 27 shards) and
// then `queryAllAcraShards()` (full-table cache.query union), ingesting the
// ENTIRE collection into local SQLite on every use.
//
// They now fetch only the relevant subset from data.gov.sg's server-side
// `datastore_search` API and NEVER ingest the full table again. CRITICAL: the
// ACRA registry is sharded by first-letter-of-entity-name across all 27
// `ACRA_SHARDS`. `ACRA_SHARDS[0]` (d_8575…) is ONLY the "A" shard (~1/27 of the
// registry) — it is NOT a curated full dataset. So get_entity, search, AND
// formations all fan out across EVERY shard (bounded + concurrency-limited);
// querying a single shard silently misses ~26/27 of all SG companies. Where
// datastore_search can't express a filter (ssic_prefix / postal_code_prefix /
// incorporation-date window), we fetch the q/status-filtered subset (bounded)
// and refine it client-side — these are best-effort.

/**
 * datastore_search with transient-failure backoff. data.gov.sg rate-limits the
 * legacy datastore_search endpoint aggressively (HTTP 429 after a handful of
 * rapid calls); a 27-shard fan-out trips it constantly. Retry 429/5xx with
 * exponential backoff so a fan-out crawls through instead of failing — and so a
 * transient blip is never mistaken for a genuine "no rows" / "not found".
 */
async function acraDatastoreSearch(
  resourceId: string,
  params: { limit?: number; offset?: number; q?: string; filters?: Record<string, string> },
): Promise<{ records: Array<Record<string, unknown>>; total: number }> {
  const MAX_RETRIES = 6;
  for (let attempt = 0; ; attempt++) {
    try {
      return await datastoreSearch<Record<string, unknown>>(resourceId, params);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const transient = /\b(429|500|502|503|504)\b/u.test(msg);
      if (transient && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt)); // 0.5,1,2,4,8,16s
        continue;
      }
      throw err;
    }
  }
}
/**
 * Per-request page size for datastore_search.
 *
 * VERIFIED (2026-06): unlike the narrow HDB resource, ACRA rows are 53 columns
 * wide, so the endpoint returns 413 Payload Too Large for limit ≥ 5000 on the
 * big shards (limit=2000 → 200, limit=5000/10000 → 413). We cap at 2000 to
 * stay under the payload limit; offset-paging still reaches ACRA_MAX_FETCH_ROWS.
 */
const ACRA_PAGE_SIZE = 2000;
/**
 * Hard ceiling on rows pulled for one tool call. Bounds an unfiltered or
 * weakly-filtered request so it never drags the whole 172k table down — we
 * page with offset until the subset is exhausted OR this cap is hit.
 */
const ACRA_MAX_FETCH_ROWS = 50000;

/**
 * Fan out a datastore_search subset fetch across ALL 27 ACRA shards, pushing
 * what the endpoint supports server-side: `q` (full-text on entity name) and
 * exact `filters` (e.g. entity_status_description). Range/prefix predicates are
 * NOT expressible here and must be refined client-side by the caller.
 *
 * Entities are sharded by first-letter-of-name, so a name/status/SSIC/postal
 * search MUST read every shard — querying only one (e.g. ACRA_SHARDS[0], the
 * "A" shard) silently sees ~1/27 of the registry. Bounded by design:
 *   - A shared global budget (`maxRows`) is spread across shards, so an
 *     unfiltered or weakly-filtered search can never drag the full ~2M-row
 *     table down.
 *   - With a narrowing predicate each shard returns a small subset we page
 *     through within that budget.
 *
 * Returns the fetched rows, the summed server-reported `total` across shards,
 * and a `bounded` flag (true ⇒ rows is a capped slice, not the complete set).
 * Fails LOUD: if any shard query errors (after retries) we throw, rather than
 * return a silently-incomplete subset as if it were complete.
 */
async function fetchAcraSubset(
  opts: { q?: string; filters?: Record<string, string>; maxRows?: number },
): Promise<{ rows: Array<Record<string, unknown>>; total: number; bounded: boolean }> {
  const maxRows = opts.maxRows ?? ACRA_MAX_FETCH_ROWS;
  const filters =
    opts.filters && Object.keys(opts.filters).length > 0 ? opts.filters : undefined;
  const q = opts.q && opts.q.length > 0 ? opts.q : undefined;

  const queue = ACRA_SHARDS.map((s) => s.datasetId);
  let cursor = 0;
  const rows: Array<Record<string, unknown>> = [];
  let grandTotal = 0;
  const errors: string[] = [];

  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      const shardId = queue[cursor++]!;
      try {
        // Probe this shard's subset size (limit=1 returns the server-side total).
        const probe = await acraDatastoreSearch(shardId, { limit: 1, q, filters });
        grandTotal += probe.total;
        let offset = 0;
        while (offset < probe.total && rows.length < maxRows) {
          const pageLimit = Math.min(
            ACRA_PAGE_SIZE,
            maxRows - rows.length,
            probe.total - offset,
          );
          if (pageLimit <= 0) break;
          const res = await acraDatastoreSearch(shardId, {
            limit: pageLimit,
            offset,
            q,
            filters,
          });
          if (res.records.length === 0) break;
          rows.push(...res.records);
          offset += res.records.length;
          if (res.records.length < pageLimit) break; // exhausted this shard's subset
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
  }

  const workers: Promise<void>[] = [];
  const n = Math.min(ACRA_FETCH_CONCURRENCY, queue.length);
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);

  // A failed shard query means we did NOT see that shard's matches — returning
  // the partial result as if complete is exactly the failure mode to kill.
  if (errors.length > 0) {
    throw new Error(
      `datastore_search failed for ${errors.length}/${queue.length} ACRA shard(s) ` +
        `(results would be incomplete): ${errors[0]}`,
    );
  }

  const bounded = grandTotal > rows.length;
  return { rows, total: grandTotal, bounded };
}

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

/**
 * Small concurrency limit for the get_entity / search shard fan-outs so we
 * don't hammer data.gov.sg's aggressively rate-limited datastore_search (429s
 * after a handful of rapid calls — concurrency 2 + acraDatastoreSearch's 429
 * backoff crawls all 27 shards reliably).
 */
const ACRA_FETCH_CONCURRENCY = 2;

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
//
// NOTE (2026-06): the old `shardEntry` / `ensureAllAcraShardsFresh` /
// `queryAllAcraShards` helpers were REMOVED. They drove the full-table local
// ingest (downloader.ensureFresh across 27 shards + cache.query union) that
// this rewrite eliminates. All three ACRA tools now fetch only the relevant
// bounded subset via server-side datastore_search — we never ingest the full
// table again. Per-shard fan-out for `sg_acra_formations_by_ssic` lives in
// `scanShardForFormations` (datastore_search, bounded, no ingest).

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
  match: z.enum(["all", "phrase", "any"]).optional(),
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
});

/**
 * True iff `a` and `b` are within Levenshtein distance 1 (single-band check,
 * O(len)). Used for the per-token fuzzy fallback in name matching.
 */
function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (la === lb) {
      i += 1;
      j += 1;
    } else if (la > lb) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

type AcraSearchInput = z.infer<typeof AcraSearchInput>;

interface AcraSearchOutput {
  total: number;
  returned: number;
  offset: number;
  limit: number;
  /**
   * true ⇒ the shard fan-out hit its global row budget, so the fetched subset
   * (and therefore `total`) is a LOWER BOUND, not the complete match set.
   * Narrow the query (add `query`/`status`) for an exact count.
   */
  bounded: boolean;
  rows: Array<Record<string, unknown>>;
}

async function handleAcraSearch(
  _cache: DatasetCache,
  _downloader: DatasetDownloader,
  rawInput: unknown,
): Promise<AcraSearchOutput> {
  // cache + downloader intentionally unused: served via server-side
  // datastore_search, never ingested locally.
  void _cache;
  void _downloader;

  const input = AcraSearchInput.parse(rawInput);
  const limit = input.limit ?? 50;
  const offset = input.offset ?? 0;

  // Push what datastore_search supports server-side:
  //   - `query`  → full-text `q` on entity name.
  //   - `status` → exact `filters.entity_status_description`.
  // `ssic_prefix`, `postal_code_prefix`, and the incorporation-date window
  // CANNOT be expressed server-side (datastore_search has no prefix/range
  // operators), so they are applied client-side as a BEST-EFFORT refine on
  // the q/status-filtered subset (bounded — see fetchAcraSubset).
  //
  // QUIRK (verified 2026-06): the legacy datastore_search SILENTLY IGNORES
  // `filters` when `q` is also present (q wins; `q=ANG&filters={status:X}`
  // returns the same total for ANY X). So when BOTH query and status are
  // supplied, the server-side status filter is a no-op — we therefore ALSO
  // refine status client-side below so the result is correct either way.
  const filters: Record<string, string> = {};
  if (input.status) filters["entity_status_description"] = input.status;

  let subsetRows: Array<Record<string, unknown>>;
  let subsetBounded = false;
  try {
    const opts: { q?: string; filters?: Record<string, string> } = {};
    if (input.query) opts.q = input.query;
    if (Object.keys(filters).length > 0) opts.filters = filters;
    const res = await fetchAcraSubset(opts);
    subsetRows = res.rows;
    subsetBounded = res.bounded;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Graceful error — NEVER fall back to full local ingest.
    throw new Error(`datastore_search failed for ACRA search: ${message}`);
  }

  // Client-side best-effort refinement for the predicates datastore_search
  // can't do: SSIC prefix, postal-code prefix, and the incorporation-date
  // window (dates are ISO "YYYY-MM-DD" → lexicographic compare is safe).
  const after = input.incorporated_after;
  const before = input.incorporated_before;
  // Re-apply status client-side too: the server drops the status filter when a
  // `q` is present (see QUIRK above), so without this a name+status search
  // would silently ignore `status`. Exact match on entity_status_description.
  const wantStatus = input.status;
  const refined = subsetRows.filter((row) => {
    if (wantStatus && entityStatus(row) !== wantStatus) {
      return false;
    }
    if (input.ssic_prefix && !primarySsic(row).startsWith(input.ssic_prefix)) {
      return false;
    }
    if (
      input.postal_code_prefix &&
      !postalCode(row).startsWith(input.postal_code_prefix)
    ) {
      return false;
    }
    if (after || before) {
      const d = incorporationDate(row);
      if (!d) return false;
      if (after && d < after) return false;
      if (before && d > before) return false;
    }
    return true;
  });

  // Name-relevance stage (2026-07-19): datastore_search's full-text `q`
  // tokenizes and OR-matches, so a multi-word name ("CHONG FONG") matches
  // every CHONG and every FONG (~7k rows). Default `match:"all"` requires
  // every token in entity_name and ranks exact > prefix > phrase > all-tokens;
  // when strict matching finds nothing it falls back to per-token fuzzy
  // (edit distance ≤1, tokens ≥4 chars). "phrase" requires the contiguous
  // phrase; "any" keeps the raw upstream OR behavior.
  const matchMode = input.match ?? "all";
  const rawQuery = (input.query ?? "").trim().toUpperCase();
  const tokens = rawQuery.split(/\s+/u).filter(Boolean);
  let ranked: Array<Record<string, unknown>>;
  if (tokens.length > 0 && matchMode !== "any") {
    const strictTier = (name: string): number => {
      if (name === rawQuery) return 0;
      if (name.startsWith(rawQuery)) return 1;
      if (name.includes(rawQuery)) return 2;
      if (tokens.every((t) => name.includes(t))) return 3;
      return -1;
    };
    const fuzzyHasAll = (name: string): boolean => {
      const words = name.split(/[^A-Z0-9]+/u).filter(Boolean);
      return tokens.every(
        (t) =>
          name.includes(t) ||
          (t.length >= 4 && words.some((w) => editDistanceAtMost1(w, t))),
      );
    };
    const maxTier = matchMode === "phrase" ? 2 : 3;
    let scored = refined
      .map((row) => ({ row, tier: strictTier(entityName(row).toUpperCase()) }))
      .filter((s) => s.tier >= 0 && s.tier <= maxTier);
    if (scored.length === 0 && matchMode === "all") {
      scored = refined
        .filter((row) => fuzzyHasAll(entityName(row).toUpperCase()))
        .map((row) => ({ row, tier: 4 }));
    }
    scored.sort(
      (a, b) =>
        a.tier - b.tier || entityName(a.row).localeCompare(entityName(b.row)),
    );
    ranked = scored.map((s) => s.row);
  } else {
    // No query (filter-only search) or explicit match:"any" — stable name sort.
    ranked = [...refined].sort((a, b) =>
      entityName(a).localeCompare(entityName(b)),
    );
  }

  const total = ranked.length;
  const page = ranked.slice(offset, offset + limit);

  return {
    total,
    returned: page.length,
    offset,
    limit,
    // `bounded` propagates the fan-out budget cap: when true, `total` is a
    // lower bound on the real match count, not a complete tally.
    bounded: subsetBounded,
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
  _cache: DatasetCache,
  _downloader: DatasetDownloader,
  rawInput: unknown,
): Promise<AcraGetEntityOutput> {
  // cache + downloader intentionally unused: served via server-side
  // datastore_search, never ingested locally.
  void _cache;
  void _downloader;

  const { uen: targetUen } = AcraGetEntityInput.parse(rawInput);

  // A UEN can belong to an entity whose name starts with ANY letter, so it may
  // live in any of the 27 first-letter shards. Fan out an exact `filters={uen}`
  // lookup (1 row max per shard) across ALL shards with bounded concurrency,
  // stopping early on the first hit (UEN is unique). Querying only ACRA_SHARDS[0]
  // (the "A" shard) returned `found:false` for ~26/27 of the registry — including
  // the docs' own DBS example (UEN 196800306E). NO local ingest.
  const queue = ACRA_SHARDS.map((s) => s.datasetId);
  let cursor = 0;
  let match: { row: Record<string, unknown>; shardId: string } | undefined;
  const errors: string[] = [];

  async function worker(): Promise<void> {
    while (cursor < queue.length && !match) {
      const shardId = queue[cursor++]!;
      try {
        const res = await acraDatastoreSearch(shardId, {
          limit: 1,
          filters: { uen: targetUen },
        });
        if (res.records.length > 0) {
          if (!match) match = { row: res.records[0]!, shardId };
          return; // early stop: UEN is unique, no other shard can match
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
  }

  const workers: Promise<void>[] = [];
  const n = Math.min(ACRA_FETCH_CONCURRENCY, queue.length);
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);

  if (match) {
    return {
      found: true,
      uen: targetUen,
      entity: match.row,
      shardDatasetId: match.shardId,
    };
  }

  // No shard matched. If ANY shard query errored (after retries), we CANNOT
  // assert "not found" — the entity may live in a shard whose query failed.
  // Fail LOUD rather than return a false `found:false`.
  if (errors.length > 0) {
    throw new Error(
      `datastore_search failed for ACRA get_entity ` +
        `(${errors.length}/${queue.length} shard queries errored; cannot confirm ` +
        `not-found): ${errors[0]}`,
    );
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
  /**
   * true ⇒ at least one shard exceeded the per-shard scan cap so its rows were
   * sampled (bounded), not fully scanned — `count` is then a LOWER BOUND.
   */
  bounded: boolean;
  sample: Array<{
    uen: string;
    entity_name: string;
    primary_ssic_code: string;
    registration_incorporation_date: string;
    entity_status_description: string;
  }>;
}

/**
 * Direct datastore_search call that supports the `sort` param.
 *
 * The shared `datastoreSearch` helper in core deliberately doesn't expose
 * `sort`, but the legacy endpoint DOES honour it (verified:
 * `sort=registration_incorporation_date desc` returns newest-first). We need
 * that for the formations scan (see scanShardForFormations), so we hit the
 * endpoint directly here. Still server-side / paged — NO local ingest.
 */
async function datastoreSearchSorted(
  resourceId: string,
  params: { limit: number; offset: number; sort: string },
): Promise<{ records: Array<Record<string, unknown>>; total: number }> {
  const qs = new URLSearchParams({
    resource_id: resourceId,
    limit: String(params.limit),
    offset: String(params.offset),
    sort: params.sort,
  });
  const url = `https://data.gov.sg/api/action/datastore_search?${qs}`;
  // data.gov.sg rate-limits datastore_search; the 27-shard formations fan-out
  // trips HTTP 429 easily. Retry with exponential backoff so the (intentionally
  // heavy/slow) formations tool crawls through instead of failing outright.
  const MAX_RETRIES = 5;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": "sgdata-mcp/0.1 (+https://altronis.sg)" },
    });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); // 1,2,4,8,16s
      continue;
    }
    if (!res.ok) {
      throw new Error(`datastore_search ${res.status} ${res.statusText} — ${url}`);
    }
    const json = (await res.json()) as {
      success?: boolean;
      result?: { records?: Array<Record<string, unknown>>; total?: number };
    };
    if (!json.success) throw new Error(`datastore_search failed: ${url}`);
    return {
      records: json.result?.records ?? [],
      total: json.result?.total ?? 0,
    };
  }
}

/**
 * Scan ONE ACRA shard for SSIC-prefix + year formations via server-side
 * datastore_search, newest-first, refining client-side. NO local ingest.
 *
 * Why this shape (best-effort / bounded — all three constraints are real):
 *   1. SSIC PREFIX can't be pushed server-side. datastore_search `filters` are
 *      EXACT-match only (no prefix op — `filters.primary_ssic_code="62"` matches
 *      literally "62", not "62010"), and full-text `q` does NOT index the
 *      numeric `primary_ssic_code` (verified: `q=62010` → 0 hits). So SSIC
 *      prefix is refined in JS.
 *   2. YEAR can't be pushed server-side either (no range/prefix op on the date).
 *      BUT the endpoint honours `sort` (verified), so we page newest-first by
 *      `registration_incorporation_date desc` and STOP as soon as a page drops
 *      below the target year — this makes a recent-year query bounded (it never
 *      reads the whole shard) and CORRECT (it sees every row in that year), far
 *      better than a natural-order scan which is unordered by date and misses
 *      almost all matches.
 *   3. HARD CAP. As a backstop against a very old `year` (which would force a
 *      deep scan), we also cap each shard at `maxRowsPerShard`. If we hit that
 *      cap before reaching the year, `truncated=true` and the aggregate count
 *      becomes a LOWER BOUND (surfaced via `bounded`).
 */
async function scanShardForFormations(
  shardId: string,
  ssicPrefix: string,
  yearStr: string,
  maxRowsPerShard: number,
): Promise<{ matches: Array<Record<string, unknown>>; scanned: number; total: number; truncated: boolean }> {
  const matches: Array<Record<string, unknown>> = [];
  let offset = 0;
  let scanned = 0;
  let total = 0;
  let reachedYear = false; // we paged down past the target year (complete for this shard)
  while (scanned < maxRowsPerShard) {
    const pageLimit = Math.min(ACRA_PAGE_SIZE, maxRowsPerShard - scanned);
    const res = await datastoreSearchSorted(shardId, {
      limit: pageLimit,
      offset,
      sort: "registration_incorporation_date desc",
    });
    total = res.total;
    if (res.records.length === 0) break;
    let crossedBelow = false;
    for (const row of res.records) {
      const date = incorporationDate(row);
      const rowYear = date.slice(0, 4);
      // Sorted newest-first: once a row's year is below the target, every
      // remaining row is older too — we've seen the whole target year.
      if (rowYear && rowYear < yearStr) {
        crossedBelow = true;
        break;
      }
      if (date.startsWith(`${yearStr}-`) && primarySsic(row).startsWith(ssicPrefix)) {
        matches.push(row);
      }
    }
    scanned += res.records.length;
    offset += res.records.length;
    if (crossedBelow) {
      reachedYear = true;
      break;
    }
    if (res.records.length < pageLimit) break; // exhausted this shard
  }
  // truncated = we stopped on the hard cap WITHOUT confirming we passed the
  // target year (and didn't simply exhaust the shard) ⇒ count is a lower bound.
  const truncated = !reachedYear && scanned < total;
  return { matches, scanned, total, truncated };
}

// `sg_acra_formations_by_ssic` is FAST-BOUNDED (2026-06-04): the SSIC+year
// filter can't be pushed server-side, so an uncapped 27-shard scan took ~280s
// and timed out clients. We cap each shard to a few recent pages and
// parallelise harder → returns in ~15-30s. For an OLDER year the newest-first
// scan may not reach it within the cap ⇒ `bounded:true` (count is a LOWER
// bound; use the fast SingStat `sg_formations_*` tools for exact counts).
const FORMATIONS_MAX_ROWS_PER_SHARD = 4000; // 2 pages of ACRA_PAGE_SIZE
// Gentle on data.gov.sg's rate limiter (concurrency 6 instant-429'd); with
// 429 backoff in datastoreSearchSorted this crawls the 27 shards reliably but
// slowly (~1-3 min). It's documented as a "heavy" tool in the README.
const FORMATIONS_CONCURRENCY = 2;

async function handleAcraFormations(
  _cache: DatasetCache,
  _downloader: DatasetDownloader,
  rawInput: unknown,
): Promise<AcraFormationsOutput> {
  // cache + downloader intentionally unused: served via server-side
  // datastore_search across the shard resources, never ingested locally.
  void _cache;
  void _downloader;

  const input = AcraFormationsInput.parse(rawInput);
  const yearNum = typeof input.year === "number" ? input.year : Number(input.year);
  const yearStr = String(yearNum);

  // Fan out datastore_search across all 27 shard resources (preserving the
  // old tool's full-alphabet coverage) WITHOUT any local ingest. Each shard
  // is paged + refined client-side for SSIC-prefix + year (see
  // scanShardForFormations for why this can't be pushed server-side). The
  // per-shard scan is bounded by ACRA_MAX_FETCH_ROWS so a huge shard can't
  // drag its whole table down — for such shards the count is a LOWER BOUND.
  const queue = ACRA_SHARDS.map((s) => s.datasetId);
  let cursor = 0;
  const allMatches: Array<Record<string, unknown>> = [];
  let anyTruncated = false;

  try {
    async function worker(): Promise<void> {
      while (cursor < queue.length) {
        const idx = cursor++;
        const shardId = queue[idx]!;
        const { matches, truncated } = await scanShardForFormations(
          shardId,
          input.ssic_prefix,
          yearStr,
          FORMATIONS_MAX_ROWS_PER_SHARD,
        );
        if (truncated) anyTruncated = true;
        for (const m of matches) allMatches.push(m);
      }
    }
    const workers: Promise<void>[] = [];
    const n = Math.min(FORMATIONS_CONCURRENCY, queue.length);
    for (let i = 0; i < n; i++) workers.push(worker());
    await Promise.all(workers);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Graceful error — NEVER fall back to full local ingest.
    throw new Error(`datastore_search failed for ACRA formations: ${message}`);
  }

  allMatches.sort((a, b) =>
    incorporationDate(a).localeCompare(incorporationDate(b)),
  );

  const sample = allMatches.slice(0, 25).map((row) => ({
    uen: uen(row),
    entity_name: entityName(row),
    primary_ssic_code: primarySsic(row),
    registration_incorporation_date: incorporationDate(row),
    entity_status_description: entityStatus(row),
  }));

  // silence unused warning for postalCode helper (kept for future filters)
  void postalCode;

  // NOTE: `count` is over the bounded per-shard scans. `bounded: true` means at
  // least one shard exceeded ACRA_MAX_FETCH_ROWS so its rows were sampled, not
  // fully scanned — the count is then a LOWER BOUND on the true formation total.
  return {
    ssic_prefix: input.ssic_prefix,
    year: yearNum,
    count: allMatches.length,
    bounded: anyTruncated,
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
        "Search the curated ACRA corporate registry resource server-side " +
        "(via datastore_search; no local ingest). Filters: free-text substring " +
        "on entity_name (`query`), SSIC prefix (`ssic_prefix`, e.g. '62' for " +
        "IT), exact entity status (`status`, e.g. 'Live Company'), " +
        "incorporation date window (`incorporated_after` / " +
        "`incorporated_before`, YYYY-MM-DD), and postal code prefix " +
        "(`postal_code_prefix`). query+status are pushed server-side; SSIC/" +
        "postal/date predicates are refined client-side on the bounded fetched " +
        "subset. Multi-word queries default to match:'all' (every token must " +
        "appear in entity_name, ranked exact > prefix > phrase > all-tokens, " +
        "with an edit-distance-1 fuzzy fallback when nothing matches " +
        "strictly); match:'phrase' requires the contiguous phrase; " +
        "match:'any' keeps raw upstream OR matching. Paginated via " +
        "limit/offset.",
      inputSchema: AcraSearchInput,
      handler: (input: unknown) => handleAcraSearch(cache, downloader, input),
    },
    {
      name: "sg_acra_get_entity",
      description:
        "Look up a single ACRA corporate entity by exact UEN via a server-side " +
        "datastore_search exact-match query (no local ingest). Returns the " +
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
      "Search the curated ACRA corporate registry resource server-side via " +
      "datastore_search (entity name substring, SSIC prefix, status, " +
      "incorporation date window, postal code prefix).",
    inputSchema: AcraSearchInput,
    handler: notWired("sg_acra_search_entities"),
  },
  {
    name: "sg_acra_get_entity",
    description:
      "Look up a single ACRA corporate entity by exact UEN via a server-side " +
      "datastore_search exact-match query (no local ingest).",
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

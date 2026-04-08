/**
 * Generic "layer 2" tools for sgdata-mcp.
 *
 * These three tools work for ANY dataset on data.gov.sg by ID, without
 * requiring a hand-curated layer-1 handler. They're how the MCP server
 * stays useful across the long tail of ~2000 government datasets.
 *
 *   sg_search_datasets   — keyword discovery (no cache, hits API directly)
 *   sg_dataset_schema    — column metadata for a single dataset (no cache)
 *   sg_dataset_query     — filtered + paginated rows from the local cache
 *
 * sg_dataset_query depends on `DatasetCache` + `DatasetDownloader` from core,
 * which are now passed in via `createGenericTools(cache, downloader)`. The
 * other two are pure HTTP and don't need core wiring.
 */

import { z } from "zod";

import type {
  DatasetCache,
  DatasetDownloader,
  DatasetEntry,
} from "../core/index.js";
import { getDatasetMetadata } from "../core/index.js";

// ---------------------------------------------------------------------------
// Shared HTTP helper. We use globalThis fetch (Node 20+) — no axios.
// ---------------------------------------------------------------------------

const DATAGOV_BASE = "https://api-production.data.gov.sg/v2/public/api";
const USER_AGENT = "sgdata-mcp/0.1 (+https://altronis.sg)";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
  });
  if (!res.ok) {
    throw new Error(
      `data.gov.sg request failed: ${res.status} ${res.statusText} — ${url}`,
    );
  }
  return (await res.json()) as T;
}

function truncate(text: string | undefined, max = 300): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).trimEnd() + "\u2026";
}

// ---------------------------------------------------------------------------
// Tool 1: sg_search_datasets
// ---------------------------------------------------------------------------

export const SearchDatasetsInput = z.object({
  query: z.string().min(1, "query must not be empty"),
  limit: z.number().int().positive().max(50).optional(),
  agency: z.string().min(1).optional(),
  format: z.enum(["CSV", "GEOJSON", "JSON"]).optional(),
});

export type SearchDatasetsInput = z.infer<typeof SearchDatasetsInput>;

interface RawDatasetSearchHit {
  datasetId?: string;
  name?: string;
  description?: string;
  managedByAgencyName?: string;
  format?: string;
  lastUpdatedAt?: string;
  rowCount?: number;
  sizeBytes?: number;
}

interface RawDatasetSearchResponse {
  data?: {
    datasets?: RawDatasetSearchHit[];
    // Some variants of the search endpoint nest results under `results`.
    results?: RawDatasetSearchHit[];
  };
}

export interface SearchDatasetsOutput {
  count: number;
  datasets: Array<{
    datasetId: string;
    name: string;
    description: string;
    agency: string;
    format: string;
    lastUpdatedAt: string;
    rowCount?: number;
    sizeBytes?: number;
  }>;
}

export async function sgSearchDatasets(
  input: SearchDatasetsInput,
): Promise<SearchDatasetsOutput> {
  const parsed = SearchDatasetsInput.parse(input);
  const limit = parsed.limit ?? 10;

  const qs = new URLSearchParams({ q: parsed.query });
  // Ask the upstream for a generous page so post-filtering still gives us
  // `limit` after agency/format trimming.
  qs.set("page", "1");
  qs.set("size", String(Math.max(limit * 3, 30)));

  const url = `${DATAGOV_BASE}/datasets?${qs.toString()}`;
  const json = await fetchJson<RawDatasetSearchResponse>(url);
  const rawHits =
    json.data?.datasets ?? json.data?.results ?? ([] as RawDatasetSearchHit[]);

  const agencyNeedle = parsed.agency?.toLowerCase();
  const formatFilter = parsed.format;

  const filtered: SearchDatasetsOutput["datasets"] = [];
  for (const hit of rawHits) {
    if (!hit.datasetId) continue;
    if (
      agencyNeedle &&
      !(hit.managedByAgencyName ?? "").toLowerCase().includes(agencyNeedle)
    ) {
      continue;
    }
    if (formatFilter && (hit.format ?? "").toUpperCase() !== formatFilter) {
      continue;
    }
    filtered.push({
      datasetId: hit.datasetId,
      name: hit.name ?? "(unnamed dataset)",
      description: truncate(hit.description, 300),
      agency: hit.managedByAgencyName ?? "",
      format: hit.format ?? "",
      lastUpdatedAt: hit.lastUpdatedAt ?? "",
      ...(hit.rowCount != null ? { rowCount: hit.rowCount } : {}),
      ...(hit.sizeBytes != null ? { sizeBytes: hit.sizeBytes } : {}),
    });
    if (filtered.length >= limit) break;
  }

  return {
    count: filtered.length,
    datasets: filtered,
  };
}

// ---------------------------------------------------------------------------
// Tool 2: sg_dataset_schema
// ---------------------------------------------------------------------------

export const DatasetSchemaInput = z.object({
  datasetId: z.string().min(1, "datasetId is required"),
});

export type DatasetSchemaInput = z.infer<typeof DatasetSchemaInput>;

export interface DatasetSchemaOutput {
  datasetId: string;
  name: string;
  description: string;
  agency: string;
  format: string;
  lastUpdatedAt: string;
  sizeBytes?: number;
  columns: Array<{ id: string; label: string }>;
  collectionIds: string[];
}

export async function sgDatasetSchema(
  input: DatasetSchemaInput,
): Promise<DatasetSchemaOutput> {
  const { datasetId } = DatasetSchemaInput.parse(input);
  const meta = await getDatasetMetadata(datasetId);

  const columns = meta.columnOrder.map((colId) => ({
    id: colId,
    label: meta.columnLabels[colId] ?? colId,
  }));

  const out: DatasetSchemaOutput = {
    datasetId: meta.datasetId,
    name: meta.name ?? "(unnamed dataset)",
    description: meta.description ?? "",
    agency: meta.managedBy ?? "",
    format: meta.format ?? "",
    lastUpdatedAt: meta.lastUpdatedAt ?? "",
    columns,
    collectionIds: (meta.collectionIds ?? []).map((c) => String(c)),
  };
  if (meta.datasetSize != null) out.sizeBytes = meta.datasetSize;
  return out;
}

// ---------------------------------------------------------------------------
// Tool 3: sg_dataset_query
// ---------------------------------------------------------------------------

export const DatasetQueryInput = z.object({
  datasetId: z.string().min(1, "datasetId is required"),
  filters: z.record(z.union([z.string(), z.number()])).optional(),
  like: z.record(z.string()).optional(),
  limit: z.number().int().positive().max(1000).optional(),
  offset: z.number().int().nonnegative().optional(),
});

export type DatasetQueryInput = z.infer<typeof DatasetQueryInput>;

export interface DatasetQueryOutput {
  datasetId: string;
  total: number;
  returned: number;
  rows: Array<Record<string, unknown>>;
  cached: boolean;
  ingestedAt?: string;
}

/** Default refresh policy for ad-hoc datasets queried via sg_dataset_query. */
const GENERIC_REFRESH_DAYS = 30;

/**
 * sg_dataset_query — runs against the local cache, downloading the dataset
 * on first use. Takes the cache + downloader as deps so the MCP server can
 * inject them at startup. The shared metadata fetch validates filter keys
 * before we touch the cache, giving the LLM a clean error on typos.
 */
export async function sgDatasetQuery(
  input: DatasetQueryInput,
  cache: DatasetCache,
  downloader: DatasetDownloader,
): Promise<DatasetQueryOutput> {
  const parsed = DatasetQueryInput.parse(input);
  const limit = parsed.limit ?? 50;
  const offset = parsed.offset ?? 0;

  // 1. Pull metadata to validate filter keys against known column labels.
  //    Fails fast on bad dataset IDs before touching the cache/downloader.
  const meta = await getDatasetMetadata(parsed.datasetId);
  const labelSet = new Set(
    Object.values(meta.columnLabels).filter(
      (l): l is string => typeof l === "string" && l.length > 0,
    ),
  );
  const unknownFilter = [
    ...Object.keys(parsed.filters ?? {}),
    ...Object.keys(parsed.like ?? {}),
  ].find((k) => labelSet.size > 0 && !labelSet.has(k));
  if (unknownFilter) {
    throw new Error(
      `Unknown column "${unknownFilter}" for dataset ${parsed.datasetId}. ` +
        `Call sg_dataset_schema first to see valid column labels.`,
    );
  }

  // 2. Make sure the dataset is in the local cache (downloader is no-op if
  //    fresh, refetches if stale per refreshDays).
  const syntheticEntry: DatasetEntry = {
    id: `generic_${parsed.datasetId}`,
    datasetId: parsed.datasetId,
    name: meta.name ?? parsed.datasetId,
    description: meta.description ?? "",
    agency: meta.managedBy ?? "data.gov.sg",
    refreshDays: GENERIC_REFRESH_DAYS,
    tags: [],
  };
  await downloader.ensureFresh(syntheticEntry);

  // 3. Build the column-label map from the dataset metadata so callers can
  //    pass either the human label or the underlying CSV header. The cache
  //    sanitizes column names internally — we mirror its sanitization to map
  //    label → sql column. The cache also accepts raw human labels and falls
  //    back gracefully so we don't actually need to remap here.
  //
  // 4. Run the filter query. cache.query returns T[] directly — we slice
  //    in JS for total + page count, since these queries are local SQLite.
  const allRows = cache.query<Record<string, unknown>>(parsed.datasetId, {
    where: parsed.filters,
    like: parsed.like,
  });
  const total = allRows.length;
  const rows = allRows.slice(offset, offset + limit);

  const stat = cache.stat(parsed.datasetId);
  const out: DatasetQueryOutput = {
    datasetId: parsed.datasetId,
    total,
    returned: rows.length,
    rows,
    cached: true,
  };
  if (stat?.ingestedAt) {
    out.ingestedAt = new Date(stat.ingestedAt).toISOString();
  }
  return out;
}

/**
 * data.gov.sg v2 API client.
 *
 * Verified endpoints (2026-04):
 *   GET  /v2/public/api/collections/{collectionId}/metadata
 *        → { code, data: { collectionMetadata: { collectionId, name, description, childDatasets: [...] } } }
 *   GET  /v2/public/api/datasets/{datasetId}/metadata
 *        → { code, data: { datasetId, name, description, columnMetadata: { order, map, metaMapping }, ... } }
 *        Note: dataset fields live directly under `data` (no nested `datasetMetadata`).
 *        `columnMetadata.map` is Record<string, string> — value is the human label.
 *   POST /v2/internal/api/datasets/{datasetId}/initiate-download
 *        → { code, data: { message, url? } }    (signed S3 url often returned immediately)
 *   POST /v2/internal/api/datasets/{datasetId}/poll-download
 *        → { code, data: { status, url?, errorMsg? } }
 *        status ∈ QUEUED | PROCESSING | DOWNLOAD_SUCCESS | DOWNLOAD_FAILED
 *
 *   GET  https://data.gov.sg/api/action/datastore_search?resource_id=...
 *        Legacy v1 — works for datasets that kept their CKAN resource_id alias.
 *
 * The /v2/internal/ download endpoints reject default curl headers; we always
 * send Content-Type + Accept JSON to keep API Gateway happy.
 */

const PUBLIC_BASE = "https://api-production.data.gov.sg/v2/public/api";
const INTERNAL_BASE = "https://api-production.data.gov.sg/v2/internal/api";
const LEGACY_BASE = "https://data.gov.sg/api/action";

const USER_AGENT = "sgdata-mcp/0.1 (+https://altronis.sg)";

export type DownloadStatus =
  | "QUEUED"
  | "PROCESSING"
  | "DOWNLOAD_SUCCESS"
  | "DOWNLOAD_FAILED";

export interface PollDownloadResult {
  status: DownloadStatus;
  url?: string;
  errorMsg?: string;
}

export interface InitiateDownloadResult {
  message?: string;
  url?: string;
}

export interface DatasetMetadata {
  datasetId: string;
  name?: string;
  description?: string;
  managedBy?: string;
  format?: string;
  datasetSize?: number;
  lastUpdatedAt?: string;
  coverageStart?: string;
  coverageEnd?: string;
  collectionIds?: string[];
  columnOrder: string[];
  /** opaque column id → human-readable label (e.g. "c_xxx" → "uen") */
  columnLabels: Record<string, string>;
}

export interface CollectionMetadata {
  collectionId: string;
  name?: string;
  description?: string;
  managedBy?: string;
  frequency?: string;
  lastUpdatedAt?: string;
  childDatasets: string[];
}

interface ApiEnvelope<T> {
  code?: number;
  data?: T;
  errorMsg?: string;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `data.gov.sg ${res.status} ${res.statusText} — ${url}${body ? ` — ${body.slice(0, 200)}` : ""}`,
    );
  }
  return (await res.json()) as T;
}

/** Fetch collection metadata, including the list of child dataset ids. */
export async function getCollectionMetadata(
  collectionId: string | number,
): Promise<CollectionMetadata> {
  const url = `${PUBLIC_BASE}/collections/${collectionId}/metadata`;
  const json = await fetchJson<
    ApiEnvelope<{
      collectionMetadata?: {
        collectionId?: string;
        name?: string;
        description?: string;
        managedBy?: string;
        frequency?: string;
        lastUpdatedAt?: string;
        childDatasets?: string[];
      };
    }>
  >(url);
  const meta = json.data?.collectionMetadata;
  if (!meta) throw new Error(`Collection ${collectionId} returned no metadata`);
  return {
    collectionId: String(meta.collectionId ?? collectionId),
    name: meta.name,
    description: meta.description,
    managedBy: meta.managedBy,
    frequency: meta.frequency,
    lastUpdatedAt: meta.lastUpdatedAt,
    childDatasets: meta.childDatasets ?? [],
  };
}

/** Fetch dataset metadata — column schema, last updated, size. */
export async function getDatasetMetadata(datasetId: string): Promise<DatasetMetadata> {
  const url = `${PUBLIC_BASE}/datasets/${datasetId}/metadata`;
  const json = await fetchJson<
    ApiEnvelope<{
      datasetId?: string;
      name?: string;
      description?: string;
      managedBy?: string;
      format?: string;
      datasetSize?: number;
      lastUpdatedAt?: string;
      coverageStart?: string;
      coverageEnd?: string;
      collectionIds?: string[];
      columnMetadata?: {
        order?: string[];
        map?: Record<string, unknown>;
      };
    }>
  >(url);
  const d = json.data;
  if (!d) throw new Error(`Dataset ${datasetId} returned no metadata`);
  const columnOrder = d.columnMetadata?.order ?? [];
  const rawMap = d.columnMetadata?.map ?? {};
  const columnLabels: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawMap)) {
    if (typeof v === "string") {
      columnLabels[k] = v;
    } else if (v && typeof v === "object") {
      // Defensive: in case the shape ever changes back to {colLabel}
      const obj = v as { colLabel?: unknown };
      if (typeof obj.colLabel === "string") columnLabels[k] = obj.colLabel;
    }
  }
  return {
    datasetId: String(d.datasetId ?? datasetId),
    name: d.name,
    description: d.description,
    managedBy: d.managedBy,
    format: d.format,
    datasetSize: d.datasetSize,
    lastUpdatedAt: d.lastUpdatedAt,
    coverageStart: d.coverageStart,
    coverageEnd: d.coverageEnd,
    collectionIds: d.collectionIds,
    columnOrder,
    columnLabels,
  };
}

/**
 * Kick off (or restart) a download job. The response sometimes already
 * includes a signed S3 url — caller may use it immediately and skip polling.
 */
export async function initiateDownload(
  datasetId: string,
): Promise<InitiateDownloadResult> {
  const url = `${INTERNAL_BASE}/datasets/${datasetId}/initiate-download`;
  const json = await fetchJson<ApiEnvelope<{ message?: string; url?: string }>>(
    url,
    { method: "POST", body: "{}" },
  );
  return { message: json.data?.message, url: json.data?.url };
}

/** Poll a download job. POST (not GET) — API Gateway 400s on GET. */
export async function pollDownload(datasetId: string): Promise<PollDownloadResult> {
  const url = `${INTERNAL_BASE}/datasets/${datasetId}/poll-download`;
  const json = await fetchJson<
    ApiEnvelope<{ status?: string; url?: string; errorMsg?: string }>
  >(url, { method: "POST", body: "{}" });
  const d = json.data ?? {};
  return {
    status: (d.status as DownloadStatus) ?? "QUEUED",
    url: d.url,
    errorMsg: d.errorMsg,
  };
}

/**
 * Block until poll-download returns DOWNLOAD_SUCCESS (or DOWNLOAD_FAILED).
 * Returns the signed S3 url. Exponential backoff capped at 5s, default ~5 min total.
 */
export async function waitForDownloadUrl(
  datasetId: string,
  opts: { maxMs?: number; log?: (msg: string) => void } = {},
): Promise<string> {
  const maxMs = opts.maxMs ?? 5 * 60 * 1000;
  const log = opts.log ?? (() => {});

  // initiate often returns the url straight away — try the fast path first
  const init = await initiateDownload(datasetId);
  if (init.url) {
    log(`[initiate-download ${datasetId}] url ready immediately`);
    return init.url;
  }

  const start = Date.now();
  let delay = 500;
  while (Date.now() - start < maxMs) {
    const r = await pollDownload(datasetId);
    log(`[poll-download ${datasetId}] status=${r.status}`);
    if (r.status === "DOWNLOAD_SUCCESS" && r.url) return r.url;
    if (r.status === "DOWNLOAD_FAILED") {
      throw new Error(
        `poll-download failed for ${datasetId}: ${r.errorMsg ?? "(no err)"}`,
      );
    }
    await new Promise((res) => setTimeout(res, delay));
    delay = Math.min(delay * 1.5, 5000);
  }
  throw new Error(`poll-download timeout for ${datasetId} after ${maxMs}ms`);
}

/** Fetch the raw CSV body for a dataset. Returns a Buffer. */
export async function downloadDatasetCsv(
  datasetId: string,
  opts: { maxMs?: number; log?: (msg: string) => void } = {},
): Promise<Buffer> {
  const signedUrl = await waitForDownloadUrl(datasetId, opts);
  const res = await fetch(signedUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`CSV fetch ${res.status} ${res.statusText} — ${signedUrl}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Legacy v1 datastore_search — works for datasets that kept their CKAN
 * resource_id alias online. Useful for small lookup tables where polling +
 * signed-url download would be wasteful.
 */
export async function datastoreSearch<T = Record<string, unknown>>(
  resourceId: string,
  params: {
    limit?: number;
    offset?: number;
    q?: string;
    filters?: Record<string, string>;
  } = {},
): Promise<{ records: T[]; total: number }> {
  const qs = new URLSearchParams({ resource_id: resourceId });
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  if (params.q) qs.set("q", params.q);
  if (params.filters) qs.set("filters", JSON.stringify(params.filters));
  const url = `${LEGACY_BASE}/datastore_search?${qs}`;
  const json = await fetchJson<{
    success?: boolean;
    result?: { records?: T[]; total?: number };
  }>(url);
  if (!json.success) throw new Error(`datastore_search failed: ${url}`);
  return {
    records: json.result?.records ?? [],
    total: json.result?.total ?? 0,
  };
}

/**
 * Dataset catalog + client-side search.
 *
 * Why this exists: data.gov.sg's `/v2/public/api/datasets` endpoint IGNORES the
 * `q` search param (and the legacy CKAN `package_search` is dead), so the old
 * `sg_search_datasets` silently returned the same default list for every query.
 * This module fetches the FULL catalog (~4.4k datasets, 441 pages of 10) once,
 * caches it to `~/.sgdata-mcp/catalog.json` for 24h, and does real keyword
 * matching locally.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const DATAGOV_BASE = "https://api-production.data.gov.sg/v2/public/api";
const CATALOG_PATH = path.join(os.homedir(), ".sgdata-mcp", "catalog.json");
const TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CONCURRENCY = 16;

export interface CatalogEntry {
  datasetId: string;
  name: string;
  description: string;
  agency: string;
  format: string;
  lastUpdatedAt: string;
}

interface RawHit {
  datasetId?: string;
  name?: string;
  description?: string;
  managedByAgencyName?: string;
  format?: string;
  lastUpdatedAt?: string;
}

function toEntry(d: RawHit): CatalogEntry {
  return {
    datasetId: d.datasetId ?? "",
    name: d.name ?? "",
    description: d.description ?? "",
    agency: d.managedByAgencyName ?? "",
    format: d.format ?? "",
    lastUpdatedAt: d.lastUpdatedAt ?? "",
  };
}

/**
 * Fetch one catalog page. CRITICAL: distinguish "page returned no data" (a
 * legitimate empty page — returned normally) from "page fetch FAILED" (HTTP
 * error / network error). fetch() does NOT throw on 5xx/429, so the old
 * `if (!r.ok) return {entries:[], pages:1}` silently turned an upstream failure
 * into an EMPTY catalog — `sg_search_datasets` then reported `count:0` as if no
 * dataset matched (and a partial mid-pagination failure silently dropped ~10
 * datasets per failed page). We now retry transient failures (429/5xx) with
 * backoff and THROW on persistent failure, so the build fails loud rather than
 * caching/serving a known-incomplete catalog for 24h.
 */
async function fetchPage(page: number): Promise<{ entries: CatalogEntry[]; pages: number }> {
  const MAX_RETRIES = 4;
  for (let attempt = 0; ; attempt++) {
    let r: Response;
    try {
      r = await fetch(`${DATAGOV_BASE}/datasets?page=${page}`);
    } catch (err) {
      // Network-level failure (DNS, reset, etc.) — fetch rejected.
      if (attempt < MAX_RETRIES) {
        await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
        continue;
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`catalog page ${page} fetch failed: ${msg}`);
    }
    if (r.ok) {
      const j = (await r.json()) as { data?: { datasets?: RawHit[]; pages?: number } };
      const ds = j?.data?.datasets ?? [];
      return { entries: ds.map(toEntry).filter((e) => e.datasetId), pages: j?.data?.pages ?? 1 };
    }
    // Non-2xx. Retry transient rate-limit / server errors; fail loud otherwise.
    const transient = r.status === 429 || r.status >= 500;
    if (transient && attempt < MAX_RETRIES) {
      await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
      continue;
    }
    throw new Error(`catalog page ${page} fetch failed: HTTP ${r.status} ${r.statusText}`);
  }
}

/**
 * Fetch every page of the catalog (bounded concurrency) and cache it.
 *
 * Fail-loud: fetchPage now THROWS on a persistent page fetch failure, so any
 * failed page (page 1 or a mid-pagination page) rejects the Promise.all below
 * and propagates out of buildCatalog BEFORE the cache write — we never persist
 * or return a silently-truncated catalog. The caller surfaces the error instead
 * of a misleading empty/short result.
 */
export async function buildCatalog(): Promise<CatalogEntry[]> {
  const first = await fetchPage(1);
  const pages = first.pages;
  const all: CatalogEntry[] = [...first.entries];

  for (let start = 2; start <= pages; start += CONCURRENCY) {
    const batch: Promise<{ entries: CatalogEntry[] }>[] = [];
    for (let p = start; p < start + CONCURRENCY && p <= pages; p++) batch.push(fetchPage(p));
    const results = await Promise.all(batch);
    for (const res of results) all.push(...res.entries);
  }

  try {
    mkdirSync(path.dirname(CATALOG_PATH), { recursive: true });
    writeFileSync(CATALOG_PATH, JSON.stringify({ fetchedAt: Date.now(), entries: all }));
  } catch {
    /* cache write is best-effort */
  }
  return all;
}

/** Return the cached catalog if fresh, otherwise (re)build it. */
export async function getCatalog(forceRefresh = false): Promise<CatalogEntry[]> {
  if (!forceRefresh && existsSync(CATALOG_PATH)) {
    try {
      const c = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as {
        fetchedAt: number;
        entries: CatalogEntry[];
      };
      if (Date.now() - c.fetchedAt < TTL_MS && Array.isArray(c.entries) && c.entries.length > 0) {
        return c.entries;
      }
    } catch {
      /* fall through and rebuild */
    }
  }
  return buildCatalog();
}

/** Score-and-rank keyword search over the catalog (name weighted 3x vs description). */
export function searchCatalog(
  entries: CatalogEntry[],
  query: string,
  opts: { limit?: number; agency?: string; format?: string } = {},
): CatalogEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const agencyNeedle = opts.agency?.toLowerCase();
  const formatFilter = opts.format?.toUpperCase();

  const scored: Array<{ e: CatalogEntry; score: number }> = [];
  for (const e of entries) {
    if (agencyNeedle && !e.agency.toLowerCase().includes(agencyNeedle)) continue;
    if (formatFilter && e.format.toUpperCase() !== formatFilter) continue;
    const name = e.name.toLowerCase();
    const desc = e.description.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (name.includes(t)) score += 3;
      if (desc.includes(t)) score += 1;
    }
    if (score > 0) scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name));
  return scored.slice(0, opts.limit ?? 10).map((x) => x.e);
}

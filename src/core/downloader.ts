import {
  downloadDatasetCsv,
  getCollectionMetadata,
  getDatasetMetadata,
} from "./datagov-api.js";
import type { DatasetCache } from "./cache.js";
import type { DatasetEntry } from "./registry.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EnsureFreshResult {
  rowCount: number;
  shards?: number;
}

export class DatasetDownloader {
  constructor(private readonly cache: DatasetCache) {}

  async ensureFresh(
    entry: DatasetEntry,
    log: (m: string) => void = () => {},
  ): Promise<EnsureFreshResult> {
    const ttlMs = entry.refreshDays * DAY_MS;

    if (entry.shardCollection && entry.collectionId) {
      return this.ensureFreshCollection(entry, ttlMs, log);
    }
    return this.ensureFreshSingle(entry.datasetId, ttlMs, log);
  }

  private async ensureFreshSingle(
    datasetId: string,
    ttlMs: number,
    log: (m: string) => void,
  ): Promise<EnsureFreshResult> {
    if (!this.cache.isStale(datasetId, ttlMs)) {
      const stat = this.cache.stat(datasetId);
      log(`[cache hit ${datasetId}] rows=${stat?.rowCount ?? 0}`);
      return { rowCount: stat?.rowCount ?? 0 };
    }
    log(`[fetch ${datasetId}] downloading…`);
    const meta = await getDatasetMetadata(datasetId);
    const csv = await downloadDatasetCsv(datasetId, { log });
    const { rowCount } = await this.cache.ingest(datasetId, csv, meta.columnLabels);
    log(`[ingest ${datasetId}] rows=${rowCount}`);
    return { rowCount };
  }

  private async ensureFreshCollection(
    entry: DatasetEntry,
    ttlMs: number,
    log: (m: string) => void,
  ): Promise<EnsureFreshResult> {
    const collectionId = entry.collectionId!;
    const collection = await getCollectionMetadata(collectionId);
    const shardIds = collection.childDatasets;
    log(`[collection ${collectionId}] ${shardIds.length} shard(s)`);

    let totalRows = 0;
    let unionLabels: Record<string, string> | null = null;

    for (const shardId of shardIds) {
      const shard = await this.ensureFreshSingle(shardId, ttlMs, log);
      totalRows += shard.rowCount;
      if (!unionLabels) {
        const meta = await getDatasetMetadata(shardId).catch(() => null);
        if (meta) unionLabels = meta.columnLabels;
      }
    }

    // Build a unioned virtual table under the entry.datasetId so callers can
    // query the whole collection through one logical id.
    if (shardIds.length > 0) {
      try {
        await this.buildUnionView(entry.datasetId, shardIds, unionLabels ?? {});
      } catch (err) {
        log(`[union ${entry.datasetId}] failed: ${(err as Error).message}`);
      }
    }

    return { rowCount: totalRows, shards: shardIds.length };
  }

  /**
   * Persist a unioned snapshot under `unionDatasetId`. Re-ingests by reading
   * each shard's table out of cache and concatenating in-memory then writing
   * back through cache.ingest. Cheap because better-sqlite3 is sync.
   */
  private async buildUnionView(
    unionDatasetId: string,
    shardIds: string[],
    labels: Record<string, string>,
  ): Promise<void> {
    const allRows: Record<string, string>[] = [];
    for (const sid of shardIds) {
      const rows = this.cache.query<Record<string, string>>(sid);
      for (const r of rows) allRows.push(r);
    }
    if (allRows.length === 0) return;
    const headers = Object.keys(allRows[0]!);
    const lines: string[] = [];
    lines.push(headers.map(csvField).join(","));
    for (const row of allRows) {
      lines.push(headers.map((h) => csvField(row[h] ?? "")).join(","));
    }
    const csv = Buffer.from(lines.join("\n"), "utf8");
    await this.cache.ingest(unionDatasetId, csv, labels);
  }
}

function csvField(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

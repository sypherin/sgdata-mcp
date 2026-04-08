/**
 * Dataset registry — high-level catalogue of datasets the MCP server exposes.
 *
 * Entries are populated in src/datasets/ by other agents. This module only
 * defines the type and a simple lookup helper.
 */

export interface DatasetEntry {
  /** Stable short id used by tools and CLI, e.g. "acra_entities". */
  id: string;
  /** data.gov.sg dataset id, e.g. "d_af2042c77ffaf0db5d75561ce9ef5688". */
  datasetId: string;
  /** data.gov.sg collection id (string form), if this entry is collection-backed. */
  collectionId?: string;
  /**
   * If true, fetch all childDatasets from `collectionId` and union them into
   * a single logical table. `datasetId` should still point at one representative
   * shard so the entry stays valid for direct dataset queries.
   */
  shardCollection?: boolean;
  name: string;
  description: string;
  agency: string;
  /** Cache TTL in days. */
  refreshDays: number;
  tags: string[];
}

export const datasets: DatasetEntry[] = [];

const byId = new Map<string, DatasetEntry>();

export function registerDatasets(entries: DatasetEntry[]): void {
  for (const e of entries) {
    datasets.push(e);
    byId.set(e.id, e);
  }
}

export function getDataset(id: string): DatasetEntry | undefined {
  if (byId.size !== datasets.length) {
    byId.clear();
    for (const e of datasets) byId.set(e.id, e);
  }
  return byId.get(id);
}

export function listDatasets(): DatasetEntry[] {
  return datasets.slice();
}

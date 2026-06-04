/**
 * Curated dataset handlers barrel.
 *
 * Each sub-module under src/datasets/ owns one logical dataset (or one
 * sharded collection) and exports:
 *   - `{name}Entries: DatasetEntry[]` — registry rows
 *   - `{name}Tools: ToolDef[]`        — metadata-only tool descriptors
 *   - `create{Name}Tools(cache, downloader): ToolDef[]` — live tool factory
 *
 * The server entrypoint should:
 *   1. Call `registerDatasets([...allEntries])` so the generic layer can
 *      resolve id → datasetId.
 *   2. Call each `create{Name}Tools(cache, downloader)` factory and feed
 *      the returned ToolDef[] into the MCP tool list alongside
 *      `genericTools` from ../tools/index.js.
 */

import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

import { acraEntries, createAcraTools } from "./acra.js";
import { allCuratedEntries, createAllCuratedTools } from "./non-acra.js";
import { createRealtimeTools } from "./realtime.js";
import {
  singstatExtraEntries,
  createSingstatExtraTools,
} from "./singstat_extra.js";

export * from "./acra.js";
export * from "./non-acra.js";
export * from "./realtime.js";
export * from "./singstat_extra.js";

/** Every curated DatasetEntry across ACRA, the non-ACRA datasets, and the
 *  extra SingStat tables. (Real-time tools hit live APIs — no registry rows.) */
export function allDatasetEntries(): DatasetEntry[] {
  return [...acraEntries, ...allCuratedEntries(), ...singstatExtraEntries];
}

/** Every curated ToolDef, with cache + downloader injected. */
export function createAllDatasetTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  return [
    ...createAcraTools(cache, downloader),
    ...createAllCuratedTools(cache, downloader),
    ...createSingstatExtraTools(cache, downloader),
    ...createRealtimeTools(cache, downloader),
  ];
}

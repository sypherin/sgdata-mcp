/**
 * Tool registry for sgdata-mcp.
 *
 * Aggregates tool definitions in an MCP-compatible shape so the server
 * entrypoint can iterate them. `createGenericTools(cache, downloader)` is the
 * factory for the layer-2 generic tools (work for any data.gov.sg dataset by
 * ID). Curated per-dataset tools live in src/datasets/ and follow the same
 * factory pattern (see createAllDatasetTools).
 */

import type { ZodSchema } from "zod";

import type { DatasetCache, DatasetDownloader } from "../core/index.js";
import {
  DatasetQueryInput,
  DatasetSchemaInput,
  SearchDatasetsInput,
  sgDatasetQuery,
  sgDatasetSchema,
  sgSearchDatasets,
} from "./generic.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: ZodSchema;
  handler: (input: any) => Promise<unknown>;
}

/**
 * Build the three "layer 2" tools that work against any dataset on
 * data.gov.sg. `sg_dataset_query` needs the shared cache + downloader so
 * we inject them here and capture them in the handler closure.
 */
export function createGenericTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  return [
    {
      name: "sg_search_datasets",
      description:
        "Search data.gov.sg for datasets matching a free-text keyword query. " +
        "Returns dataset IDs and high-level metadata (name, agency, format, " +
        "row count, last updated). Use this to discover datasets when no " +
        "curated sg_* tool exists, then pass the datasetId into " +
        "sg_dataset_schema or sg_dataset_query. Supports optional agency " +
        "and format filters.",
      inputSchema: SearchDatasetsInput,
      handler: (input: unknown) =>
        sgSearchDatasets(input as SearchDatasetsInput),
    },
    {
      name: "sg_dataset_schema",
      description:
        "Fetch the column schema and metadata for any data.gov.sg dataset by " +
        "ID. Returns the human column labels (use these as filter keys for " +
        "sg_dataset_query), agency, format, size, and last updated timestamp. " +
        "Cheap call — does not download the dataset itself.",
      inputSchema: DatasetSchemaInput,
      handler: (input: unknown) =>
        sgDatasetSchema(input as DatasetSchemaInput),
    },
    {
      name: "sg_dataset_query",
      description:
        "Query any data.gov.sg dataset by ID with simple exact-match and " +
        "substring (LIKE) filters, paginated. Automatically downloads and " +
        "caches the dataset locally on first use, refreshing if the cache " +
        "is older than 30 days. Filter keys must be the human column labels " +
        "from sg_dataset_schema.",
      inputSchema: DatasetQueryInput,
      handler: (input: unknown) =>
        sgDatasetQuery(input as DatasetQueryInput, cache, downloader),
    },
  ];
}

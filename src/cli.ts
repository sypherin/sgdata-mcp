#!/usr/bin/env node
/**
 * CLI mode for @altronis/sgdata-mcp.
 *
 * Usage:
 *   npx @altronis/sgdata-mcp query "What is Singapore's GDP growth?"
 *   npx @altronis/sgdata-mcp ask "latest dengue cases"
 *   npx @altronis/sgdata-mcp tool sg_coe_latest '{}'
 *   npx @altronis/sgdata-mcp list
 *   npx @altronis/sgdata-mcp datasets
 *
 * All output goes to stdout as JSON. Logs go to stderr.
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { DatasetCache, DatasetDownloader, registerDatasets } from "./core/index.js";
import { createGenericTools, type ToolDef } from "./tools/index.js";
import { allDatasetEntries, createAllDatasetTools } from "./datasets/index.js";
import { createVisualizationTools } from "./tools/visualization.js";
import { createCrossDatasetTools } from "./tools/cross_dataset.js";
import { createNlQueryTools } from "./tools/nl_query.js";

function log(msg: string): void {
  process.stderr.write(`[sgdata-cli] ${msg}\n`);
}

function resolveCacheDir(): string {
  const override = process.env["SGDATA_MCP_CACHE_DIR"];
  if (override?.trim()) return path.resolve(override);
  return path.join(homedir(), ".sgdata-mcp");
}

function buildAllTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): Map<string, ToolDef> {
  const tools: ToolDef[] = [
    ...createGenericTools(cache, downloader),
    ...createAllDatasetTools(cache, downloader),
    ...createVisualizationTools(),
    ...createCrossDatasetTools(cache, downloader),
  ];
  const byName = new Map<string, ToolDef>();
  for (const t of tools) byName.set(t.name, t);
  // NL query needs the full tool map
  for (const t of createNlQueryTools(byName)) byName.set(t.name, t);
  return byName;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(
      `sgdata-mcp CLI — Singapore government data at your fingertips

Usage:
  sgdata-mcp query "natural language question"     Ask in plain English
  sgdata-mcp ask "natural language question"        Alias for query
  sgdata-mcp tool <tool_name> [json_args]           Call a specific tool
  sgdata-mcp list                                   List all available tools
  sgdata-mcp datasets                               List all curated datasets

Examples:
  sgdata-mcp query "What is Singapore's unemployment rate?"
  sgdata-mcp query "Latest dengue cases this week"
  sgdata-mcp query "COE prices trend"
  sgdata-mcp tool sg_gdp_latest '{}'
  sgdata-mcp tool sg_crime_compare '{"year":"2024"}'
  sgdata-mcp tool sg_hawker_search '{"query":"tampines"}'
`,
    );
    process.exit(0);
  }

  const cacheDir = resolveCacheDir();
  mkdirSync(cacheDir, { recursive: true });
  const cache = new DatasetCache(cacheDir);
  const downloader = new DatasetDownloader(cache);
  registerDatasets(allDatasetEntries());
  const allTools = buildAllTools(cache, downloader);

  try {
    if (command === "list") {
      const tools = [...allTools.values()].map((t) => ({
        name: t.name,
        description: t.description,
      }));
      process.stdout.write(JSON.stringify({ count: tools.length, tools }, null, 2) + "\n");
    } else if (command === "datasets") {
      const { listDatasets } = await import("./core/registry.js");
      const ds = listDatasets();
      process.stdout.write(
        JSON.stringify(
          {
            count: ds.length,
            datasets: ds.map((d) => ({
              id: d.id,
              name: d.name,
              agency: d.agency,
              tags: d.tags,
            })),
          },
          null,
          2,
        ) + "\n",
      );
    } else if (command === "query" || command === "ask") {
      const question = args.slice(1).join(" ");
      if (!question) {
        log("error: provide a question after 'query'");
        process.exit(1);
      }
      const askTool = allTools.get("sg_ask");
      if (!askTool) {
        log("error: sg_ask tool not found");
        process.exit(1);
      }
      log(`querying: ${question}`);
      const result = await askTool.handler({ question });
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else if (command === "tool") {
      const toolName = args[1];
      if (!toolName) {
        log("error: provide tool name after 'tool'");
        process.exit(1);
      }
      const tool = allTools.get(toolName);
      if (!tool) {
        log(`error: unknown tool '${toolName}'`);
        log(`available: ${[...allTools.keys()].join(", ")}`);
        process.exit(1);
      }
      const rawArgs = args[2] ? JSON.parse(args[2]) : {};
      log(`calling ${toolName}`);
      const result = await tool.handler(rawArgs);
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      // Treat everything as a query
      const question = args.join(" ");
      const askTool = allTools.get("sg_ask");
      if (!askTool) {
        log("error: sg_ask tool not found");
        process.exit(1);
      }
      log(`querying: ${question}`);
      const result = await askTool.handler({ question });
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    }
  } finally {
    cache.close();
  }
}

main().catch((err) => {
  process.stderr.write(
    `[sgdata-cli] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});

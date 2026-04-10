#!/usr/bin/env node
/**
 * stdio MCP server for @altronis/sgdata-mcp.
 *
 * This is the binary published as `sgdata-mcp` — `npx @altronis/sgdata-mcp`
 * boots this file. It speaks JSON-RPC over stdio using the Model Context
 * Protocol and exposes every tool registered in src/tools/ to any MCP client
 * (Claude Desktop, Claude Code, Cursor, etc.).
 *
 * Responsibilities:
 *   1. Resolve a cache directory (env override, else ~/.sgdata-mcp).
 *   2. Construct the shared DatasetCache + DatasetDownloader pair.
 *   3. Build the tool registry: generic tools today, curated tools tomorrow.
 *   4. Wire `tools/list` + `tools/call` handlers on an MCP Server.
 *   5. Connect over StdioServerTransport and stay alive.
 *
 * stdout is reserved for MCP traffic — ALL logs go to stderr.
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodError } from "zod";

import { DatasetCache, DatasetDownloader, registerDatasets } from "./core/index.js";
import { createGenericTools, type ToolDef } from "./tools/index.js";
import { allDatasetEntries, createAllDatasetTools } from "./datasets/index.js";
import { createVisualizationTools } from "./tools/visualization.js";
import { createCrossDatasetTools } from "./tools/cross_dataset.js";
import { createNlQueryTools } from "./tools/nl_query.js";

// ---------------------------------------------------------------------------
// Env / paths
// ---------------------------------------------------------------------------

function resolveCacheDir(): string {
  const override = process.env["SGDATA_MCP_CACHE_DIR"];
  if (override && override.trim().length > 0) {
    return path.resolve(override);
  }
  return path.join(homedir(), ".sgdata-mcp");
}

// ---------------------------------------------------------------------------
// Logger — stderr only. stdout belongs to the MCP transport.
// ---------------------------------------------------------------------------

function log(msg: string): void {
  process.stderr.write(`[sgdata-mcp] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

function buildToolRegistry(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  const base: ToolDef[] = [
    ...createGenericTools(cache, downloader),
    ...createAllDatasetTools(cache, downloader),
    ...createVisualizationTools(),
    ...createCrossDatasetTools(cache, downloader),
  ];
  // NL query needs the full tool map to route queries
  const byName = new Map<string, ToolDef>();
  for (const t of base) byName.set(t.name, t);
  const nlTools = createNlQueryTools(byName);
  for (const t of nlTools) byName.set(t.name, t);
  return [...byName.values()];
}

// ---------------------------------------------------------------------------
// Zod -> JSON Schema. Strip the "$schema" header so MCP clients see a clean
// inputSchema object.
// ---------------------------------------------------------------------------

function toolInputJsonSchema(tool: ToolDef): Record<string, unknown> {
  try {
    const schema = zodToJsonSchema(tool.inputSchema, {
      $refStrategy: "none",
      target: "jsonSchema7",
    }) as Record<string, unknown>;
    // zod-to-json-schema wraps everything under a $schema header — strip it so
    // the object at top level is just the JSON Schema itself.
    delete schema["$schema"];
    // Guarantee the top-level `type` is "object" — MCP clients expect that.
    if (schema["type"] == null) {
      schema["type"] = "object";
    }
    return schema;
  } catch (err) {
    log(
      `warn: failed to convert zod schema for tool ${tool.name}: ${
        (err as Error).message
      }`,
    );
    return { type: "object" };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const cacheDir = resolveCacheDir();
  mkdirSync(cacheDir, { recursive: true });

  const cache = new DatasetCache(cacheDir);
  const downloader = new DatasetDownloader(cache);
  registerDatasets(allDatasetEntries());
  const tools = buildToolRegistry(cache, downloader);
  const byName = new Map<string, ToolDef>();
  for (const t of tools) byName.set(t.name, t);

  const server = new Server(
    {
      name: "sgdata-mcp",
      version: "0.3.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: toolInputJsonSchema(t),
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: rawArgs } = req.params;
    const tool = byName.get(name);
    if (!tool) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool "${name}". Known tools: ${[...byName.keys()].join(", ")}`,
      );
    }

    let parsedInput: unknown;
    try {
      parsedInput = tool.inputSchema.parse(rawArgs ?? {});
    } catch (err) {
      const zerr = err as ZodError;
      const issues = Array.isArray(zerr?.issues)
        ? zerr.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ")
        : (err as Error).message;
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments for tool "${name}": ${issues}`,
      );
    }

    try {
      const result = await tool.handler(parsedInput);
      return {
        content: [
          {
            type: "text" as const,
            text:
              result === undefined
                ? ""
                : typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new McpError(
        ErrorCode.InternalError,
        `Tool "${name}" failed: ${msg}`,
      );
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log(`ready (cache=${cacheDir}, tools=${tools.length})`);

  // Graceful shutdown so the SQLite WAL gets checkpointed.
  const shutdown = (signal: string) => {
    log(`shutting down on ${signal}`);
    try {
      cache.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  process.stderr.write(
    `[sgdata-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});

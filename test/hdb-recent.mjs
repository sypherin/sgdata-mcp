// HDB resale search/stats with no town or flat_type filter fetch one bounded page. That page must be the
// NEWEST rows. Before 0.5.5 it was the dataset's natural order, which starts Jan 2017, so "current" stats
// were 2017 prices and a month_from filter on recent months matched nothing (found 9 Nov 2026).
// Live against data.gov.sg. Run after `npm run build`: node test/hdb-recent.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/mcp-server.js"] });
const client = new Client({ name: "hdb-recent", version: "0.0.0" });
await client.connect(transport);

const call = async (name, args) => {
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  return JSON.parse(res.content[0].text);
};

// Data.gov.sg lags by a month or two; anything inside the last 6 months counts as recent.
const d = new Date();
d.setUTCMonth(d.getUTCMonth() - 6);
const recent = d.toISOString().slice(0, 7);

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
  if (!ok) failed++;
};

const search = await call("sg_hdb_resale_search", { limit: 5 });
const newest = (search.rows ?? []).map((r) => r.month).sort().at(-1) ?? "none";
check("search, no filter, returns recent rows", newest >= recent, `newest month ${newest}, want >= ${recent}`);

const stats = await call("sg_hdb_resale_stats", { month_from: recent });
check("stats, no town, month_from recent has rows", (stats.count ?? 0) > 0, `count ${stats.count}`);

// Filtered path: BEDOK (~12k rows) is fetched whole, so this guards the sorted paging, not the bug.
const town = await call("sg_hdb_resale_stats", { town: "BEDOK", month_from: recent });
check("stats, town filter, month_from recent has rows", (town.count ?? 0) > 0, `count ${town.count}`);

await client.close();
console.log(failed ? `${failed} failed` : "3 checks passed");
process.exit(failed ? 1 : 0);

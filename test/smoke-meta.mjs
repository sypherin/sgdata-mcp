// smoke: verify sg_tool_catalog + sg_dispatch over stdio (lazy-schema path)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/mcp-server.js"],
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

// 1. catalog (filtered) — the only schema a thin client ever sees
const cat = await client.callTool({
  name: "sg_tool_catalog",
  arguments: { filter: "acra" },
});
const parsed = JSON.parse(cat.content[0].text);
console.log(
  `[catalog filter=acra] count=${parsed.toolCount} sample=${parsed.tools.slice(0, 3).map((t) => t.name).join(", ")}`,
);

// 2. full catalog size check
const all = await client.callTool({ name: "sg_tool_catalog", arguments: {} });
const allP = JSON.parse(all.content[0].text);
console.log(`[catalog all] count=${allP.toolCount}`);
if (allP.tools.some((t) => t.name === "sg_dispatch"))
  throw new Error("meta-tools must not list themselves");

// 3. dispatch a real curated tool — DBS UEN (has 24h cache from earlier runs)
const t0 = Date.now();
const res = await client.callTool({
  name: "sg_dispatch",
  arguments: { tool: "acra_query_uen", args: { uen: "196800306E" } },
});
const body = JSON.parse(res.content[0].text);
const hit = JSON.stringify(body).includes("DBS");
console.log(
  `[dispatch acra_query_uen] DBS=${hit} ms=${Date.now() - t0}`,
);
if (!hit) throw new Error("dispatch did not return DBS record");

// 4. unknown tool → clean error
try {
  await client.callTool({
    name: "sg_dispatch",
    arguments: { tool: "nonexistent_tool", args: {} },
  });
  console.log("[dispatch unknown] FAIL: no error raised");
  process.exit(1);
} catch (e) {
  console.log(`[dispatch unknown] ok: ${String(e.message).slice(0, 60)}`);
}

await client.close();
console.log("SMOKE PASS");

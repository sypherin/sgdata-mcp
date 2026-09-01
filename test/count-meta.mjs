// quick count: list tools as a client with includeTools=[sg_tool_catalog,sg_dispatch]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/mcp-server.js"],
});
const client = new Client({ name: "count", version: "0.0.0" });
await client.connect(transport);
const tools = await client.listTools();
const names = tools.tools.map(t => t.name);
console.log(`Total tools: ${names.length}`);
const meta = names.filter(n => n.includes("tool") || n.includes("dispatch") || n.includes("catalog"));
console.log(`Meta tools: ${meta.join(", ")}`);
console.log(`Non-meta: ${names.length - meta.length}`);
await client.close();

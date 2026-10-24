// sg_dispatch must check args against the target tool's schema, exactly as a direct call does,
// so a missing or wrongly typed arg comes back as "Invalid arguments" and never reaches the handler.
// Run after `npm run build`: node test/dispatch-validate.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/mcp-server.js"] });
const client = new Client({ name: "dispatch-validate", version: "0.0.0" });
await client.connect(transport);

const viaDispatch = (args) => ({ name: "sg_dispatch", arguments: { tool: "sg_acra_get_entity", args } });
const cases = [
  ["dispatch, missing uen", viaDispatch({})],
  ["dispatch, uen as a number", viaDispatch({ uen: 196800306 })],
  ["direct call, missing uen", { name: "sg_acra_get_entity", arguments: {} }],
];
let failed = 0;
for (const [label, params] of cases) {
  let msg = "";
  try {
    const res = await client.callTool(params, undefined, { timeout: 120000 });
    msg = `no error, handler ran: ${JSON.stringify(res).slice(0, 120)}`;
  } catch (e) {
    msg = String(e.message);
  }
  const ok =
    msg.includes("-32602") &&
    !msg.includes("-32603") &&
    msg.includes('Invalid arguments for tool "sg_acra_get_entity"') &&
    msg.includes("uen");
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${msg.slice(0, 160)}`);
  if (!ok) failed++;
}

await client.close();
console.log(failed ? `${failed}/${cases.length} FAILED` : `${cases.length}/${cases.length} passed`);
process.exit(failed ? 1 : 0);

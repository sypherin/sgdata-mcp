#!/usr/bin/env node
/**
 * Full per-tool QC harness — calls EVERY tool over real MCP stdio and reports
 * PASS / WARN / FAIL. Run after build:  node test/test-all-tools.mjs
 *
 * Phase 1 harvests valid args (a dataset id, a UEN, a carpark no, a disease)
 * from the discovery tools, then Phase 2 calls all 74 tools.
 *
 * Notes baked in from the 2026-06-04 QC run:
 *  - base_year/target_year on sg_employment_growth are NUMBERS, not strings.
 *  - sg_gdp_industry_compare quarter format is "2025Q4", not "2023-Q4".
 *  - Big datasets (ACRA ~135k, HDB resale) download+cache on first call → need
 *    generous timeouts; sequential 30s windows cause a false cascade of timeouts.
 *  - sg_dataset_query downloads the WHOLE dataset then slices, so it times out on
 *    huge datasets (e.g. Historical Rainfall). Use a normal-sized datasetId.
 */
import { spawn } from "node:child_process";
const SERVER = process.env.HOME + "/sg-data-mcp/dist/mcp-server.js";
const srv = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
let buf = ""; const pending = new Map();
srv.stdout.on("data", d => { buf += d.toString(); let i;
  while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!l.trim()) continue; let m; try { m = JSON.parse(l); } catch { continue; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } });
srv.stderr.on("data", () => {});
let id = 0;
function rpc(method, params, ms = 180000) {
  return new Promise(res => { const myId = ++id; pending.set(myId, res);
    srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
    setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); res({ __timeout: true }); } }, ms); });
}
async function call(name, args, ms = 180000) {
  const r = await rpc("tools/call", { name, arguments: args }, ms);
  if (r.__timeout) return { name, status: "FAIL", note: `timeout(${ms / 1000}s)` };
  if (r.error) return { name, status: "FAIL", note: "rpc:" + (r.error.message || "").slice(0, 90) };
  const text = r.result?.content?.[0]?.text || JSON.stringify(r.result).slice(0, 200);
  let p; try { p = JSON.parse(text); } catch {}
  if (r.result?.isError || p?.error) return { name, status: "WARN", note: (p?.error || text).toString().slice(0, 110) };
  return { name, status: "PASS", note: text.replace(/\s+/g, " ").slice(0, 90) };
}
function findKey(o, keys, d = 0) { if (!o || d > 4) return null;
  if (Array.isArray(o)) { for (const x of o) { const v = findKey(x, keys, d + 1); if (v) return v; } return null; }
  if (typeof o === "object") for (const k of Object.keys(o)) { if (keys.includes(k) && o[k]) return o[k];
    const v = findKey(o[k], keys, d + 1); if (v) return v; } return null; }
async function harvest(name, args, keys) { const r = await rpc("tools/call", { name, arguments: args });
  try { return findKey(JSON.parse(r.result.content[0].text), keys); } catch { return null; } }

await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "qc", version: "1" } });
srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const UEN = await harvest("sg_acra_search_entities", { query: "pte", limit: 3 }, ["uen", "UEN"]) || "201405571M";
const CARPARK = await harvest("sg_hdb_carparks_by_address", { query: "bedok", limit: 3 }, ["car_park_no", "carParkNo"]) || "ACB";
const DISEASE = await harvest("sg_disease_list", {}, ["disease", "name"]) || "Dengue Fever";
const SMALL_DS = "d_ca0b908cf06a267ca06acbd5feb4465c"; // crime (small) — for generic query

const ARGS = {
  sg_search_datasets: { query: "resale", limit: 3 }, sg_dataset_schema: { datasetId: SMALL_DS }, sg_dataset_query: { datasetId: SMALL_DS, limit: 3 },
  sg_acra_search_entities: { query: "pte", limit: 3 }, sg_acra_get_entity: { uen: UEN }, sg_acra_formations_by_ssic: { ssic_prefix: "62", year: "2023" },
  sg_hdb_resale_search: { town: "BEDOK", limit: 3 }, sg_hdb_resale_stats: { town: "BEDOK" },
  sg_coe_latest: {}, sg_coe_history: { vehicle_class: "A", months_back: 6 }, sg_coe_demand_supply: { vehicle_class: "A", months_back: 6 },
  sg_moe_search_schools: { query: "primary", limit: 3 }, sg_moe_school_by_name: { name: "Raffles" }, sg_moe_schools_near: { postal_code: "560123" },
  sg_hdb_carpark_lookup: { car_park_no: CARPARK }, sg_hdb_carparks_by_address: { query: "bedok", limit: 3 }, sg_hdb_carparks_by_type: { limit: 3 },
  sg_gdp_latest: {}, sg_gdp_history: { industry: "Manufacturing", quarters_back: 4 }, sg_gdp_industry_compare: { quarter: "2025Q4" },
  sg_cpi_latest: {}, sg_cpi_history: { category: "All Items", months_back: 6 }, sg_cpi_yoy: { category: "All Items" },
  sg_median_income_lookup: {}, sg_median_income_history: {},
  sg_employment_by_sector: {}, sg_employment_sector_history: { sector: "Manufacturing", years_back: 5 }, sg_employment_growth: { sector: "Manufacturing", base_year: 2018, target_year: 2023 },
  sg_ura_private_txn_latest: {}, sg_ura_private_txn_history: {}, sg_ura_new_sale_pipeline: {},
  sg_visitors_latest: {}, sg_visitors_history: {}, sg_visitors_top_sources: {},
  sg_retail_sales_latest: {}, sg_retail_sales_history: {}, sg_retail_sales_yoy: { category: "Total" },
  sg_fx_rate: { currency: "USD" }, sg_fx_history: { currency: "USD", months_back: 6 }, sg_fx_basket: {},
  sg_iras_collection: {}, sg_iras_collection_history: { tax_type: "Corporate Income Tax", years_back: 5 }, sg_iras_tax_mix: { financial_year: "2022" },
  sg_ecda_search_centres: { query: "child", limit: 3 }, sg_ecda_centres_near: { postal_code: "560123" }, sg_ecda_vacancy_summary: { level: "infant" },
  sg_unemployment_latest: {}, sg_unemployment_history: { residential_status: "resident" },
  sg_population_latest: {}, sg_population_history: { indicator: "Total Population" },
  sg_disease_latest: {}, sg_disease_trend: { disease: DISEASE }, sg_disease_list: {},
  sg_electricity_latest: {}, sg_electricity_history: { source: "Total" },
  sg_births_latest: {}, sg_births_history: { category: "Total" },
  sg_crime_latest: {}, sg_crime_history: { crime_type: "Total" }, sg_crime_compare: { year: "2023" },
  sg_tourism_latest: {}, sg_tourism_history: { component: "Total" },
  sg_hawker_search: { query: "bedok" }, sg_hawker_stats: {},
  sg_formations_latest: {}, sg_formations_history: { ssic: "62", years_back: 5 }, sg_formations_compare: { year: "2023" }, sg_formations_monthly: { ssic: "62" }, sg_cessations_monthly: { ssic: "62" }, sg_net_formations: { ssic: "62" },
  sg_visualize: { title: "Test", labels: ["2021", "2022", "2023"], values: [1.8, 2.0, 1.9], unit: "%" }, sg_cross_dataset: { dataset_a: "cpi_monthly", dataset_b: "retail_sales", limit: 5 }, sg_list_datasets: {}, sg_ask: { question: "What is Singapore's unemployment rate?" },
};

const tools = (await rpc("tools/list", {})).result.tools.map(t => t.name);
const results = [];
for (const name of tools) results.push(await call(name, ARGS[name] ?? {}));
for (const r of results) console.log(`${r.status === "PASS" ? "✅" : r.status === "WARN" ? "⚠️ " : "❌"} ${r.name.padEnd(30)} ${r.note}`);
const by = s => results.filter(r => r.status === s);
console.log(`\nSUMMARY: ${by("PASS").length} PASS · ${by("WARN").length} WARN · ${by("FAIL").length} FAIL / ${results.length}`);
srv.kill(); process.exit(by("FAIL").length ? 1 : 0);

// data.gov.sg rate-limits keyless calls (datastore_search: about 4 per 10s) and answers 429. A 429 must be
// retried after a wait, not surfaced as a failed tool call; anything else (404, 500) still fails at once.
// Offline: stubs global fetch. Run after `npm run build`: node test/retry-429.mjs
import { datastoreSearch } from "../dist/core/datagov-api.js";

const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const status = (code, headers = {}) => new Response("slow down", { status: code, headers });
const page = { success: true, result: { records: [{ month: "2026-11" }], total: 1 } };

let failed = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}  ${detail}`);
  if (!cond) failed++;
};

async function run(responses, opts) {
  let calls = 0;
  globalThis.fetch = async () => responses[Math.min(calls++, responses.length - 1)]();
  try {
    const r = await datastoreSearch("d_test", { limit: 1 }, opts);
    return { calls, records: r.records.length, error: "" };
  } catch (e) {
    return { calls, records: 0, error: String(e.message) };
  }
}

let t0;
let r = await run([() => status(429, { "Retry-After": "0" }), () => ok(page)]);
check("one 429 then 200 is retried", r.records === 1 && r.calls === 2, JSON.stringify(r));

r = await run([() => status(429, { "Retry-After": "0" })]);
check("429 every time gives up with the 429", r.error.includes("429") && r.calls === 5, JSON.stringify(r).slice(0, 120));

t0 = Date.now();
r = await run([() => status(429, { "Retry-After": "60" }), () => ok(page)]);
check("Retry-After past the 15s budget fails at once, no long hang", r.error.includes("429") && r.calls === 1 && Date.now() - t0 < 2000, JSON.stringify(r).slice(0, 100));

t0 = Date.now();
r = await run([() => status(429), () => ok(page)]);
const waited = Date.now() - t0;
check("429 without Retry-After waits about 1s", r.records === 1 && waited >= 900 && waited < 10000, `${waited}ms`);

r = await run([() => status(429, { "Retry-After": "0" }), () => ok(page)], { retry429: false });
check("retry429:false (ACRA runs its own backoff) fails at once", r.error.includes("429") && r.calls === 1, JSON.stringify(r).slice(0, 120));

r = await run([() => status(500), () => ok(page)]);
check("500 is not retried", r.error.includes("500") && r.calls === 1, JSON.stringify(r).slice(0, 120));

console.log(failed ? `${failed} failed` : "6 checks passed");
process.exit(failed ? 1 : 0);

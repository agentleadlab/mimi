import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mimi-api-"));
const realFetch = globalThis.fetch;
const CSV =
  "Sample Name,Vertical,Campaign/Context,Date Added,Loom Link,Tags\n" +
  "Text-Verified VET PLUS,Veterans,x,,https://www.loom.com/share/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,\n" +
  "Text-Verified VET Widows,Veterans,x,,https://www.loom.com/share/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb,\n" +
  "Text-Verified Final Expense,Final Expense,x,,https://www.loom.com/share/cccccccccccccccccccccccccccccccc,\n" +
  "Text-Verified Mortgage Protection Standard,Mortgage Protection,x,,https://www.loom.com/share/dddddddddddddddddddddddddddddddd,\n" +
  "Text-Verified Mortgage Protection Plus,Mortgage Protection,x,,https://www.loom.com/share/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee,\n" +
  "Instant Spanish IUL,Spanish IUL,x,,https://www.loom.com/share/ffffffffffffffffffffffffffffffff,\n" +
  "Text-Verified VET PLUS 2.0,Veterans,x,,https://www.loom.com/share/abababababababababababababababab,\n";
const TOKEN = "test-token-1234567890";
let server, base, api, notes;

before(async () => {
  process.env.MIMI_DATA_DIR = dataDir;
  process.env.PUBLIC_URL = "https://mimi.example";
  process.env.SAMPLES_SHEET_URL = "https://docs.google.com/spreadsheets/d/abc/edit";
  process.env.MIMI_API_TOKEN = TOKEN;
  globalThis.fetch = async (url, opts) => (String(url).startsWith("http://127.0.0.1") ? realFetch(url, opts) : new Response(CSV));
  api = await import("../src/api/samplesApi.js");
  notes = [];
  server = http.createServer((req, res) => api.handleApi(req, res, { onSampleCreated: (n) => notes.push(n) }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  globalThis.fetch = realFetch;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const call = (pathname, { method = "POST", body, token = TOKEN } = {}) =>
  fetch(`${base}${pathname}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
    ...(body && { body: JSON.stringify(body) }),
  }).then(async (r) => ({ status: r.status, headers: r.headers, json: await r.json() }));

test("rejects a missing or wrong key", async () => {
  assert.equal((await call("/api/samples", { token: null, body: {} })).status, 401);
  assert.equal((await call("/api/samples", { token: "nope", body: {} })).status, 401);
});

test("lists lead type words built from the sample names", async () => {
  const r = await call("/api/lead-types", { method: "GET" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.lead_types, ["vet plus", "vet widows", "final expense", "mortgage protection standard", "mortgage protection plus", "instant spanish iul", "vet plus 2.0"]);
  assert.equal(r.json.watch_seconds, 150);
});

test("creates one gated link per request_id, and repeats return the same link", async () => {
  const body = { lead_type: "vet plus", client_name: "Jordan Ellis", client_ref: "cl_8842", request_id: "req-1", source: "profile" };
  const first = await call("/api/samples", { body });
  assert.equal(first.status, 200);
  assert.equal(first.json.ok, true);
  assert.match(first.json.url, /^https:\/\/mimi\.example\/p\/[A-Za-z0-9_-]+$/);
  assert.equal(first.json.watch_seconds, 150);
  assert.ok(Date.parse(first.json.expires_at) > Date.now() + 6 * 86400e3);
  assert.equal(notes.length, 1);

  const again = await call("/api/samples", { body: { ...body, lead_type: "final expense" } });
  assert.equal(again.json.url, first.json.url);
  assert.equal(again.json.repeat, true);
  assert.equal(notes.length, 1); // no second sample, no second note
});

test("matches short forms; vague or unknown lead types get the valid list", async () => {
  const fex = await call("/api/samples", { body: { lead_type: "FEX", client_name: "A B", request_id: "req-2" } });
  assert.equal(fex.json.lead_type, "final expense");
  const mp = await call("/api/samples", { body: { lead_type: "MP Standard", client_name: "A B", request_id: "req-3" } });
  assert.equal(mp.json.lead_type, "mortgage protection standard");
  const v2 = await call("/api/samples", { body: { lead_type: "VET PLUS 2", client_name: "A B", request_id: "req-5" } });
  assert.equal(v2.json.lead_type, "vet plus 2.0");
  const v1 = await call("/api/samples", { body: { lead_type: "Text-Verified VET PLUS", client_name: "A B", request_id: "req-6" } });
  assert.equal(v1.json.lead_type, "vet plus");
  const vague = await call("/api/samples", { body: { lead_type: "vets", client_name: "A B", request_id: "req-4" } });
  assert.equal(vague.status, 400);
  assert.equal(vague.json.error, "unknown_lead_type");
  assert.ok(vague.json.lead_types.includes("vet widows"));
});

test("validates input and never accepts personal data as client_ref", async () => {
  assert.equal((await call("/api/samples", { body: { lead_type: "vet plus" } })).json.error, "missing_request_id");
  assert.equal((await call("/api/samples", { body: { request_id: "x" } })).json.error, "missing_lead_type");
  assert.equal((await call("/api/samples", { body: { lead_type: "vet plus", request_id: "y", client_ref: "+1 917 232 0096" } })).json.error, "client_ref_personal");
  assert.equal((await call("/api/samples", { body: { lead_type: "vet plus", request_id: "z", client_ref: "a@b.com" } })).json.error, "client_ref_personal");
  assert.equal((await call("/api/samples", { method: "GET" })).status, 405);
});

test("the test name is flagged as a test", async () => {
  const r = await call("/api/samples", { body: { lead_type: "vet widows", client_name: "Test Client", request_id: "req-test-1" } });
  assert.equal(r.json.test, true);
  assert.equal(notes.at(-1).test, true);
});

test("rate limits bursts with 429 and Retry-After", async () => {
  api._resetRateLimit();
  let last;
  for (let i = 0; i < 31; i++) last = await call("/api/samples", { body: { lead_type: "vet plus", client_name: "Burst", request_id: `burst-${i}` } });
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get("retry-after")) > 0);
});

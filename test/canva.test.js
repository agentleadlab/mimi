import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Fake Canva API: records calls and answers from `routes`.
const calls = [];
let routes = {};
const realFetch = globalThis.fetch;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mimi-test-"));

let runCanvaTool, setState, getState;

before(async () => {
  process.env.MIMI_DATA_DIR = dataDir;
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const key = `${opts.method ?? "GET"} ${u.host}${u.pathname}`;
    calls.push({ key, url: u, opts });
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ code: "not_found", message: `no route ${key}` }), { status: 404 });
    const [status, body] = await handler(u, opts);
    return Buffer.isBuffer(body) ? new Response(body, { status }) : new Response(JSON.stringify(body), { status });
  };
  ({ runCanvaTool } = await import("../src/canva/tools.js"));
  ({ setState, getState } = await import("../src/store.js"));
});

after(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function reset(token = { accessToken: "tok", refreshToken: "ref", expiresAt: Date.now() + 3600e3 }) {
  calls.length = 0;
  routes = {};
  setState("canva", token);
}

const design = (id) => ({ id, title: id, urls: { edit_url: `https://canva.com/${id}/edit`, view_url: `https://canva.com/${id}/view` } });

test("not connected gives a clear message", async () => {
  reset(null);
  const r = await runCanvaTool("canva_search_designs", {});
  assert.equal(r.isError, true);
  assert.match(r.content, /\/canva connect/);
});

test("autofill maps text and uploaded images, and reports per-row results", async () => {
  reset();
  let autofillN = 0;
  routes = {
    "GET cdn.discordapp.com/photo.png": async () => [200, Buffer.from("PNGDATA")],
    "POST api.canva.com/rest/v1/asset-uploads": async (_u, opts) => {
      assert.equal(opts.headers["Content-Type"], "application/octet-stream");
      assert.ok(JSON.parse(opts.headers["Asset-Upload-Metadata"]).name_base64);
      return [200, { job: { id: "up1", status: "success", asset: { id: "A1" } } }];
    },
    "POST api.canva.com/rest/v1/autofills": async (_u, opts) => {
      const body = JSON.parse(opts.body);
      autofillN++;
      if (autofillN === 2) return [403, { code: "permission_denied", message: "no autofill" }];
      assert.equal(body.type, "create_from_brand_template");
      assert.deepEqual(body.data.HEADLINE, { type: "text", text: "12 Oak St" });
      assert.deepEqual(body.data.PHOTO, { type: "image", asset_id: "A1" });
      return [200, { job: { id: "J1", status: "in_progress" } }];
    },
    "GET api.canva.com/rest/v1/autofills/J1": async () => [
      200,
      { job: { id: "J1", status: "success", result: { type: "create_design", design: design("D1") } } },
    ],
  };

  const r = await runCanvaTool("canva_autofill", {
    brand_template_id: "BT1",
    designs: [
      { title: "Oak", fields: { HEADLINE: "12 Oak St", PHOTO: { image_url: "https://cdn.discordapp.com/photo.png" } } },
      { title: "Pine", fields: { HEADLINE: "9 Pine Ave" } },
    ],
  });
  assert.equal(r.isError, false);
  const { results } = JSON.parse(r.content);
  assert.equal(results[0].design.edit_url, "https://canva.com/D1/edit");
  assert.match(results[1].error, /Pro\/Teams\/Enterprise/);
});

test("export returns download links", async () => {
  reset();
  routes = {
    "POST api.canva.com/rest/v1/exports": async (_u, opts) => {
      assert.deepEqual(JSON.parse(opts.body), { design_id: "D1", format: { type: "png" } });
      return [200, { job: { id: "E1", status: "success", urls: ["https://export/1.png"] } }];
    },
  };
  const r = await runCanvaTool("canva_export", { design_id: "D1", format: "png" });
  assert.deepEqual(JSON.parse(r.content).download_urls, ["https://export/1.png"]);
});

test("expired access token is refreshed once and the rotated refresh token saved", async () => {
  reset({ accessToken: "old", refreshToken: "ref1", expiresAt: Date.now() - 1000 });
  process.env.CANVA_CLIENT_ID ??= "cid";
  routes = {
    "POST api.canva.com/rest/v1/oauth/token": async (_u, opts) => {
      assert.equal(new URLSearchParams(opts.body).get("refresh_token"), "ref1");
      return [200, { access_token: "new", refresh_token: "ref2", expires_in: 14400 }];
    },
    "GET api.canva.com/rest/v1/designs": async (_u, opts) => {
      assert.equal(opts.headers.Authorization, "Bearer new");
      return [200, { items: [design("D9")] }];
    },
  };
  const [a, b] = await Promise.all([
    runCanvaTool("canva_search_designs", { query: "promo" }),
    runCanvaTool("canva_search_designs", {}),
  ]);
  assert.equal(a.isError, false);
  assert.equal(b.isError, false);
  assert.equal(calls.filter((c) => c.key.endsWith("/oauth/token")).length, 1);
  assert.equal(getState("canva").refreshToken, "ref2");
});

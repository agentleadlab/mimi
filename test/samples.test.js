import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mimi-samples-"));
let lib, links;

before(async () => {
  process.env.MIMI_DATA_DIR = dataDir;
  process.env.PUBLIC_URL ??= "https://mimi.example";
  lib = await import("../src/samples/library.js");
  links = await import("../src/samples/links.js");
});
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const CSV = `Sample Name,Vertical,Campaign/Context,Date Added,Loom Link,Tags
Text-Verified Trucker ,Truckers,Truckers V1,2026-09-03,https://www.loom.com/share/45dfa883b17a4ea2abf42e217d2145cf,"owner-operator, truckers"
"Text-Verified VET PLUS - 1",Veterans,Text-Verified VET PLUS,2026-09-03,https://www.loom.com/share/aaaabbbbccccdddd1111,"veterans, army"
Text-Verified VET Standard - 1,Veterans,VET Standards,2026-09-03,https://www.loom.com/share/aaaabbbbccccdddd2222?sid=x,"veterans, widows"
No Link Yet,IUL,,,,
`;

test("sheet URLs become CSV export URLs", () => {
  assert.equal(
    lib.csvExportUrl("https://docs.google.com/spreadsheets/d/ABC123/edit?usp=sharing"),
    "https://docs.google.com/spreadsheets/d/ABC123/export?format=csv",
  );
  assert.equal(
    lib.csvExportUrl("https://docs.google.com/spreadsheets/d/ABC123/edit#gid=42"),
    "https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&gid=42",
  );
});

test("parses the sheet by header names, trims, splits tags, skips rows without a Loom link", () => {
  const samples = lib.rowsToSamples(lib.parseCsv(CSV));
  assert.equal(samples.length, 3);
  assert.equal(samples[0].name, "Text-Verified Trucker");
  assert.deepEqual(samples[0].tags, ["owner-operator", "truckers"]);
  assert.equal(samples[0].loomId, "45dfa883b17a4ea2abf42e217d2145cf");
  assert.equal(samples[2].loomId, "aaaabbbbccccdddd2222");
  assert.deepEqual(lib.verticalsOf(samples), ["Truckers", "Veterans"]);
});

test("search matches lead type exactly first, then names/tags", () => {
  const samples = lib.rowsToSamples(lib.parseCsv(CSV));
  assert.equal(lib.searchSamples(samples, "veterans").length, 2);
  assert.equal(lib.searchSamples(samples, "army").length, 1);
  assert.equal(lib.searchSamples(samples, "owner-operator")[0].vertical, "Truckers");
  assert.equal(lib.searchSamples(samples, "nothing-here").length, 0);
});

test("preview link: unopened for days, then 15 minutes from first open", () => {
  const [sample] = lib.rowsToSamples(lib.parseCsv(CSV));
  const { token, url } = links.createPreviewLink(sample, { requestedBy: "Kath", client: "John" });
  assert.match(url, /^https:\/\/mimi\.example\/p\/[A-Za-z0-9_-]+$/);

  const t0 = Date.now();
  const first = links.visitLink(token, t0 + 60_000);
  assert.equal(first.status.state, "open");
  assert.equal(first.status.endsAt, t0 + 60_000 + 15 * 60_000);

  // Reopening inside the window doesn't extend it.
  assert.equal(links.visitLink(token, t0 + 10 * 60_000).status.endsAt, first.status.endsAt);
  assert.equal(links.visitLink(token, t0 + 17 * 60_000).status.state, "expired");

  const log = links.recentLinks(1)[0];
  assert.equal(log.client, "John");
  assert.equal(log.requestedBy, "Kath");
  assert.equal(log.opens, 2); // the expired visit isn't counted
});

test("never-opened links expire after 7 days; unknown tokens are invalid", () => {
  const [sample] = lib.rowsToSamples(lib.parseCsv(CSV));
  const { token } = links.createPreviewLink(sample, {});
  assert.equal(links.visitLink(token, Date.now() + 8 * 24 * 3600_000).status.state, "expired");
  assert.equal(links.visitLink("doesNotExist123").status.state, "missing");
});

test("page: GET shows a start screen without starting the timer; POST starts it", async () => {
  const { servePreview } = await import("../src/samples/page.js");
  const [sample] = lib.rowsToSamples(lib.parseCsv(CSV));
  const { token } = links.createPreviewLink(sample, {});
  const call = (method) => {
    const out = {};
    servePreview({ method }, { writeHead: (status, headers) => Object.assign(out, { status, headers }), end: (body) => (out.body = body) }, token);
    return out;
  };

  const get1 = call("GET");
  assert.equal(get1.status, 200);
  assert.match(get1.body, /Watch sample/);
  assert.doesNotMatch(get1.body, /loom\.com/);
  assert.equal(links.peekLink(token).status.state, "unopened"); // link previews don't start it

  const post = call("POST");
  assert.equal(post.status, 303);
  const get2 = call("GET");
  assert.match(get2.body, /loom\.com\/embed\//);
  assert.match(get2.body, /Preview ends in/);
});

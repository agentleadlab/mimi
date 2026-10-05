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

test("log sheet gets created/opened events with a short ID, never the link token", async () => {
  const { config } = await import("../src/config.js");
  config.samplesLogUrl = "https://script.example/exec";
  config.samplesLogSecret = "s3cret";
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    sent.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ ok: true }));
  };
  try {
    const [sample] = lib.rowsToSamples(lib.parseCsv(CSV));
    const { token } = links.createPreviewLink(sample, { requestedBy: "Kath", client: "John" });
    links.visitLink(token);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(sent.map((e) => e.event), ["created", "opened"]);
    assert.equal(sent[0].id, sent[1].id);
    assert.equal(sent[0].secret, "s3cret");
    assert.equal(sent[0].client, "John");
    assert.ok(!JSON.stringify(sent).includes(token));
  } finally {
    globalThis.fetch = realFetch;
    config.samplesLogUrl = config.samplesLogSecret = undefined;
  }
});

test("player shows who it's prepared for (escaped)", async () => {
  const { servePreview } = await import("../src/samples/page.js");
  const [sample] = lib.rowsToSamples(lib.parseCsv(CSV));
  const { token } = links.createPreviewLink(sample, { client: "John <Smith>" });
  const out = {};
  const res = { writeHead: (status) => (out.status = status), end: (body) => (out.body = body) };
  servePreview({ method: "POST" }, res, token);
  servePreview({ method: "GET" }, res, token);
  assert.match(out.body, /Prepared for John &#60;Smith&#62;/);
  assert.doesNotMatch(out.body, /<Smith>/);
});

test("/samples add validates input and writes the row through the sheet script", async () => {
  const { config } = await import("../src/config.js");
  const { samplesCommand } = await import("../src/samples/command.js");
  config.samplesSheetUrl = "https://docs.google.com/spreadsheets/d/TEST/edit";
  config.samplesLogUrl = "https://script.example/exec";
  config.samplesLogSecret = "s3cret";
  const posted = [];
  let scriptReply = { ok: true, row: 13 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("docs.google.com")) return new Response(CSV);
    posted.push(JSON.parse(opts.body));
    return new Response(JSON.stringify(scriptReply));
  };
  const run = async (opts, { admin = true } = {}) => {
    let reply;
    const interaction = {
      deferReply: async () => {},
      editReply: async (m) => (reply = m),
      memberPermissions: { has: () => admin },
      member: { displayName: "Kath" },
      user: {},
      options: {
        getSubcommand: () => "add",
        getString: (k) => opts[k] ?? null,
      },
    };
    await samplesCommand.handle(interaction);
    return reply;
  };
  try {
    const good = { name: "VET PLUS - 9", lead_type: "veterans", loom: "https://www.loom.com/share/0123456789abcdef0123?sid=1", tags: "veterans, navy" };
    assert.match(await run(good, { admin: false }), /Manage Server/);
    assert.match(await run({ ...good, loom: "https://youtube.com/x" }), /Loom video link/);
    assert.match(await run({ ...good, name: "text-verified trucker" }), /already a sample named/);
    assert.match(await run({ ...good, loom: "https://www.loom.com/share/45dfa883b17a4ea2abf42e217d2145cf" }), /already in the library/);
    assert.equal(posted.length, 0);

    assert.match(await run(good), /Added \*\*VET PLUS - 9\*\* to \*\*Veterans\*\*/);
    assert.deepEqual(posted[0].sample, {
      name: "VET PLUS - 9",
      leadType: "Veterans",
      campaign: "VET PLUS - 9",
      loom: "https://www.loom.com/share/0123456789abcdef0123",
      tags: "veterans, navy",
    });

    scriptReply = { ok: true }; // old script without addSample
    assert.match(await run({ ...good, name: "Another", loom: "https://www.loom.com/share/ffffeeeeddddcccc9999" }), /out of date/);
  } finally {
    globalThis.fetch = realFetch;
    config.samplesLogUrl = config.samplesLogSecret = config.samplesSheetUrl = undefined;
  }
});

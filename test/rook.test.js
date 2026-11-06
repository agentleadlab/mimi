import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mimi-rook-"));
const realFetch = globalThis.fetch;
const CSV =
  "Sample Name,Vertical,Campaign/Context,Date Added,Loom Link,Tags\n" +
  "Text-Verified VET PLUS,Veterans,x,,https://www.loom.com/share/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,veterans\n" +
  "Text-Verified VET Widows,Veterans,x,,https://www.loom.com/share/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb,widows\n" +
  "Text-Verified Mortgage Protection Standard,Mortgage Protection,x,,https://www.loom.com/share/cccccccccccccccccccccccccccccccc,mp\n";
let tools, req, fmt;

before(async () => {
  process.env.MIMI_DATA_DIR = dataDir;
  process.env.PUBLIC_URL = "https://mimi.example";
  process.env.SAMPLES_SHEET_URL = "https://docs.google.com/spreadsheets/d/abc/edit";
  globalThis.fetch = async () => new Response(CSV);
  tools = await import("../src/rook/tools.js");
  req = await import("../src/rook/requests.js");
  fmt = await import("../src/rook/format.js");
});
after(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const ctx = () => ({ requester: "Rook", rook: { parts: [], homeChannelId: "chan-1", channelId: "chan-1" } });

test("vague request: Mimi asks Rook to clarify, then sends the link when the answer comes back", async () => {
  // Rook: "Aiden asks: can you send me a sample for Vets?"  (also wants MP Standard, which is clear)
  const c1 = ctx();
  await tools.runRookTool("send_samples_to_rook", { client: "Aiden Adair", sample_names: ["Text-Verified Mortgage Protection Standard"] }, c1);
  const ask = JSON.parse(
    (
      await tools.runRookTool(
        "ask_rook_to_clarify",
        { client: "Aiden Adair", requested: "a sample for Vets", question_for_client: "Which Vet ad would you like to see: VET PLUS or VET Widows?", options: ["text-verified vet plus", "Text-Verified VET Widows"] },
        c1,
      )
    ).content,
  );
  const ref = ask.ref;
  assert.match(ref, /^AS-\d+$/);
  assert.equal(req.openRequestsIn("chan-1").length, 1);

  const msg = fmt.formatForRook(c1.rook.parts, "777");
  assert.ok(msg.startsWith("<@777> ✅ AD SAMPLES for Aiden Adair"));
  assert.match(msg, /Text-Verified Mortgage Protection Standard: https:\/\/mimi\.example\/p\//);
  assert.match(msg, new RegExp(`❓ NEED CLARIFICATION for Aiden Adair \\(REF ${ref}\\)`));
  assert.match(msg, /Please ask the client: "Which Vet ad would you like to see: VET PLUS or VET Widows\?"/);
  assert.match(msg, /Options: Text-Verified VET PLUS \| Text-Verified VET Widows/);

  // Rook comes back: "Aiden: the widows one (REF AS-…)"
  const c2 = ctx();
  await tools.runRookTool("send_samples_to_rook", { client: "Aiden Adair", sample_names: ["Text-Verified VET Widows"], ref }, c2);
  assert.equal(c2.rook.parts[0].ref, ref);
  assert.equal(req.openRequestsIn("chan-1").length, 0);
  assert.equal(req.getRequest(ref).status, "done");
});

test("answer without a ref still closes the open question for that client in the channel", async () => {
  const c1 = ctx();
  await tools.runRookTool("ask_rook_to_clarify", { client: "Robert McCool", question_for_client: "Which Vet ad?", options: ["Text-Verified VET PLUS", "Text-Verified VET Widows"] }, c1);
  const c2 = ctx();
  await tools.runRookTool("send_samples_to_rook", { client: "robert mccool", sample_names: ["Text-Verified VET PLUS"] }, c2);
  assert.equal(req.openRequestsIn("chan-1").length, 0);
});

test("clarify needs two real options; unknown names are reported, not substituted", async () => {
  const bad = await tools.runRookTool("ask_rook_to_clarify", { client: "X", question_for_client: "?", options: ["Text-Verified VET PLUS", "Widow Plus"] }, ctx());
  assert.equal(bad.isError, true);
  const c = ctx();
  await tools.runRookTool("send_samples_to_rook", { client: "X", sample_names: ["Widow Plus"], unavailable: [] }, c);
  assert.equal(c.rook.parts[0].type, "unavailable");
  assert.match(fmt.formatForRook(c.rook.parts, "1"), /⚠️ NOT IN LIBRARY for X: "widow plus"/);
});

test("in client SMS threads the same answers become drafts and // notes", () => {
  const { drafts, notes } = fmt.formatForSms([
    { type: "clarify", client: "Aiden Adair", ref: "AS-9", question: "Which Vet ad would you like to see: VET PLUS or VET Widows?", options: ["Text-Verified VET PLUS", "Text-Verified VET Widows"] },
    { type: "links", client: "Aiden Adair", ref: "AS-8", links: [{ sample: "Text-Verified VET PLUS", url: "https://x/p/1" }] },
  ]);
  assert.equal(drafts[0], "Hi Aiden! Which Vet ad would you like to see: VET PLUS or VET Widows?");
  assert.match(drafts[1], /^Hi Aiden! Here is the ad video for your leads:\nText-Verified VET PLUS: https:\/\/x\/p\/1/);
  assert.ok(notes.every((n) => n.startsWith("//")));
  assert.deepEqual(req.refsIn("answer for as-12 and AS-3"), ["AS-12", "AS-3"]);
});

test("Rook can get the whole library as one list", async () => {
  const c = ctx();
  await tools.runRookTool("send_catalog_to_rook", {}, c);
  const msg = fmt.formatForRook(c.rook.parts, "9");
  assert.match(msg, /📚 AD SAMPLE LIBRARY/);
  assert.match(msg, /Veterans: Text-Verified VET PLUS \| Text-Verified VET Widows/);
});

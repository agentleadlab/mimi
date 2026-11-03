import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mimi-sms-"));
let d;
before(async () => {
  process.env.MIMI_DATA_DIR = dataDir;
  d = await import("../src/smsDrafts.js");
});
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test("drafts never reach the client until a teammate sends them, and only once", () => {
  const text = "Hi Aiden! Here are your ad videos:\nText-Verified VET PLUS: https://x/p/1";
  const msg = d.draftMessage(text);
  assert.ok(msg.startsWith("//"), "Rook must not text the draft");
  assert.match(msg, /```\nHi Aiden!/);
  assert.ok(d.sentMessage(text, "Faith").startsWith("// ✅"));

  d.saveDraft("m1", { channelId: "t1", text, requestedBy: "Rook" });
  const first = d.claimDraft("m1", "Faith");
  assert.equal(first.text, text);
  assert.equal(d.claimDraft("m1", "Kath"), null); // a second 📤 does nothing
  d.releaseDraft("m1"); // sending failed: can be retried
  assert.equal(d.claimDraft("m1", "Kath").sentBy, "Kath");
  assert.equal(d.claimDraft("unknown", "Faith"), null);
});

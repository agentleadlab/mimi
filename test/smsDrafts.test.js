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

test("ad samples go out on their own; anything about money still waits for a person", () => {
  const sample = "Hi Enmanuel! Here's the ad your veteran leads clicked on:\n\nText-Verified VET PLUS: https://mimi-production-952b.up.railway.app/p/BXp6OIglVjFxCNpr\n\nOnce you tap Watch, it plays for 2 minutes and 30 seconds.";
  assert.equal(d.isAdSampleDraft(sample), true);
  assert.ok(d.autoSentMessage(sample).startsWith("// ✅"), "the note must not be texted");
  assert.equal(d.isAdSampleDraft("Your invoice is $1,350: https://x.example/p/abcdef123"), false);
  assert.equal(d.isAdSampleDraft("Here's 10% off: https://x.example/p/abcdef123"), false);
  assert.equal(d.isAdSampleDraft("Thanks Aiden, we'll get those over to you!"), false);
  process.env.MIMI_AUTO_SEND_SAMPLES = "off";
  assert.equal(d.isAdSampleDraft(sample), false);
  delete process.env.MIMI_AUTO_SEND_SAMPLES;
});

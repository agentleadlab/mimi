import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mimi-learn-"));
let store, tools, attachments;

before(async () => {
  process.env.MIMI_DATA_DIR = dataDir;
  store = await import("../src/learnings/store.js");
  tools = await import("../src/learnings/tools.js");
  attachments = await import("../src/attachments.js");
});
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const winner = {
  verdict: "winner",
  vertical: "Trucker",
  angle: "Angle 3: CDL holders",
  hook: "If your DOT medical card is current, there's a private cash-building strategy you may qualify for.",
  metrics: { spend: "$412", leads: 31, CPL: "$13.29" },
  why: "DOT card as the qualifier",
};

test("saves winners, updates repeats instead of duplicating, and feeds the prompt", async () => {
  assert.equal(store.learningsPrompt(), "");
  const r = await tools.runLearningTool("save_ad_learnings", { period: "Oct 1–14", entries: [winner] }, { requester: "Kath" });
  assert.equal(r.isError, false);
  await tools.runLearningTool("save_ad_learnings", {
    entries: [
      { ...winner, hook: `  ${winner.hook.toUpperCase()} `, metrics: { CPL: "$11.80" } },
      { verdict: "loser", vertical: "Trucker", hook: "If you drive a truck, you need this.", why: "generic opener" },
      { verdict: "maybe", vertical: "Trucker", hook: "ignored" },
    ],
  });
  const all = store.getLearnings();
  assert.equal(all.length, 2);
  assert.equal(all[0].metrics.CPL, "$11.80");
  assert.equal(all[0].savedBy, "Kath"); // kept from the first save
  const prompt = store.learningsPrompt();
  assert.match(prompt, /Proven On Our Accounts/);
  assert.match(prompt, /### Winners\n- \[Trucker \/ Angle 3: CDL holders\]/);
  assert.match(prompt, /### Didn't work[\s\S]*generic opener/);
});

test("lists, filters and removes learnings", async () => {
  const list = JSON.parse((await tools.runLearningTool("list_ad_learnings", { verdict: "loser" })).content);
  assert.equal(list.length, 1);
  const r = await tools.runLearningTool("remove_ad_learning", { id: list[0].id });
  assert.equal(r.isError, false);
  assert.equal(store.filterLearnings({ verdict: "loser" }).length, 0);
  assert.equal((await tools.runLearningTool("remove_ad_learning", { id: "nope" })).isError, true);
});

test("reads attached CSV exports inline", async () => {
  assert.equal(attachments.isTextAttachment({ name: "Ads-Report.csv", contentType: "application/octet-stream" }), true);
  assert.equal(attachments.isTextAttachment({ name: "shot.png", contentType: "image/png" }), false);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("Ad name,Spend,Results\nTRK-A3-H2,412,31\n");
  try {
    const text = await attachments.readTextFiles([{ name: "r.csv", url: "https://cdn/r.csv", size: 40 }]);
    assert.match(text, /^\[attached file: r\.csv\]\nAd name,Spend,Results/);
    const big = await attachments.readTextFiles([{ name: "big.csv", url: "https://cdn/b.csv", size: 5e6 }]);
    assert.match(big, /too large/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

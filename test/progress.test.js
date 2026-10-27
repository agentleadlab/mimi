import { test } from "node:test";
import assert from "node:assert/strict";
import { ProgressCard, describeTools, startStep } from "../src/progress.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeIo() {
  const log = [];
  let id = 0;
  return {
    log,
    io: {
      requester: "Kath",
      post: async (p) => (log.push(["post", p]), { id: ++id }),
      edit: async (m, p) => (log.push(["edit", p]), m),
    },
  };
}

test("fast answers never show a card", async () => {
  const { io, log } = fakeIo();
  const card = new ProgressCard(io, startStep(), { showAfterMs: 50 });
  await card.finish({ embeds: [{ title: "Answer" }] });
  await sleep(80);
  assert.deepEqual(log.map(([k]) => k), ["post"]);
  assert.equal(log[0][1].embeds[0].title, "Answer");
});

test("slow jobs show the card, update per step, then become the answer", async () => {
  const { io, log } = fakeIo();
  const card = new ProgressCard(io, startStep({ imageCount: 8 }), { showAfterMs: 10, minGapMs: 5 });
  await sleep(30);
  assert.equal(log[0][0], "post");
  assert.equal(log[0][1].embeds[0].title, "Reading 8 screenshots…");
  assert.equal(log[0][1].embeds[0].image.url, "attachment://progress-1.gif");
  assert.equal(log[0][1].files[0].name, "progress-1.gif");

  card.tools(["create_report_deck"]);
  await sleep(30);
  const step2 = log.at(-1)[1];
  assert.equal(step2.embeds[0].title, "Designing the deck…");
  assert.equal(step2.embeds[0].image.url, "attachment://progress-2.gif");

  card.writing();
  await sleep(30);
  assert.match(log.at(-1)[1].embeds[0].description, /Step 4 of 4/);

  const sent = await card.finish({ embeds: [{ title: "Report ready" }], files: [{ name: "deck.pptx" }] });
  const last = log.at(-1);
  assert.equal(last[0], "edit");
  assert.equal(last[1].embeds[0].title, "Report ready");
  assert.deepEqual(last[1].attachments, []); // the progress GIF is removed
  assert.equal(last[1].files[0].name, "deck.pptx");
  assert.equal(sent.id, 1);
  assert.equal(await card.cancel(), null);
});

test("tool names map to plain steps", () => {
  assert.equal(describeTools(["meta_ad_insights"]).title, "Pulling live Meta numbers");
  assert.equal(describeTools(["canva_get_template_fields", "canva_autofill"]).title, "Building designs in Canva");
  assert.equal(describeTools(["something_new"]).title, "Working on it");
});

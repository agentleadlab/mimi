import { test } from "node:test";
import assert from "node:assert/strict";
import { runReportTool } from "../src/reports/tools.js";
import { fmt } from "../src/reports/deck.js";
import { replyMessages } from "../src/ui.js";
import { buildClaudeMessages } from "../src/history.js";

test("builds a report deck and attaches it as a download", async () => {
  const files = [];
  const r = await runReportTool(
    "create_report_deck",
    {
      title: "Weekly Marketing Report",
      date_range: "30d ending Oct 16, 2026",
      slides: [
        { type: "title", prepared_for: "Jen, Tre & K2" },
        { type: "kpis", title: "Totals", kpis: [{ label: "VET CPL", value: 30.28, unit: "$" }, { label: "VET CAC", value: null, unit: "$" }] },
        { type: "cpl_cac", title: "Campaigns", source: "Command center, 30d ending Oct 16", rows: [{ label: "CBO", cpl: 25.71, cac: 296 }, { label: "ABO Main", cpl: 33.8, cac: null }] },
        { type: "two_column", title: "Fund vs hold", left: { heading: "Fund", bullets: ["Truckers"] }, right: { heading: "Flag for review", bullets: ["V.6"] } },
      ],
    },
    { files },
  );
  assert.equal(r.isError, false);
  assert.equal(files[0].name, "Weekly Marketing Report 30d ending Oct 16 2026.pptx");
  assert.equal(files[0].buffer.subarray(0, 2).toString(), "PK");
  assert.ok(files[0].buffer.includes("ppt/slides/slide4.xml"));

  const msgs = replyMessages("# Report\nHere it is.", { files });
  assert.equal(msgs[0].files[0].name, files[0].name);
  assert.equal(msgs[0].embeds[0].image, undefined); // a deck isn't shown as an embed image
});

test("number formatting", () => {
  assert.equal(fmt(491401, "$"), "$491,401");
  assert.equal(fmt(30.28, "$"), "$30.28");
  assert.equal(fmt(4.3, "x"), "4.3x");
  assert.equal(fmt(null, "$"), "—");
});

test("screenshots from recent earlier messages are included", () => {
  const t = Date.now();
  const user = (text, imageUrls, mins) => ({ fromBot: false, author: "Kath", text, imageUrls, createdAt: t - mins * 60_000 });
  const msgs = buildClaudeMessages([
    user("old", ["https://x/old.png"], 300),
    user("batch 1", ["https://x/a.png", "https://x/b.png"], 10),
    { fromBot: true, author: "Mimi", text: "got it", imageUrls: [], createdAt: t - 9 * 60_000 },
    user("batch 2, make the report", ["https://x/c.png"], 0),
  ]);
  const images = msgs.flatMap((m) => m.content).filter((b) => b.type === "image").map((b) => b.source.url);
  assert.deepEqual(images, ["https://x/a.png", "https://x/b.png", "https://x/c.png"]);
});

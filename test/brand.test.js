import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mimi-brand-"));
let run;
before(async () => {
  process.env.MIMI_DATA_DIR = dataDir;
  ({ runBrandTool: run } = await import("../src/brand/tools.js"));
});
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test("logs a copy report, blocks duplicates, tracks status", async () => {
  const input = {
    page_name: "Vet Benefits Pro",
    page_url: "https://facebook.com/vetbenefitspro",
    infringing_urls: ["https://www.facebook.com/ads/library/?id=111", "not a url"],
    original_urls: ["https://www.facebook.com/agentleadlab/videos/222"],
    content_type: "video",
    summary: "Re-uploaded Tre's VET PLUS video with their logo",
  };
  const first = JSON.parse((await run("log_copy_report", input, { requester: "Kath" })).content);
  assert.equal(first.report.id, "CR-1");
  assert.deepEqual(first.report.infringing_urls, ["https://www.facebook.com/ads/library/?id=111"]);
  assert.equal(first.report.status, "drafted");

  const dupe = JSON.parse((await run("log_copy_report", input, {})).content);
  assert.equal(dupe.already_logged, true);

  const upd = JSON.parse((await run("update_copy_report", { id: "1", status: "submitted", meta_report_number: "9876" }, { requester: "Tre" })).content);
  assert.equal(upd.report.status, "submitted");
  assert.equal(upd.report.meta_report_number, "9876");

  const open = JSON.parse((await run("list_copy_reports", { status: "submitted" })).content);
  assert.equal(open.length, 1);
  assert.equal((await run("update_copy_report", { id: "CR-99" })).isError, true);
});

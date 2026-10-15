import { test, before, after } from "node:test";
import assert from "node:assert/strict";

let runMetaTool;
const realFetch = globalThis.fetch;
const calls = [];
let routes = {};

before(async () => {
  process.env.META_ACCESS_TOKEN = "tok";
  process.env.META_AD_ACCOUNT_IDS = "123";
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    calls.push(u);
    const handler = routes[u.pathname.replace(/^\/v[\d.]+/, "")];
    if (!handler) return new Response(JSON.stringify({ error: { message: "nope", code: 100 } }), { status: 400 });
    const body = handler(u, opts);
    return Buffer.isBuffer(body)
      ? new Response(body, { status: 200, headers: { "content-type": "image/jpeg" } })
      : new Response(JSON.stringify(body), { status: 200 });
  };
  ({ runMetaTool } = await import("../src/meta/tools.js"));
});
after(() => (globalThis.fetch = realFetch));

const leads = (n, type = "lead") => [{ action_type: "link_click", value: "90" }, { action_type: type, value: String(n) }];

test("pulls CPL for several ranges with a name filter, following pages", async () => {
  routes = {
    "/act_123": () => ({ name: "ALL Main", currency: "USD", timezone_name: "America/Chicago" }),
    "/act_123/insights": (u) => {
      const preset = u.searchParams.get("date_preset");
      if (preset === "today") return { data: [] };
      if (u.searchParams.get("after")) return { data: [{ campaign_name: "Trucker - CDL", spend: "100", impressions: "5000", inline_link_clicks: "50", actions: [] }] };
      return {
        data: [
          { campaign_name: "Trucker - Spouse", spend: "412.5", impressions: "20000", inline_link_clicks: "400", inline_link_click_ctr: "2", actions: leads(31) },
          { campaign_name: "Trucker - Retired", spend: "200", impressions: "10000", inline_link_clicks: "100", actions: leads(25) },
        ],
        paging: { next: `${u.origin}${u.pathname}?after=x` },
      };
    },
  };
  const r = await runMetaTool("meta_ad_insights", { date_presets: ["today", "last_7d"], name_contains: "Trucker", sort_by: "cpl" });
  assert.equal(r.isError, false);
  const out = JSON.parse(r.content);
  const insightsCall = calls.find((u) => u.pathname.endsWith("/insights") && u.searchParams.get("date_preset") === "last_7d");
  assert.deepEqual(JSON.parse(insightsCall.searchParams.get("filtering")), [{ field: "campaign.name", operator: "CONTAIN", value: "Trucker" }]);
  const [today, week] = out.results;
  assert.equal(today.totals.leads, 0);
  assert.equal(today.totals.cpl, null);
  assert.equal(week.account, "ALL Main");
  assert.equal(week.lead_action, "lead");
  assert.deepEqual(week.totals, { spend: 712.5, leads: 56, cpl: 12.72, ctr_pct: 1.57 });
  assert.deepEqual(week.rows.map((x) => [x.campaign, x.cpl]), [["Trucker - Retired", 8], ["Trucker - Spouse", 13.31], ["Trucker - CDL", null]]);
});

test("ad details return the copy and attach the image", async () => {
  routes = {
    "/987": () => ({
      name: "TRK-A3-V1-H2",
      effective_status: "ACTIVE",
      campaign: { name: "Trucker - CDL" },
      preview_shareable_link: "https://fb.me/preview",
      creative: {
        image_url: "https://scontent.example/img.jpg",
        object_story_spec: { link_data: { message: "If your DOT medical card is current…", name: "See What You Qualify For", call_to_action: { type: "LEARN_MORE" } } },
      },
    }),
    "/img.jpg": () => Buffer.alloc(500, 1),
  };
  const files = [];
  const r = await runMetaTool("meta_ad_details", { ad_ids: ["987"] }, { files });
  const [ad] = JSON.parse(r.content).ads;
  assert.equal(ad.primary_text, "If your DOT medical card is current…");
  assert.equal(ad.headline, "See What You Qualify For");
  assert.equal(ad.cta, "LEARN_MORE");
  assert.equal(ad.image_attached, true);
  assert.equal(files[0].title, "TRK-A3-V1-H2");
});

test("explains an expired token", async () => {
  routes = { "/act_123": () => ({ name: "x" }) };
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Session has expired", code: 190 } }), { status: 400 });
  const { describeMetaError, graph } = await import("../src/meta/api.js");
  await assert.rejects(graph("/me"), (err) => /new system user token/.test(describeMetaError(err)));
});

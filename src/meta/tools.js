import { config } from "../config.js";
import { accountInfo, describeMetaError, graph, graphAll } from "./api.js";

export const DATE_PRESETS = ["today", "yesterday", "last_3d", "last_7d", "last_14d", "last_30d", "this_month", "last_month", "maximum"];
const LEVELS = ["account", "campaign", "adset", "ad"];
const DEFAULT_LEAD_ACTIONS = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "onsite_web_lead"];
const MAX_ATTACH_BYTES = 8 * 1024 * 1024;

const num = (v) => (v === undefined || v === null || v === "" ? 0 : Number(v));
const round = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

function actionCount(actions, type) {
  return num(actions?.find((a) => a.action_type === type)?.value);
}

/** The lead action to count for this result set: the first preferred type that has data. */
export function pickLeadAction(rows) {
  const prefs = config.metaLeadActions.length ? config.metaLeadActions : DEFAULT_LEAD_ACTIONS;
  return prefs.find((t) => rows.some((r) => actionCount(r.actions, t) > 0)) ?? prefs[0];
}

export function summarizeRow(row, level, leadAction) {
  const spend = num(row.spend);
  const leads = actionCount(row.actions, leadAction);
  const names = {
    campaign: row.campaign_name,
    ...(level === "adset" || level === "ad" ? { adset: row.adset_name } : {}),
    ...(level === "ad" ? { ad: row.ad_name, ad_id: row.ad_id } : {}),
  };
  return {
    ...(level === "account" ? {} : names),
    spend: round(spend),
    leads,
    cpl: leads ? round(spend / leads) : null,
    impressions: num(row.impressions),
    link_clicks: num(row.inline_link_clicks),
    ctr_pct: round(num(row.inline_link_click_ctr)),
    cpm: round(num(row.cpm)),
    frequency: round(num(row.frequency)),
  };
}

function sortRows(rows, sortBy) {
  const key = {
    spend: (r) => -r.spend,
    leads: (r) => -r.leads,
    // Cheapest leads first; rows with no leads go last (by spend, so wasted spend is visible).
    cpl: (r) => (r.cpl === null ? Number.MAX_SAFE_INTEGER - r.spend : r.cpl),
  }[sortBy] ?? ((r) => -r.spend);
  return [...rows].sort((a, b) => key(a) - key(b));
}

function accountsFor(query) {
  if (!query) return config.metaAdAccountIds;
  const q = String(query).toLowerCase().replace(/^act_/, "");
  const byId = config.metaAdAccountIds.filter((id) => id.toLowerCase().includes(q));
  return byId.length ? byId : config.metaAdAccountIds; // names are matched after fetching account info
}

async function insightsFor(accountId, { level, range, nameContains, filterOn, sortBy, limit }) {
  const info = await accountInfo(accountId);
  const filtering = nameContains
    ? [{ field: `${filterOn === "account" ? "campaign" : filterOn}.name`, operator: "CONTAIN", value: nameContains }]
    : undefined;
  const raw = await graphAll(`/${accountId}/insights`, {
    level,
    fields: "campaign_name,adset_name,ad_name,ad_id,spend,impressions,inline_link_clicks,inline_link_click_ctr,cpm,frequency,actions",
    ...(range.preset ? { date_preset: range.preset } : { time_range: { since: range.since, until: range.until } }),
    ...(filtering && { filtering }),
    limit: 500,
  });
  const leadAction = pickLeadAction(raw);
  const rows = raw.map((r) => summarizeRow(r, level, leadAction));
  const spend = rows.reduce((n, r) => n + r.spend, 0);
  const leads = rows.reduce((n, r) => n + r.leads, 0);
  const impressions = rows.reduce((n, r) => n + r.impressions, 0);
  const clicks = rows.reduce((n, r) => n + r.link_clicks, 0);
  return {
    account: info.name ?? accountId,
    currency: info.currency,
    timezone: info.timezone_name,
    range: range.preset ?? `${range.since} to ${range.until}`,
    lead_action: leadAction,
    totals: {
      spend: round(spend),
      leads,
      cpl: leads ? round(spend / leads) : null,
      ctr_pct: impressions ? round((clicks / impressions) * 100) : null,
    },
    row_count: rows.length,
    rows: level === "account" ? undefined : sortRows(rows, sortBy).slice(0, limit),
  };
}

function creativeText(creative = {}) {
  const story = creative.object_story_spec ?? {};
  const link = story.link_data ?? {};
  const video = story.video_data ?? {};
  const feed = creative.asset_feed_spec ?? {};
  return {
    primary_text: creative.body || link.message || video.message || feed.bodies?.map((b) => b.text).filter(Boolean),
    headline: creative.title || link.name || video.title || feed.titles?.map((t) => t.text).filter(Boolean),
    description: link.description || feed.descriptions?.map((d) => d.text).filter(Boolean),
    cta: link.call_to_action?.type || video.call_to_action?.type || feed.call_to_action_types,
    destination: link.link || video.call_to_action?.value?.link || feed.link_urls?.[0]?.website_url,
  };
}

async function attachImage(url, adName, files) {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_ATTACH_BYTES || files.length >= 4) return false;
    const ext = (res.headers.get("content-type") ?? "").includes("png") ? "png" : "jpg";
    files.push({ name: `ad-${files.length + 1}.${ext}`, buffer, title: adName });
    return true;
  } catch {
    return false;
  }
}

const handlers = {
  async meta_ad_insights(input) {
    const level = LEVELS.includes(input.level) ? input.level : "campaign";
    const presets = (input.date_presets ?? []).filter((p) => DATE_PRESETS.includes(p)).slice(0, 4);
    const ranges = input.since && input.until ? [{ since: input.since, until: input.until }] : presets.length ? presets.map((preset) => ({ preset })) : [{ preset: "last_7d" }];
    const opts = {
      level,
      nameContains: input.name_contains?.trim() || undefined,
      filterOn: LEVELS.includes(input.filter_on) ? input.filter_on : level === "account" ? "campaign" : level,
      sortBy: input.sort_by ?? "spend",
      limit: Math.min(Math.max(Number(input.limit) || 15, 1), 50),
    };
    let accounts = accountsFor(input.account);
    if (input.account && accounts.length > 1) {
      const q = String(input.account).toLowerCase();
      const named = [];
      for (const id of accounts) if ((await accountInfo(id)).name?.toLowerCase().includes(q)) named.push(id);
      if (named.length) accounts = named;
    }
    const results = [];
    for (const accountId of accounts) {
      for (const range of ranges) {
        try {
          results.push(await insightsFor(accountId, { ...opts, range }));
        } catch (err) {
          results.push({ account: accountId, range: range.preset ?? `${range.since} to ${range.until}`, error: describeMetaError(err) });
        }
      }
    }
    return { level, ...(opts.nameContains && { filter: `${opts.filterOn} name contains "${opts.nameContains}"` }), results };
  },

  async meta_ad_details({ ad_ids = [], attach_images = true }, context) {
    const out = [];
    for (const id of ad_ids.slice(0, 5)) {
      try {
        const ad = await graph(`/${encodeURIComponent(id)}`, {
          fields:
            "name,effective_status,campaign{name},adset{name},preview_shareable_link," +
            "creative{title,body,image_url,thumbnail_url,object_story_spec,asset_feed_spec}",
        });
        const image = ad.creative?.image_url ?? ad.creative?.thumbnail_url;
        const attached = attach_images && image && context.files ? await attachImage(image, ad.name, context.files) : false;
        out.push({
          id,
          name: ad.name,
          status: ad.effective_status,
          campaign: ad.campaign?.name,
          adset: ad.adset?.name,
          ...creativeText(ad.creative),
          preview_link: ad.preview_shareable_link,
          image_attached: attached,
        });
      } catch (err) {
        out.push({ id, error: describeMetaError(err) });
      }
    }
    return { ads: out };
  },
};

export const metaTools = [
  {
    name: "meta_ad_insights",
    description:
      "Live Meta Ads numbers (read-only): spend, leads, CPL, CTR, CPM and frequency at account, campaign, ad set or ad level, " +
      "for one or more date ranges at once (e.g. today + last_7d + last_30d). Filter by name with name_contains (matched on campaign, ad set or ad names). " +
      "Dates follow the ad account's timezone; today is partial and Meta data can lag by a few hours.",
    input_schema: {
      type: "object",
      properties: {
        level: { type: "string", enum: LEVELS, description: "Default campaign." },
        date_presets: { type: "array", items: { type: "string", enum: DATE_PRESETS }, maxItems: 4, description: "Default [last_7d]." },
        since: { type: "string", description: "Custom range start YYYY-MM-DD (use with until instead of presets)." },
        until: { type: "string", description: "Custom range end YYYY-MM-DD." },
        name_contains: { type: "string", description: "Only rows whose name contains this text, e.g. 'Trucker' or 'MP - TX'." },
        filter_on: { type: "string", enum: ["campaign", "adset", "ad"], description: "Which name name_contains matches. Default: same as level." },
        sort_by: { type: "string", enum: ["spend", "leads", "cpl"], description: "Default spend." },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Rows per result (default 15)." },
        account: { type: "string", description: "Ad account name or ID, if there are several. Default: all connected accounts." },
      },
    },
  },
  {
    name: "meta_ad_details",
    description:
      "Show what specific ads are: name, status, campaign/ad set, primary text, headline, CTA, landing page, a shareable preview link, " +
      "and attach the ad's image to your reply. Get ad IDs from meta_ad_insights at level 'ad'.",
    input_schema: {
      type: "object",
      properties: {
        ad_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
        attach_images: { type: "boolean", description: "Attach each ad's image/thumbnail to the reply (default true)." },
      },
      required: ["ad_ids"],
    },
  },
];

export const metaToolNames = new Set(metaTools.map((t) => t.name));

export async function runMetaTool(name, input = {}, context = {}) {
  const handler = handlers[name];
  if (!handler) return { content: `Unknown tool: ${name}`, isError: true };
  try {
    return { content: JSON.stringify(await handler(input, context)), isError: false };
  } catch (err) {
    console.error(`Meta tool ${name} failed:`, err);
    return { content: describeMetaError(err), isError: true };
  }
}

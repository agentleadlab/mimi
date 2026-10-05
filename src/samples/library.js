import { config } from "../config.js";

// Re-read the sheet at most this often (edits show up within 5 minutes, or now with /samples refresh).
const CACHE_MS = 5 * 60 * 1000;

let cache = null; // { samples, loadedAt }
let loading = null;

/** Turn a Google Sheets link (edit or share URL) into its CSV export URL. */
export function csvExportUrl(sheetUrl) {
  const url = new URL(sheetUrl);
  if (url.pathname.endsWith("/export")) return url.toString();
  const id = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/)?.[1];
  if (!id) return sheetUrl; // Already a CSV link (e.g. "Publish to web").
  const gid = url.searchParams.get("gid") ?? url.hash.match(/gid=(\d+)/)?.[1];
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
}

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, newlines in quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * The Loom video ID from a Loom link, or null. Handles share/embed/v links,
 * titles in the path ("/share/My-Video-Title-<id>"), query strings, and
 * links pasted inside <…>.
 */
export function loomVideoId(link) {
  const m = String(link)
    .trim()
    .replace(/^<|>$/g, "")
    .match(/^(?:https?:\/\/)?(?:[\w-]+\.)*loom\.com\/(?:share|embed|v)\/(?:[^?#\s]*?[-/])?([a-f0-9]{16,})(?:[?#/\s]|$)/i);
  return m ? m[1].toLowerCase() : null;
}

const norm = (s) => String(s ?? "").trim();
const headerKey = (h) => norm(h).toLowerCase().replace(/[^a-z]/g, "");

/** Map sheet rows to samples. Columns are found by header name, so their order can change. */
export function rowsToSamples(rows) {
  const [header, ...body] = rows;
  if (!header) return [];
  const col = (...names) => header.findIndex((h) => names.includes(headerKey(h)));
  const idx = {
    name: col("samplename", "name", "sample"),
    vertical: col("vertical", "leadtype", "category"),
    campaign: col("campaigncontext", "campaign", "context"),
    date: col("dateadded", "date"),
    loom: col("loomlink", "loom", "link", "url"),
    tags: col("tags", "tag"),
  };
  return body
    .map((r) => ({
      name: norm(r[idx.name]),
      vertical: norm(r[idx.vertical]),
      campaign: norm(r[idx.campaign]),
      dateAdded: norm(r[idx.date]),
      loomUrl: norm(r[idx.loom]),
      tags: norm(r[idx.tags])
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    }))
    .map((s) => ({ ...s, loomId: loomVideoId(s.loomUrl) }))
    .filter((s) => s.name && s.loomId);
}

export const samplesConfigured = () => Boolean(config.samplesSheetUrl);

/** All samples from the sheet (cached). */
export async function getSamples({ refresh = false } = {}) {
  if (!samplesConfigured()) throw new Error("The ad sample library isn't set up (SAMPLES_SHEET_URL is missing).");
  if (!refresh && cache && Date.now() - cache.loadedAt < CACHE_MS) return cache.samples;

  loading ??= (async () => {
    try {
      const res = await fetch(csvExportUrl(config.samplesSheetUrl), { redirect: "follow" });
      const text = await res.text();
      if (!res.ok || text.trimStart().startsWith("<")) {
        throw new Error(
          "Couldn't read the ad sample sheet. Make sure it's shared as 'Anyone with the link can view'.",
        );
      }
      const samples = rowsToSamples(parseCsv(text));
      cache = { samples, loadedAt: Date.now() };
      return samples;
    } catch (err) {
      // Keep serving the last good copy if the sheet is briefly unreachable.
      if (cache) {
        console.warn("Using cached ad samples:", err.message);
        return cache.samples;
      }
      throw err;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Distinct lead types (verticals), in sheet order. */
export function verticalsOf(samples) {
  return [...new Set(samples.map((s) => s.vertical).filter(Boolean))];
}

/** Samples whose vertical, name, campaign or tags match the query (case-insensitive). */
export function searchSamples(samples, query) {
  const q = norm(query).toLowerCase();
  if (!q) return samples;
  const exact = samples.filter((s) => s.vertical.toLowerCase() === q || s.name.toLowerCase() === q);
  if (exact.length) return exact;
  return samples.filter((s) =>
    [s.vertical, s.name, s.campaign, ...s.tags].some((f) => f.toLowerCase().includes(q)),
  );
}

/** Show a just-added sample right away, before the sheet's CSV export catches up. */
export function addToCache(sample) {
  if (cache) cache.samples = [...cache.samples, sample];
}

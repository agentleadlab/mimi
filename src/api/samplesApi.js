import crypto from "node:crypto";
import { config } from "../config.js";
import { getState, setState } from "../store.js";
import { getSamples, samplesConfigured } from "../samples/library.js";
import { createPreviewLink } from "../samples/links.js";

// Web API for the client profile's "See an ad example" button.
//   POST /api/samples     { lead_type, client_name, client_ref, request_id, source }
//   GET  /api/lead-types
// Auth: "Authorization: Bearer <MIMI_API_TOKEN>". The same request_id always returns
// the same link and never creates a second sample.

const REQUESTS_KEY = "apiSampleRequests";
const KEEP_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_BODY = 10 * 1024;
const RATE = { windowMs: 60 * 1000, max: 30 }; // new links per minute across all callers

// ---------- lead type words ----------

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[_\-–—/]+/g, " ")
    .replace(/(\d)\.(\d)/g, "$1\u0000$2") // keep version dots like "2.0"
    .replace(/[^a-z0-9\u0000 ]+/g, "")
    .replace(/\u0000/g, ".")
    .replace(/\s+/g, " ")
    .trim();
// For loose matching: "vet plus 2.0" = "vet plus 2".
const loose = (s) => s.replace(/(\d+)\.0\b/g, "$1").replace(/\./g, "");

// Short forms clients and orders use, mapped onto the words built from sample names.
const ALIASES = { fex: "final expense", fe: "final expense", mp: "mortgage protection", mtg: "mortgage protection", vet: "vet", vets: "vet" };

/** The lead type word for a sample: its name without the "Text-Verified" prefix. */
export const leadTypeWord = (sampleName) => norm(sampleName).replace(/^text verified /, "");

/** [{ word, sample }] for every sample in the library (first sample wins if two share a word). */
export function leadTypes(samples) {
  const seen = new Map();
  for (const s of samples) {
    const word = leadTypeWord(s.name);
    if (word && !seen.has(word)) seen.set(word, s);
  }
  return [...seen].map(([word, sample]) => ({ word, sample }));
}

/** Match a requested lead type to exactly one sample, or null. */
export function matchLeadType(requested, samples) {
  const types = leadTypes(samples);
  let q = norm(requested).replace(/^text verified /, "").replace(/ (ad|ads|sample|samples|leads?)$/g, "");
  if (!q) return null;
  // Expand short forms word by word ("fex" -> "final expense", "mp standard" -> "mortgage protection standard").
  q = q
    .split(" ")
    .map((w) => ALIASES[w] ?? w)
    .join(" ");
  const exact =
    types.find((t) => t.word === q) ??
    types.find((t) => norm(t.sample.name) === norm(requested)) ??
    types.find((t) => loose(t.word) === loose(q));
  return exact?.sample ?? null;
}

// ---------- idempotency + rate limit ----------

const loadRequests = () => getState(REQUESTS_KEY) ?? {};
function saveRequest(id, record) {
  const cutoff = Date.now() - KEEP_MS;
  const all = Object.fromEntries(Object.entries(loadRequests()).filter(([, r]) => r.createdAt > cutoff));
  all[id] = record;
  setState(REQUESTS_KEY, all);
}

const recent = [];
function rateLimited() {
  const now = Date.now();
  while (recent.length && now - recent[0] > RATE.windowMs) recent.shift();
  if (recent.length >= RATE.max) return Math.ceil((RATE.windowMs - (now - recent[0])) / 1000);
  recent.push(now);
  return 0;
}
export const _resetRateLimit = () => recent.splice(0);

// ---------- http helpers ----------

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function authorized(req) {
  const token = config.apiToken;
  const got = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!token || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(Object.assign(new Error("Body must be JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

const looksPersonal = (s) => /@/.test(s) || (s.match(/\d/g) ?? []).length >= 10; // email or phone number
const clean = (v, max = 100) => String(v ?? "").trim().slice(0, max);

// ---------- handler ----------

/**
 * Handle /api/* requests. `onSampleCreated({ leadType, sample, clientName, requestId, source, test })`
 * is called after a new link is created (e.g. to post a note in #ad-samples).
 */
export async function handleApi(req, res, { onSampleCreated } = {}) {
  const url = new URL(req.url, "http://localhost");
  if (!config.apiToken) return send(res, 503, { ok: false, error: "api_disabled", message: "The samples API isn't turned on (MIMI_API_TOKEN is not set)." });
  if (!authorized(req)) return send(res, 401, { ok: false, error: "unauthorized", message: "Missing or wrong API key." });
  if (!samplesConfigured()) return send(res, 503, { ok: false, error: "library_unavailable", message: "The ad sample library isn't set up." });

  if (url.pathname === "/api/lead-types") {
    if (req.method !== "GET") return send(res, 405, { ok: false, error: "method_not_allowed" }, { Allow: "GET" });
    const samples = await getSamples();
    return send(res, 200, { ok: true, lead_types: leadTypes(samples).map((t) => t.word), watch_seconds: config.previewSeconds });
  }

  if (url.pathname !== "/api/samples") return send(res, 404, { ok: false, error: "not_found" });
  if (req.method !== "POST") return send(res, 405, { ok: false, error: "method_not_allowed" }, { Allow: "POST" });

  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return send(res, err.status ?? 400, { ok: false, error: "bad_request", message: err.message });
  }
  const requestId = clean(body.request_id);
  const leadType = clean(body.lead_type);
  const clientName = clean(body.client_name);
  const clientRef = clean(body.client_ref);
  const source = clean(body.source, 30) || "api";
  if (!requestId) return send(res, 400, { ok: false, error: "missing_request_id", message: "request_id is required." });
  if (!leadType) return send(res, 400, { ok: false, error: "missing_lead_type", message: "lead_type is required." });
  if (clientRef && looksPersonal(clientRef)) {
    return send(res, 400, { ok: false, error: "client_ref_personal", message: "client_ref must be an internal id, never a phone number or email." });
  }

  // Same request_id → same link, never a second sample.
  const existing = loadRequests()[requestId];
  if (existing) {
    return send(res, 200, { ok: true, url: existing.url, expires_at: existing.expires_at, watch_seconds: existing.watch_seconds, lead_type: existing.lead_type, repeat: true, ...(existing.test && { test: true }) });
  }

  const samples = await getSamples();
  const sample = matchLeadType(leadType, samples);
  if (!sample) {
    return send(res, 400, { ok: false, error: "unknown_lead_type", message: `"${leadType}" doesn't match one ad sample.`, lead_types: leadTypes(samples).map((t) => t.word) });
  }

  const wait = rateLimited();
  if (wait) return send(res, 429, { ok: false, error: "rate_limited", message: "Too many requests. Try again shortly.", retry_after: wait }, { "Retry-After": String(wait) });

  const test = Boolean(clientName) && clientName.toLowerCase() === config.apiTestClientName.toLowerCase();
  const { url: link } = createPreviewLink(sample, { requestedBy: `Client profile (${source})${test ? " [test]" : ""}`, client: clientName || clientRef || null });
  const record = {
    url: link,
    expires_at: new Date(Date.now() + config.unopenedLinkDays * 24 * 60 * 60 * 1000).toISOString(),
    watch_seconds: config.previewSeconds,
    lead_type: leadTypeWord(sample.name),
    sample: sample.name,
    client_ref: clientRef || null,
    source,
    test,
    createdAt: Date.now(),
  };
  saveRequest(requestId, record);
  console.log(`API sample: ${record.lead_type} for ${clientName || clientRef || "a client"} (request ${requestId}${test ? ", test" : ""}).`);
  try {
    await onSampleCreated?.({ leadType: record.lead_type, sample: sample.name, clientName, requestId, source, test });
  } catch (err) {
    console.warn("Couldn't post the ad-samples note:", err.message);
  }
  return send(res, 200, { ok: true, url: link, expires_at: record.expires_at, watch_seconds: record.watch_seconds, lead_type: record.lead_type, ...(test && { test: true }) });
}

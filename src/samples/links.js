import crypto from "node:crypto";
import { config } from "../config.js";
import { getState, setState } from "../store.js";

const KEY = "previewLinks";
// Forget links this long after they were created (keeps the log and file small).
const KEEP_MS = 60 * 24 * 60 * 60 * 1000;

const minutes = (n) => n * 60 * 1000;
const days = (n) => n * 24 * 60 * 60 * 1000;

function load() {
  return getState(KEY) ?? {};
}

function save(all) {
  const cutoff = Date.now() - KEEP_MS;
  setState(KEY, Object.fromEntries(Object.entries(all).filter(([, l]) => l.createdAt > cutoff)));
}

export function previewUrl(token) {
  return `${config.publicUrl}/p/${token}`;
}

/** Create a new preview link for a sample. */
export function createPreviewLink(sample, { requestedBy, client } = {}) {
  const token = crypto.randomBytes(12).toString("base64url");
  const all = load();
  all[token] = {
    sample: { name: sample.name, vertical: sample.vertical, campaign: sample.campaign, loomId: sample.loomId },
    requestedBy: requestedBy ?? "unknown",
    client: client || null,
    createdAt: Date.now(),
    firstOpenedAt: null,
    opens: 0,
  };
  save(all);
  return { token, url: previewUrl(token) };
}

/**
 * Status of a link at `now`:
 * - unopened: valid until createdAt + unopened TTL (days)
 * - open: first opened, valid until firstOpenedAt + preview window (minutes)
 * - expired
 */
export function linkStatus(link, now = Date.now()) {
  if (!link) return { state: "missing" };
  if (link.firstOpenedAt) {
    const endsAt = link.firstOpenedAt + minutes(config.previewMinutes);
    return now < endsAt ? { state: "open", endsAt } : { state: "expired", reason: "viewed", endsAt };
  }
  const endsAt = link.createdAt + days(config.unopenedLinkDays);
  return now < endsAt ? { state: "unopened", endsAt } : { state: "expired", reason: "unopened", endsAt };
}

/** Look at a link without changing it (e.g. for the start screen). */
export function peekLink(token, now = Date.now()) {
  const link = load()[token];
  return { link, status: linkStatus(link, now) };
}

/**
 * Record a view. The viewing window starts on the first one, which happens
 * when a person presses "Watch" — never on a plain page load, so link
 * previews in chat apps and email don't use up the client's time.
 */
export function visitLink(token, now = Date.now()) {
  const all = load();
  const link = all[token];
  let status = linkStatus(link, now);
  if (status.state === "unopened" || status.state === "open") {
    if (!link.firstOpenedAt) link.firstOpenedAt = now;
    link.opens += 1;
    link.lastOpenedAt = now;
    save(all);
    status = linkStatus(link, now);
    if (link.opens === 1) {
      console.log(`Preview opened: "${link.sample.name}"${link.client ? ` for ${link.client}` : ""} (requested by ${link.requestedBy}).`);
    }
  }
  return { link, status };
}

/** Most recent links first. */
export function recentLinks(limit = 15) {
  return Object.entries(load())
    .map(([token, link]) => ({ token, ...link }))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

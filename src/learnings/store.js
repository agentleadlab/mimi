import crypto from "node:crypto";
import { getState, setState } from "../store.js";

// Ad results Mimi has learned from: proven hooks (winners) and patterns to
// avoid (losers), saved on the data volume and fed back into her prompt.
const KEY = "adLearnings";
const MAX_ENTRIES = 500;
// How many entries make it into the prompt (newest winners first).
const PROMPT_WINNERS = 60;
const PROMPT_LOSERS = 20;

export const VERDICTS = ["winner", "loser"];

export function getLearnings() {
  return getState(KEY) ?? [];
}

const norm = (s) => String(s ?? "").trim();
const sameHook = (a, b) => norm(a).toLowerCase().replace(/\s+/g, " ") === norm(b).toLowerCase().replace(/\s+/g, " ");

/**
 * Save learnings. Each entry: { verdict, vertical, angle, hook, ad_name, metrics, why }.
 * A hook that's already saved is updated (new metrics, verdict) instead of duplicated.
 */
export function addLearnings(entries, { savedBy, period } = {}) {
  const all = getLearnings();
  const saved = [];
  for (const e of entries) {
    const hook = norm(e.hook);
    if (!hook || !VERDICTS.includes(e.verdict)) continue;
    const entry = {
      verdict: e.verdict,
      vertical: norm(e.vertical) || "General",
      angle: norm(e.angle) || undefined,
      hook,
      ad_name: norm(e.ad_name) || undefined,
      metrics: e.metrics && typeof e.metrics === "object" ? e.metrics : undefined,
      why: norm(e.why) || undefined,
      period: norm(e.period ?? period) || undefined,
      savedBy,
      savedAt: new Date().toISOString(),
    };
    const existing = all.findIndex((x) => sameHook(x.hook, hook) && x.vertical.toLowerCase() === entry.vertical.toLowerCase());
    if (existing >= 0) {
      // Keep earlier details (who first saved it, the angle…) unless new ones are given.
      const updates = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined));
      all[existing] = { ...all[existing], ...updates, id: all[existing].id };
      saved.push({ ...all[existing], updated: true });
    } else {
      const withId = { id: crypto.randomBytes(3).toString("hex"), ...entry };
      all.push(withId);
      saved.push(withId);
    }
  }
  setState(KEY, all.slice(-MAX_ENTRIES));
  return saved;
}

export function removeLearning(id) {
  const all = getLearnings();
  const next = all.filter((x) => x.id !== id);
  if (next.length === all.length) return false;
  setState(KEY, next);
  return true;
}

export function filterLearnings({ vertical, angle, verdict } = {}) {
  const has = (field, q) => !q || String(field ?? "").toLowerCase().includes(String(q).toLowerCase());
  return getLearnings().filter((x) => has(x.vertical, vertical) && has(x.angle, angle) && (!verdict || x.verdict === verdict));
}

export function formatMetrics(metrics) {
  if (!metrics) return "";
  return Object.entries(metrics)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");
}

const line = (x) =>
  `- [${x.vertical}${x.angle ? ` / ${x.angle}` : ""}] "${x.hook}"` +
  (formatMetrics(x.metrics) ? ` (${formatMetrics(x.metrics)}${x.period ? `, ${x.period}` : ""})` : "") +
  (x.why ? ` — ${x.why}` : "");

/** The prompt section Mimi sees: proven winners first, then what to avoid. */
export function learningsPrompt() {
  const all = getLearnings();
  const winners = all.filter((x) => x.verdict === "winner").slice(-PROMPT_WINNERS).reverse();
  const losers = all.filter((x) => x.verdict === "loser").slice(-PROMPT_LOSERS).reverse();
  if (!winners.length && !losers.length) return "";
  return [
    "## Proven On Our Accounts",
    "Real Meta results the team saved. These outrank the playbook's reference hooks: when writing for the same vertical/angle, study what the winners have in common (setup pattern, emotional trigger, specificity, length) and lean into it. Write new hooks in that direction rather than copying winners verbatim, and avoid the patterns in the losers. When you use these learnings, say so briefly (e.g. 'built off the DOT-card winner').",
    winners.length ? `### Winners\n${winners.map(line).join("\n")}` : "",
    losers.length ? `### Didn't work\n${losers.map(line).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

import { config } from "../config.js";
import { getState, setState } from "../store.js";

// Client server rules: channels are named "#client-name-lead-type"; an agent only
// gets samples for that lead type, and each channel gets samples once.

const SHARES_KEY = "clientShares";

const slug = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Common short forms used in channel names → words that appear in the sheet's lead types.
const ALIASES = {
  trucker: "truck",
  truckers: "truck",
  trucking: "truck",
  cdl: "truck",
  vet: "veteran",
  vets: "veteran",
  veteran: "veteran",
  veterans: "veteran",
  "vet-widow": "widow",
  "vet-widows": "widow",
  widow: "widow",
  widows: "widow",
  mp: "mortgage",
  mortgage: "mortgage",
  "mortgage-protection": "mortgage",
  fe: "final expense",
  "final-expense": "final expense",
  iul: "iul",
  "spanish-iul": "spanish",
  "blue-collar": "blue collar",
};

/**
 * The lead type a channel is for, matched against the library's lead types.
 * Returns the sheet's lead type name, or null if the name doesn't say clearly.
 */
export function leadTypeFromChannel(channelName, verticals) {
  const name = slug(channelName);
  if (!name) return null;
  const candidates = [];
  for (const v of verticals) {
    const vs = slug(v);
    const forms = new Set([vs, vs.replace(/s$/, ""), `${vs.replace(/s$/, "")}s`]);
    for (const [alias, word] of Object.entries(ALIASES)) {
      if (v.toLowerCase().includes(word)) forms.add(alias);
    }
    for (const f of forms) {
      if (f && (name === f || name.endsWith(`-${f}`))) candidates.push({ vertical: v, len: f.length });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.len - a.len);
  const best = candidates.filter((c) => c.len === candidates[0].len).map((c) => c.vertical);
  // Two lead types match equally well (e.g. "IUL" and "Spanish IUL" on "-iul"): pick the one
  // whose own slug matches exactly, else give up rather than guess.
  const exact = [...new Set(best)].filter((v) => name.endsWith(`-${slug(v)}`) || name.endsWith(`-${slug(v).replace(/s$/, "")}`));
  const unique = [...new Set(exact.length ? exact : best)];
  return unique.length === 1 ? unique[0] : null;
}

function shares() {
  return getState(SHARES_KEY) ?? {};
}

/** Remember that samples were shared in a channel (messageUrl may be filled in after sending). */
export function recordShare(channelId, { messageUrl = null, samples = [], leadType, by } = {}) {
  const all = shares();
  all[channelId] = { ...(all[channelId] ?? {}), at: all[channelId]?.at ?? Date.now(), samples, leadType, by, ...(messageUrl && { messageUrl }) };
  setState(SHARES_KEY, all);
}

export function setShareMessage(channelId, messageUrl) {
  const all = shares();
  if (!all[channelId]) return;
  all[channelId].messageUrl = messageUrl;
  setState(SHARES_KEY, all);
}

export function forgetShare(channelId) {
  const all = shares();
  delete all[channelId];
  setState(SHARES_KEY, all);
}

const hasPreviewLink = (m) => {
  const marker = `${config.publicUrl}/p/`;
  const texts = [m.content, ...(m.embeds ?? []).flatMap((e) => [e.description, ...(e.fields ?? []).map((f) => f.value)])];
  return texts.some((t) => t?.includes(marker));
};

/**
 * Has Mimi already shared a sample in this channel? Checks her record, then the
 * channel's history (up to 500 messages). Returns { messageUrl, samples, at } or null.
 */
export async function findPreviousShare(channel, botId) {
  const saved = shares()[channel.id];
  if (saved) return saved;
  let before;
  for (let page = 0; page < 5; page++) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before && { before }) }).catch(() => null);
    if (!batch?.size) break;
    const hit = [...batch.values()].find((m) => m.author?.id === botId && hasPreviewLink(m));
    if (hit) {
      const found = { messageUrl: hit.url, at: hit.createdTimestamp, samples: [] };
      recordShare(channel.id, found);
      return found;
    }
    before = batch.last()?.id;
  }
  return null;
}

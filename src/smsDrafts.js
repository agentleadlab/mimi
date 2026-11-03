import { getState, setState } from "./store.js";

// Client-text drafts in SMS threads. Mimi never texts a client herself: she posts
// a "//" draft, and a teammate reacts 📤 to send it as-is (or copies and edits it).
export const SEND_EMOJI = "📤";
const KEY = "smsDrafts";
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

const load = () => getState(KEY) ?? {};
function save(all) {
  const cutoff = Date.now() - KEEP_MS;
  setState(KEY, Object.fromEntries(Object.entries(all).filter(([, d]) => d.createdAt > cutoff)));
}

/** The draft message Mimi posts (starts with "//", so Rook doesn't text it). */
export function draftMessage(text) {
  const body = text.replace(/```/g, "'''").slice(0, 1700);
  return `// ✏️ **Draft for the client.** React ${SEND_EMOJI} to send it exactly as written, or copy it, edit and send it yourself.\n\`\`\`\n${body}\n\`\`\``;
}

export function saveDraft(messageId, { channelId, text, requestedBy }) {
  const all = load();
  all[messageId] = { channelId, text, requestedBy, createdAt: Date.now(), sentBy: null };
  save(all);
}

export const getDraft = (messageId) => load()[messageId] ?? null;

/** Claim a draft for sending (once). Returns the draft, or null if it's unknown or already sent. */
export function claimDraft(messageId, sentBy) {
  const all = load();
  const d = all[messageId];
  if (!d || d.sentBy) return null;
  d.sentBy = sentBy;
  d.sentAt = Date.now();
  save(all);
  return d;
}

/** Undo a claim if sending failed. */
export function releaseDraft(messageId) {
  const all = load();
  if (all[messageId]) {
    all[messageId].sentBy = null;
    save(all);
  }
}

/** What the draft turns into once a teammate sent it (still "//", so Rook ignores it). */
export function sentMessage(text, who) {
  const body = text.replace(/```/g, "'''").slice(0, 1700);
  return `// ✅ **Sent to the client by ${who}.**\n\`\`\`\n${body}\n\`\`\``;
}

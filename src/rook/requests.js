import { getState, setState } from "../store.js";

// Open ad-sample conversations with Rook. Each gets a reference (AS-12) so a
// clarification Mimi asks for can be matched with the answer Rook brings back.
const KEY = "rookRequests";
const OPEN_MS = 3 * 24 * 60 * 60 * 1000; // a question stays answerable for 3 days
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

const load = () => getState(KEY) ?? { next: 1, items: {} };
function save(state) {
  const cutoff = Date.now() - KEEP_MS;
  state.items = Object.fromEntries(Object.entries(state.items).filter(([, r]) => r.createdAt > cutoff));
  setState(KEY, state);
}
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const isOpen = (r) => r.status === "open" && Date.now() - r.createdAt < OPEN_MS;

/** Start a request. status "open" while waiting on the client's answer, "done" once links went out. */
export function createRequest({ client, homeChannelId, channelId, requested, question, options = [], status = "open" }) {
  const state = load();
  const ref = `AS-${state.next}`;
  state.next += 1;
  state.items[ref] = {
    ref,
    client: String(client ?? "").trim() || "the client",
    homeChannelId,
    channelId,
    requested: String(requested ?? "").trim(),
    question: String(question ?? "").trim(),
    options,
    status,
    createdAt: Date.now(),
    ...(status === "done" && { resolvedAt: Date.now() }),
  };
  save(state);
  return state.items[ref];
}

export function getRequest(ref) {
  return load().items[String(ref ?? "").toUpperCase()] ?? null;
}

/** Mark open requests done: by ref, or every open one for this client in this channel. */
export function resolveRequests({ ref, client, homeChannelId }) {
  const state = load();
  const done = [];
  for (const r of Object.values(state.items)) {
    if (!isOpen(r)) continue;
    const match = ref ? r.ref === String(ref).toUpperCase() : r.homeChannelId === homeChannelId && norm(r.client) === norm(client);
    if (match) {
      r.status = "done";
      r.resolvedAt = Date.now();
      done.push(r.ref);
    }
  }
  if (done.length) save(state);
  return done;
}

export function openRequestsIn(homeChannelId) {
  return Object.values(load().items).filter((r) => isOpen(r) && r.homeChannelId === homeChannelId);
}

export const refsIn = (text) => [...new Set((String(text ?? "").match(/\bAS-\d+\b/gi) ?? []).map((r) => r.toUpperCase()))];

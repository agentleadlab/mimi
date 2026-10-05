import { config } from "./config.js";

// Agent Lead Lab palette for Discord cards.
export const COLORS = {
  brand: 0x00ff94, // neon green
  info: 0x2b2d31, // neutral dark
  warn: 0xffb020, // amber
  error: 0xff4d4f,
};

// Discord embed limits.
const LIMITS = { title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, embedTotal: 6000, perMessage: 10 };

let identity = { name: "Mimi", avatarUrl: null };

/** Set once the bot is logged in, so cards carry Mimi's avatar. */
export function setIdentity({ name, avatarUrl }) {
  identity = { name: name ?? identity.name, avatarUrl: avatarUrl ?? identity.avatarUrl };
}

const logoUrl = () => (config.publicUrl ? `${config.publicUrl}/assets/logo.png` : undefined);

function author() {
  return { name: `${identity.name} · Creative Director`, ...(identity.avatarUrl && { icon_url: identity.avatarUrl }) };
}

function footer(text) {
  return { text: text ? `${config.brandName} · ${text}` : config.brandName, ...(logoUrl() && { icon_url: logoUrl() }) };
}

/** A branded card (raw embed object, accepted anywhere discord.js takes embeds). */
export function card({ title, description, fields, color = COLORS.brand, footerText, showAuthor = true, timestamp = true }) {
  return {
    color,
    ...(showAuthor && { author: author() }),
    ...(title && { title: clip(title, LIMITS.title) }),
    ...(description && { description: clip(description, LIMITS.description) }),
    ...(fields?.length && { fields: fields.slice(0, LIMITS.fields) }),
    footer: footer(footerText),
    ...(timestamp && { timestamp: new Date().toISOString() }),
  };
}

export const noticeCard = (text, { title, color = COLORS.warn } = {}) =>
  card({ title, description: text, color, showAuthor: false, timestamp: false });

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Split text into pieces of at most `max` chars, preferring paragraph, line, then word breaks. */
function split(text, max) {
  const out = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf(" ", max);
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Parse Mimi's markdown into card parts:
 *   "# Title" (first line)  → card title
 *   text before any "##"    → description
 *   "## Heading" + text     → a section (field)
 */
export function parseReply(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  let title;
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines[0] && /^#\s+/.test(lines[0])) title = lines.shift().replace(/^#\s+/, "").replace(/\*\*/g, "").trim();

  const sections = [];
  let intro = [];
  let current = null;
  for (const line of lines) {
    const h = line.match(/^#{2,3}\s+(.*)$/);
    if (h) {
      current = { heading: h[1].replace(/\*\*/g, "").trim(), body: [] };
      sections.push(current);
    } else if (current) {
      current.body.push(line);
    } else {
      intro.push(line);
    }
  }
  return {
    title,
    intro: intro.join("\n").trim(),
    sections: sections.map((s) => ({ heading: s.heading, body: s.body.join("\n").trim() })).filter((s) => s.heading || s.body),
  };
}

const embedSize = (e) =>
  (e.title?.length ?? 0) +
  (e.description?.length ?? 0) +
  (e.author?.name.length ?? 0) +
  (e.footer?.text.length ?? 0) +
  (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);

/**
 * Turn a reply into Discord messages, each `{ embeds: [...] }`, within all
 * embed limits. Long replies continue across embeds/messages.
 */
export function replyMessages(text, { requester } = {}) {
  const { title, intro, sections } = parseReply(text || "…");
  const footerText = requester ? `for ${requester}` : undefined;

  const fields = [];
  for (const s of sections) {
    const pieces = split(s.body || "​", LIMITS.fieldValue);
    pieces.forEach((value, i) =>
      fields.push({ name: clip(i === 0 ? s.heading || "​" : "​", LIMITS.fieldName), value }),
    );
  }
  const descPieces = intro ? split(intro, LIMITS.description) : [];

  // Build embeds: the first carries author + title; the last carries footer + timestamp.
  const embeds = [];
  const fresh = (first) => ({ color: COLORS.brand, ...(first && { author: author(), ...(title && { title: clip(title, LIMITS.title) }) }) });
  let cur = fresh(true);
  const room = (e, extra) => embedSize(e) + extra + 200 <= LIMITS.embedTotal; // 200 keeps space for the footer

  for (const d of descPieces) {
    if (cur.description || !room(cur, d.length)) {
      embeds.push(cur);
      cur = fresh(false);
    }
    cur.description = d;
  }
  for (const f of fields) {
    if ((cur.fields?.length ?? 0) >= LIMITS.fields || !room(cur, f.name.length + f.value.length)) {
      embeds.push(cur);
      cur = fresh(false);
    }
    (cur.fields ??= []).push(f);
  }
  if (!cur.description && !cur.fields && !cur.title) cur.description = "​";
  cur.footer = footer(footerText);
  cur.timestamp = new Date().toISOString();
  embeds.push(cur);

  // Pack embeds into messages (≤10 embeds and ≤6000 chars each).
  const messages = [];
  let batch = [];
  let size = 0;
  for (const e of embeds) {
    const n = embedSize(e);
    if (batch.length && (batch.length >= LIMITS.perMessage || size + n > LIMITS.embedTotal)) {
      messages.push({ embeds: batch });
      batch = [];
      size = 0;
    }
    batch.push(e);
    size += n;
  }
  if (batch.length) messages.push({ embeds: batch });
  return messages;
}

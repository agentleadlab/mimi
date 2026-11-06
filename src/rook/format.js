import { config, previewLength } from "../config.js";

// Fixed, plain-text templates for everything Mimi tells Rook, so Rook never has
// to parse a card and the wording never drifts. Each starts with a label:
// AD SAMPLES / NEED CLARIFICATION / NOT IN LIBRARY.

const howLinksWork = () => `Each link plays for ${previewLength()} once they tap Watch. Unopened links expire in ${config.unopenedLinkDays} days.`;

/** One message to Rook (tagging it) built from the parts Mimi's tools produced. */
export function formatForRook(parts, rookId) {
  const tag = rookId ? `<@${rookId}> ` : "";
  const blocks = [];
  for (const p of parts) {
    if (p.type === "links") {
      blocks.push(
        [`✅ AD SAMPLES for ${p.client} (REF ${p.ref})`, ...p.links.map((l) => `${l.sample}: ${l.url}`), howLinksWork()].join("\n"),
      );
    } else if (p.type === "clarify") {
      blocks.push(
        [
          `❓ NEED CLARIFICATION for ${p.client} (REF ${p.ref})`,
          p.requested && `They asked for: "${p.requested}"`,
          `Please ask the client: "${p.question}"`,
          `Options: ${p.options.join(" | ")}`,
          `Reply to me with their answer and REF ${p.ref}.`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } else if (p.type === "catalog") {
      blocks.push(
        [
          "📚 AD SAMPLE LIBRARY (one link per lead type; ask me with the agent's name and the lead type)",
          ...p.groups.map((g) => `${g.vertical}: ${g.samples.join(" | ")}`),
        ].join("\n"),
      );
    } else if (p.type === "unavailable") {
      blocks.push(
        `⚠️ NOT IN LIBRARY for ${p.client}: ${p.items
          .map((i) => `"${i.requested}"${i.closest ? ` (closest we have: ${i.closest})` : ""}`)
          .join(", ")}. Tell me if one of the closest ones works and I'll send it.`,
      );
    }
  }
  return `${tag}${blocks.join("\n\n")}`.slice(0, 1990);
}

const firstName = (name) => String(name ?? "").trim().split(/\s+/)[0] || "there";

/**
 * In client SMS threads the parts become drafts for a teammate to send:
 * { drafts: [client texts], notes: [internal "//" notes] }.
 */
export function formatForSms(parts) {
  const drafts = [];
  const notes = [];
  for (const p of parts) {
    if (p.type === "links") {
      drafts.push(
        [`Hi ${firstName(p.client)}! Here ${p.links.length === 1 ? "is the ad video" : "are the ad videos"} for your leads:`, ...p.links.map((l) => `${l.sample}: ${l.url}`), howLinksWork()].join("\n"),
      );
    } else if (p.type === "clarify") {
      drafts.push(`Hi ${firstName(p.client)}! ${p.question}`);
      notes.push(`// Waiting on ${p.client} to pick: ${p.options.join(" | ")} (REF ${p.ref})`);
    } else if (p.type === "unavailable") {
      notes.push(`// Not in the ad sample library: ${p.items.map((i) => `"${i.requested}"${i.closest ? ` (closest: ${i.closest})` : ""}`).join(", ")}`);
    }
  }
  return { drafts, notes };
}

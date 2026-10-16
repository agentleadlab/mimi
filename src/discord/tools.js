import { ChannelType } from "discord.js";
import { config } from "../config.js";
import { getState, setState } from "../store.js";
import { card } from "../ui.js";

// Names Mimi resolved before (name -> user ID), so lookups stay stable.
const KNOWN_KEY = "knownMembers";

const norm = (s) => String(s ?? "").trim().replace(/^@/, "").toLowerCase();

/** Resolve a teammate's name to a Discord user ID: config, then remembered, then a server search. */
export async function resolveMember(guild, name) {
  const key = norm(name);
  if (/^\d{15,25}$/.test(key)) return { id: key };
  const fromConfig = config.teamMentions[key];
  if (fromConfig) return { id: fromConfig };
  const known = getState(KNOWN_KEY)?.[key];
  if (known) return { id: known };
  if (!guild) return { error: `I can only look up "${name}" inside a server.` };

  const found = await guild.members.search({ query: name.replace(/^@/, ""), limit: 10 }).catch(() => null);
  const members = [...(found?.values() ?? [])].filter((m) => !m.user.bot);
  const exact = members.filter((m) =>
    [m.displayName, m.user.username, m.user.globalName].some((n) => norm(n) === key || norm(n).split(/[\s|·•-]+/)[0] === key),
  );
  const pick = exact.length === 1 ? exact[0] : members.length === 1 ? members[0] : null;
  if (pick) {
    setState(KNOWN_KEY, { ...(getState(KNOWN_KEY) ?? {}), [key]: pick.id });
    return { id: pick.id };
  }
  const options = (exact.length ? exact : members).slice(0, 5).map((m) => `${m.displayName} (@${m.user.username})`);
  return { error: options.length ? `"${name}" matches several people: ${options.join(", ")}. Ask which one.` : `No one in the server matches "${name}".` };
}

/** Find the target channel: an ID or <#mention>, a name, the configured marketing channel, or one named like "marketing". */
export function resolveChannel(guild, query) {
  if (!guild) return null;
  const channels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement);
  const q = String(query ?? "").trim();
  const id = q.match(/^<#(\d+)>$/)?.[1] ?? (/^\d{15,25}$/.test(q) ? q : null);
  if (id) return channels.get(id) ?? null;
  if (!q || q.toLowerCase() === "marketing") {
    if (config.marketingChannelId) return channels.get(config.marketingChannelId) ?? null;
  }
  const want = (q || "marketing").toLowerCase().replace(/^#/, "");
  return channels.find((c) => c.name.toLowerCase() === want) ?? channels.find((c) => c.name.toLowerCase().includes(want)) ?? null;
}

export const discordTools = [
  {
    name: "post_to_channel",
    description:
      "Post an announcement to a Discord channel (default: the marketing channel) and tag teammates so they get notified, e.g. sharing the weekly marketing brief with Jen, K2 and Tre. " +
      "Only use when the person explicitly asks you to post or tag people. Tags go in the message text; the details go in a card. Never invent what's inside a link you haven't seen.",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel name, #mention or ID. Default: marketing." },
        mention: { type: "array", items: { type: "string" }, maxItems: 10, description: "Teammate names to tag, e.g. ['Jen', 'K2', 'Tre']." },
        message: { type: "string", description: "Short message after the tags, e.g. \"This week's Marketing Brief is ready (last 30 days).\"" },
        card_title: { type: "string", description: "e.g. 'Marketing Brief — 30 days ending Oct 16'" },
        link: { type: "string", description: "URL the card title links to (e.g. the Google Slides deck)." },
        highlights: { type: "array", items: { type: "string" }, maxItems: 6, description: "Optional key takeaways as short lines." },
      },
      required: ["message"],
    },
  },
];

export const discordToolNames = new Set(discordTools.map((t) => t.name));

export async function runDiscordTool(name, input = {}, context = {}) {
  if (name !== "post_to_channel") return { content: `Unknown tool: ${name}`, isError: true };
  const guild = context.guild;
  if (!guild) return { content: "Posting to a channel only works from inside the server, not DMs.", isError: true };
  try {
    const channel = resolveChannel(guild, input.channel);
    if (!channel) {
      return { content: `I couldn't find a "${input.channel ?? "marketing"}" channel I can see. Ask which channel, or set MARKETING_CHANNEL_ID.`, isError: true };
    }
    const ids = [];
    const problems = [];
    for (const who of input.mention ?? []) {
      const r = await resolveMember(guild, who);
      if (r.id) ids.push(r.id);
      else problems.push(r.error);
    }
    if (problems.length) return { content: `Didn't post. ${problems.join(" ")}`, isError: true };

    let link;
    try {
      link = input.link ? new URL(input.link).toString() : undefined;
    } catch {
      return { content: `"${input.link}" isn't a valid link.`, isError: true };
    }
    const tags = [...new Set(ids)].map((id) => `<@${id}>`).join(" ");
    const embed = card({
      title: input.card_title,
      description: [link && `**[Open it here](${link})**`, ...(input.highlights ?? []).map((h) => `• ${h}`)].filter(Boolean).join("\n") || undefined,
      footerText: context.requester ? `shared for ${context.requester}` : undefined,
    });
    if (link && input.card_title) embed.url = link;
    const sent = await channel.send({
      content: [tags, input.message].filter(Boolean).join(" ").slice(0, 2000),
      embeds: input.card_title || link || input.highlights?.length ? [embed] : [],
      allowedMentions: { users: [...new Set(ids)] },
    });
    console.log(`Posted to #${channel.name} for ${context.requester ?? "someone"}, tagging ${ids.length}.`);
    return { content: JSON.stringify({ posted: true, channel: `#${channel.name}`, tagged: ids.length, url: sent.url }), isError: false };
  } catch (err) {
    console.error("post_to_channel failed:", err);
    const perms = err.code === 50001 || err.code === 50013;
    return { content: perms ? "I don't have permission to post in that channel (need View Channel, Send Messages and Embed Links)." : `Couldn't post: ${err.message}`, isError: true };
  }
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_IMAGES = 5;

/**
 * Normalized shape for one Discord message, independent of discord.js:
 * { fromBot: boolean, author: string, text: string, imageUrls: string[] }
 */
export function fromDiscordMessage(message, botId, botRoleId) {
  return {
    fromBot: message.author.id === botId,
    author: message.member?.displayName ?? message.author.globalName ?? message.author.username,
    text: stripBotMention(message.content || embedsToText(message.embeds), botId, botRoleId),
    imageUrls: [...message.attachments.values()]
      .filter((a) => IMAGE_TYPES.has(a.contentType?.split(";")[0]))
      .map((a) => a.url),
  };
}

/** Mimi replies with cards (embeds); read them back as markdown for context. */
export function embedsToText(embeds = []) {
  return embeds
    .map((e) =>
      [
        e.title && `# ${e.title}`,
        e.description,
        ...(e.fields ?? []).map((f) => (f.name === "\u200b" ? f.value : `## ${f.name}\n${f.value}`)),
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .filter(Boolean)
    .join("\n");
}

export function stripBotMention(text, botId, botRoleId) {
  if (botId) text = text.replace(new RegExp(`<@!?${botId}>`, "g"), "");
  if (botRoleId) text = text.replace(new RegExp(`<@&${botRoleId}>`, "g"), "");
  return text.trim();
}

/**
 * Turn chronological channel messages into Claude messages. Mimi's own
 * messages become assistant turns; everyone else's become user turns,
 * labelled with the speaker's name. Consecutive same-role turns are merged,
 * and the result always starts and ends on a user turn. Images are only
 * attached from the latest message, to keep requests small.
 */
export function buildClaudeMessages(entries) {
  const turns = [];
  entries.forEach((entry, i) => {
    const isLatest = i === entries.length - 1;
    const role = entry.fromBot ? "assistant" : "user";
    const blocks = [];

    if (role === "user" && isLatest) {
      for (const url of entry.imageUrls.slice(0, MAX_IMAGES)) {
        blocks.push({ type: "image", source: { type: "url", url } });
      }
    }

    let text = entry.text;
    if (role === "user") {
      if (!text && entry.imageUrls.length) text = "(shared an image)";
      if (!text) return;
      text = `${entry.author}: ${text}`;
      // Spell out the URLs too, so Mimi can hand them to Canva.
      if (isLatest) {
        for (const url of entry.imageUrls.slice(0, MAX_IMAGES)) text += `\n[attached image: ${url}]`;
      }
    } else if (!text) {
      return;
    }
    blocks.push({ type: "text", text });

    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.content.push(...blocks);
    } else {
      turns.push({ role, content: blocks });
    }
  });

  while (turns.length && turns[0].role !== "user") turns.shift();
  while (turns.length && turns[turns.length - 1].role !== "user") turns.pop();
  return turns;
}

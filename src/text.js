// Discord caps a message at 2000 characters.
export const DISCORD_LIMIT = 2000;

/**
 * Split text into Discord-sized chunks, preferring paragraph, then line,
 * then word boundaries, and keeping ``` code fences balanced across chunks.
 */
export function chunkMessage(text, limit = DISCORD_LIMIT) {
  const chunks = [];
  let rest = text.trim();
  let openFence = null;

  while (rest.length > 0) {
    const prefix = openFence ? `${openFence}\n` : "";
    // Leave room for a reopened fence and a closing one.
    const room = limit - prefix.length - 4;

    if (prefix.length + rest.length <= limit) {
      chunks.push(prefix + rest);
      break;
    }

    let cut = rest.lastIndexOf("\n\n", room);
    if (cut < room / 2) cut = rest.lastIndexOf("\n", room);
    if (cut < room / 2) cut = rest.lastIndexOf(" ", room);
    if (cut <= 0) cut = room;

    let piece = rest.slice(0, cut);
    rest = rest.slice(cut).replace(/^\s+/, "");

    const fence = trailingOpenFence(prefix + piece);
    if (fence) piece += "\n```";
    chunks.push(prefix + piece);
    openFence = fence;
  }

  return chunks;
}

// Returns the opening fence (e.g. "```md") if the text ends inside a code block.
function trailingOpenFence(text) {
  let open = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(```\S*)/);
    if (m) open = open ? null : m[1];
  }
  return open;
}

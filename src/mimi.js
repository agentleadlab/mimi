import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const persona = fs.readFileSync(path.join(here, "..", "prompts", "mimi.md"), "utf8");

const canvaEnabled = Boolean(config.canvaMcpUrl);

const discordNotes = `
## Runtime Notes (Discord)

- You're replying inside a Discord channel. User turns are prefixed with the speaker's display name ("Name: message"); several people may be in the conversation. Don't prefix your own replies with your name.
- Discord renders markdown but not tables — use bullets instead of tables.
- Replies over ~1,800 characters get split across messages, so stay tight.
- ${
  canvaEnabled
    ? "You're connected to Canva through its tools. Use them for design production, and share links to what you create."
    : "Canva isn't connected in this deployment yet. For design production requests, give the full creative direction and spec (layout, copy, sizes, template fields) so the team can build it, and mention that Canva can be connected for direct production."
}
`;

const SYSTEM = [
  { type: "text", text: persona + discordNotes, cache_control: { type: "ephemeral" } },
];

const client = new Anthropic();

const BETAS = ["server-side-fallback-2026-07-01"];
if (canvaEnabled) BETAS.push("mcp-client-2025-11-20");

const MAX_CONTINUATIONS = 5;

/**
 * Ask Mimi for a reply to a conversation (Claude-format messages ending on
 * a user turn). Returns the reply text.
 */
export async function askMimi(messages) {
  const convo = [...messages];

  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const response = await client.beta.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      system: SYSTEM,
      messages: convo,
      thinking: { type: "adaptive" },
      output_config: { effort: config.effort },
      // Retry classifier refusals on Anthropic's recommended fallback model.
      fallbacks: "default",
      betas: BETAS,
      ...(canvaEnabled && {
        mcp_servers: [
          {
            type: "url",
            url: config.canvaMcpUrl,
            name: "canva",
            ...(config.canvaMcpToken && { authorization_token: config.canvaMcpToken }),
          },
        ],
        tools: [{ type: "mcp_toolset", mcp_server_name: "canva" }],
      }),
    });

    if (response.stop_reason === "refusal") {
      return "That one's outside what I can take on — give me a different angle and I'm in.";
    }

    // Long-running server tool loops can pause; hand the turn back to continue.
    if (response.stop_reason === "pause_turn") {
      convo.push({ role: "assistant", content: response.content });
      continue;
    }

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (response.stop_reason === "max_tokens") {
      return `${text}\n\n_(I ran long and got cut off — ask me to continue.)_`;
    }
    return text || "Hmm, I blanked on that one. Try rephrasing the brief?";
  }

  return "That job took more steps than I could finish in one go — try breaking it into smaller asks.";
}

/** Map API errors to a short, in-character message; rethrow anything else. */
export function describeError(err) {
  if (err instanceof Anthropic.RateLimitError) {
    return "I'm getting slammed right now — give me a minute and try again.";
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return "My Anthropic credentials aren't working — someone needs to check `ANTHROPIC_API_KEY`.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    return "That request tripped something on my end (bad request). Try again, maybe without the attachment?";
  }
  if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.InternalServerError) {
    return "Can't reach my brain right now (connection issue). Try again in a moment.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Something went sideways on my end (API error ${err.status ?? "unknown"}).`;
  }
  return "Something went sideways on my end. Try again?";
}

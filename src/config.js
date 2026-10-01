import "dotenv/config";
import fs from "node:fs";

function list(value) {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  discordToken: process.env.DISCORD_TOKEN,
  discordClientId: process.env.DISCORD_CLIENT_ID,
  // Optional: register slash commands to one server instantly instead of globally.
  discordGuildId: process.env.DISCORD_GUILD_ID,
  // Channels where Mimi replies to every message, not only @mentions.
  autoReplyChannelIds: list(process.env.MIMI_CHANNEL_IDS),
  // Reply when someone says "Mimi" in a message, no @mention needed.
  replyToName: process.env.MIMI_REPLY_TO_NAME !== "false",

  model: process.env.MIMI_MODEL || "claude-opus-5",
  effort: process.env.MIMI_EFFORT || "medium",
  maxTokens: Number(process.env.MIMI_MAX_TOKENS) || 16000,
  // How many earlier channel messages Mimi reads for context.
  historyLimit: Number(process.env.MIMI_HISTORY_LIMIT) || 20,

  // Canva Connect integration (canva.com/developers) for design production.
  canvaClientId: process.env.CANVA_CLIENT_ID,
  canvaClientSecret: process.env.CANVA_CLIENT_SECRET,
  // Public base URL of this deployment, e.g. https://mimi-production.up.railway.app
  publicUrl: process.env.PUBLIC_URL?.replace(/\/+$/, ""),
  port: Number(process.env.PORT) || 3000,
  // Where Mimi keeps state that must survive restarts (the Canva login).
  // On Railway, mount a volume here.
  dataDir: process.env.MIMI_DATA_DIR || (fs.existsSync("/data") ? "/data" : "./data"),
};

export const canvaConfigured = Boolean(config.canvaClientId && config.canvaClientSecret && config.publicUrl);

export function missingRequired() {
  const missing = [];
  if (!config.discordToken) missing.push("DISCORD_TOKEN");
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    missing.push("ANTHROPIC_API_KEY");
  }
  return missing;
}

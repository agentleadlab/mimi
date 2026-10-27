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

  // Custom status under Mimi's name. Set MIMI_STATUS to an empty string to hide it.
  status: process.env.MIMI_STATUS ?? "💅 Always raising the standard",

  model: process.env.MIMI_MODEL || "claude-opus-5",
  effort: process.env.MIMI_EFFORT || "medium",
  maxTokens: Number(process.env.MIMI_MAX_TOKENS) || 16000,
  // How many earlier channel messages Mimi reads for context.
  historyLimit: Number(process.env.MIMI_HISTORY_LIMIT) || 20,

  // Canva Connect integration (canva.com/developers) for design production.
  canvaClientId: process.env.CANVA_CLIENT_ID,
  canvaClientSecret: process.env.CANVA_CLIENT_SECRET,
  // Public base URL of this deployment, e.g. https://mimi-production.up.railway.app
  // Falls back to the domain Railway generates for the service.
  publicUrl: (
    process.env.PUBLIC_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`)
  )?.replace(/\/+$/, ""),
  port: Number(process.env.PORT) || 3000,

  // Ad sample library: a Google Sheet shared as "Anyone with the link can view".
  samplesSheetUrl: process.env.SAMPLES_SHEET_URL,
  // Clients get this long (seconds) from pressing Watch on a preview link.
  previewSeconds: Number(process.env.PREVIEW_SECONDS) || 150,
  // Links that are never opened stop working after this many days.
  unopenedLinkDays: Number(process.env.PREVIEW_LINK_DAYS) || 7,
  // Optional "Sample Log" tab: Apps Script web app URL + shared secret (scripts/sample-log.gs).
  samplesLogUrl: process.env.SAMPLES_LOG_URL,
  samplesLogSecret: process.env.SAMPLES_LOG_SECRET,
  // Shown on the client-facing preview page.
  brandName: process.env.BRAND_NAME || "Agent Lead Lab",
  // Gemini image generation (aistudio.google.com/apikey).
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiImageModel: process.env.GEMINI_IMAGE_MODEL || "gemini-nano-banana-2.1",
  // Used through the older generateContent API if the Interactions API isn't available.
  geminiLegacyImageModel: process.env.GEMINI_LEGACY_IMAGE_MODEL || "gemini-2.5-flash-image",
  // Meta Ads reporting (read-only): a system user token with ads_read, and the ad account(s).
  metaAccessToken: process.env.META_ACCESS_TOKEN,
  metaAdAccountIds: list(process.env.META_AD_ACCOUNT_IDS).map((id) => (id.startsWith("act_") ? id : `act_${id}`)),
  metaApiVersion: process.env.META_API_VERSION || "v23.0",
  // Which Meta action counts as a lead. Default: the first of the common lead actions that has data.
  metaLeadActions: list(process.env.META_LEAD_ACTION),
  // Campaigns/ad sets/ads whose names contain these are left out of numbers (e.g. MARTIN is dropped from reports).
  metaExcludeNames: list(process.env.META_EXCLUDE_NAMES ?? "MARTIN"),
  // The account's target CPL band (cheaper leads close worse on this account).
  cplBand: { low: Number(process.env.CPL_BAND_LOW) || 25, high: Number(process.env.CPL_BAND_HIGH) || 35, dead: Number(process.env.CPL_DEAD) || 45 },
  // Team members Mimi can tag, as "Name=DiscordUserID" pairs (e.g. "Jen=123,K2=456,Tre=789").
  // Names not listed here are looked up in the server by name.
  teamMentions: Object.fromEntries(
    list(process.env.TEAM_MENTIONS)
      .map((pair) => pair.split("=").map((x) => x.trim()))
      .filter(([name, id]) => name && /^\d{15,25}$/.test(id ?? ""))
      .map(([name, id]) => [name.toLowerCase(), id]),
  ),
  // Where announcements like the marketing brief go (channel ID). Default: a channel named like "marketing".
  marketingChannelId: process.env.MARKETING_CHANNEL_ID,
  // Client-facing channels (agents who bought leads). There Mimi only shares ad samples, by the
  // channel's lead type, once per channel, and has no access to internal tools or data.
  // CLIENT_CATEGORY_IDS: channel categories holding client channels (use this when client and
  // team channels share one server). CLIENT_GUILD_IDS: whole servers that are client-only.
  clientCategoryIds: list(process.env.CLIENT_CATEGORY_IDS),
  clientGuildIds: list(process.env.CLIENT_GUILD_IDS),
  // Where Mimi keeps state that must survive restarts (the Canva login).
  // On Railway, mount a volume here.
  dataDir: process.env.MIMI_DATA_DIR || (fs.existsSync("/data") ? "/data" : "./data"),
};

export function missingCanvaVars() {
  return [
    !config.canvaClientId && "CANVA_CLIENT_ID",
    !config.canvaClientSecret && "CANVA_CLIENT_SECRET",
    !config.publicUrl && "PUBLIC_URL",
  ].filter(Boolean);
}

export const canvaConfigured = missingCanvaVars().length === 0;

export function missingRequired() {
  const missing = [];
  if (!config.discordToken) missing.push("DISCORD_TOKEN");
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    missing.push("ANTHROPIC_API_KEY");
  }
  return missing;
}

/** The preview window in words, e.g. "2 min 30 sec". */
export function previewLength() {
  const m = Math.floor(config.previewSeconds / 60);
  const sec = config.previewSeconds % 60;
  return [m && `${m} min`, sec && `${sec} sec`].filter(Boolean).join(" ") || "0 sec";
}

/** A whole server that's client-only. */
export const isClientGuild = (guildId) => Boolean(guildId) && config.clientGuildIds.includes(guildId);

/** Is this channel (or thread) client-facing? By server, or by the category it sits in. */
export function isClientChannel(channel) {
  if (!channel?.guildId) return false;
  if (isClientGuild(channel.guildId)) return true;
  const category = channel.isThread?.() ? channel.parent?.parentId : channel.parentId;
  return Boolean(category) && config.clientCategoryIds.includes(category);
}

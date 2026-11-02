import { ActivityType, ChannelType, Client, Events, GatewayIntentBits, MessageFlags, Partials } from "discord.js";
import { canvaConfigured, config, isAllowedBot, isClientChannel, mentionsAds, missingCanvaVars, missingRequired } from "./config.js";
import { forgetShare, setShareMessage } from "./samples/clientShare.js";
import { askMimi, describeError } from "./mimi.js";
import { buildClaudeMessages, fromDiscordMessage } from "./history.js";
import { COLORS, noticeCard, replyMessages, setIdentity } from "./ui.js";
import { clientCommandNames, commandsByName } from "./commands.js";
import { registerCommands } from "./deploy-commands.js";
import { ensureGuildInstallSettings, inviteUrl } from "./install.js";
import { startServer } from "./server.js";
import { ProgressCard, startStep } from "./progress.js";

const missing = missingRequired();
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(", ")}. Copy .env.example to .env and fill them in.`);
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Mimi is online as ${c.user.tag} (model: ${config.model}).`);
  setIdentity({ name: c.user.displayName ?? c.user.username, avatarUrl: c.user.displayAvatarURL({ size: 128 }) });
  if (config.status) {
    c.user.setActivity({ type: ActivityType.Custom, name: "Custom Status", state: config.status });
  }
  // Keep slash commands in sync on every start, so hosting needs no extra step.
  registerCommands(c.application.id, [...c.guilds.cache.keys()]).catch((err) =>
    console.error("Slash command registration failed:", err),
  );

  ensureGuildInstallSettings(c)
    .then((changed) => changed && console.log("Updated the app's server install settings to add Mimi as a bot member."))
    .catch((err) => console.error("Couldn't update install settings:", err.message));

  const url = inviteUrl(c.application.id);
  if (c.guilds.cache.size === 0) {
    console.warn(
      `Mimi isn't a member of any server yet, so she can't be @mentioned or read messages. Add her with:\n${url}`,
    );
  } else {
    console.log(`Member of: ${c.guilds.cache.map((g) => g.name).join(", ")}. Invite link: ${url}`);
  }
});

// When Mimi joins a new server, give it her commands right away.
client.on(Events.GuildCreate, (guild) => {
  registerCommands(client.application.id, [guild.id]).catch((err) =>
    console.error(`Slash command registration failed for ${guild.name}:`, err),
  );
});

// Discord's @ autocomplete often picks Mimi's auto-created bot role instead of
// her user, so a mention of that role counts too.
function botRoleId(message) {
  return message.guild?.members.me?.roles.botRole?.id;
}

const NAME_PATTERN = /\bmimi\b/i;

// Bots like Rook can ask Mimi for ad samples by @mentioning her. A cap per
// channel keeps two bots from replying to each other in a loop.
const BOT_WINDOW_MS = 10 * 60 * 1000;
const BOT_MAX_PER_WINDOW = 6;
const botReplies = new Map(); // channelId -> timestamps

function botAllowance(channelId, { consume = true } = {}) {
  const now = Date.now();
  const recent = (botReplies.get(channelId) ?? []).filter((t) => now - t < BOT_WINDOW_MS);
  botReplies.set(channelId, recent);
  if (recent.length >= BOT_MAX_PER_WINDOW) return false;
  if (consume) recent.push(now);
  return true;
}

/** A bot message in a watched channel that might be about ads, without @mentioning Mimi. */
function isWatchedBotMessage(message) {
  return (
    message.author.bot &&
    isAllowedBot(message.author) &&
    config.botWatchChannelIds.includes(message.channelId) &&
    !message.mentions.users.has(client.user.id) &&
    mentionsAds(message.content)
  );
}

async function shouldReply(message) {
  if (message.author.id === client.user.id) return false;
  if (message.author.bot) {
    // Only allowed bots, only on a direct @mention of Mimi (or her role), within the loop cap.
    if (!isAllowedBot(message.author)) return false;
    const roleId = botRoleId(message);
    const mentioned = message.mentions.users.has(client.user.id) || (roleId && message.mentions.roles.has(roleId));
    // In watched channels, ad-related bot messages are read without a mention (Mimi decides whether to answer).
    if (!mentioned) return isWatchedBotMessage(message) && botAllowance(message.channelId, { consume: false });
    if (!botAllowance(message.channelId)) {
      console.warn(`Ignoring ${message.author.username} in #${message.channel.name}: too many bot requests in 10 min.`);
      return false;
    }
    return true;
  }
  if (message.channel.type === ChannelType.DM) return true;
  if (message.mentions.users.has(client.user.id)) return true;
  const roleId = botRoleId(message);
  if (roleId && message.mentions.roles.has(roleId)) return true;
  if (config.replyToName && NAME_PATTERN.test(message.content)) return true;
  if (config.autoReplyChannelIds.includes(message.channelId)) return true;
  if (message.reference?.messageId) {
    const ref = await message.fetchReference().catch(() => null);
    if (ref?.author.id === client.user.id) return true;
  }
  return false;
}

// Keep the typing indicator alive until the reply is ready.
function keepTyping(channel) {
  channel.sendTyping().catch(() => {});
  const timer = setInterval(() => channel.sendTyping().catch(() => {}), 8000);
  return () => clearInterval(timer);
}

client.on(Events.MessageCreate, async (message) => {
  if (!(await shouldReply(message))) return;

  // Watched bot messages (e.g. Rook tagging Tre about a client) may not need an answer:
  // stay quiet (no typing, no progress card) until Mimi decides to reply.
  const watched = isWatchedBotMessage(message);
  const stopTyping = watched ? () => {} : keepTyping(message.channel);
  let progress;
  try {
    const earlier = await message.channel.messages
      .fetch({ limit: config.historyLimit, before: message.id })
      .catch(() => new Map());
    const entries = [...earlier.values()]
      .reverse()
      .concat(message)
      .map((m) => fromDiscordMessage(m, client.user.id, botRoleId(message)));

    const requester = message.member?.displayName ?? message.author.globalName ?? message.author.username;
    const files = [];
    // In client servers, Mimi only shares ad samples (by channel lead type, once per channel).
    const clientContext = isClientChannel(message.channel) ? { channel: message.channel, botId: client.user.id, shared: false } : undefined;
    const claudeMessages = buildClaudeMessages(entries);
    const imageCount = claudeMessages.flatMap((m) => m.content).filter((b) => b.type === "image").length;
    // Slower jobs get a live progress card that turns into the answer.
    if (!watched) {
      progress = new ProgressCard({ post: (p) => replyTo(message, p), edit: (m, p) => m.edit(p), requester }, startStep({ imageCount }));
    }
    const reply = await askMimi(claudeMessages, {
      requester,
      files,
      guild: message.guild,
      clientContext,
      progress,
      fromBot: message.author.bot ? message.author.username : undefined,
      watched,
    });
    stopTyping();
    if (watched) {
      if (/^\s*NO_REPLY\s*$/.test(reply)) return; // not about ads: say nothing
      botAllowance(message.channelId); // count it toward the loop cap
    }

    try {
      const sent = await send(message, replyMessages(reply, { requester, files }), progress);
      if (clientContext?.shared) setShareMessage(message.channel.id, sent.url);
    } catch (err) {
      if (clientContext?.shared) forgetShare(message.channel.id); // nothing reached the channel
      throw err;
    }
  } catch (err) {
    stopTyping();
    console.error(err);
    const notice = { embeds: [noticeCard(describeError(err), { color: COLORS.error })] };
    const shown = await progress?.cancel();
    await (shown ? shown.edit({ ...notice, attachments: [] }) : send(message, [notice])).catch((e) =>
      console.error("Couldn't send error message:", e),
    );
  }
});

// Reply to the message; if Discord refuses (e.g. Mimi lacks Read Message
// History in that channel), fall back to a plain message so she isn't silent.
async function replyTo(message, payload) {
  try {
    return await message.reply({ ...payload, allowedMentions: { repliedUser: false } });
  } catch (err) {
    console.warn(`Reply failed in #${message.channel.name ?? message.channelId} (${err.message}); sending plainly.`);
    return message.channel.send(payload);
  }
}

/** Send reply payloads; the first replaces the progress card if one is showing. Returns the first message. */
async function send(message, payloads, progress) {
  const [first, ...rest] = payloads;
  const sent = progress ? await progress.finish(first) : await replyTo(message, first);
  for (const p of rest) await message.channel.send(p);
  return sent;
}

// Discord error 10062: the interaction was already answered (e.g. by the old
// instance during a redeploy) or took over 3 seconds to acknowledge.
const isExpiredInteraction = (err) => err?.code === 10062;
const logExpired = (interaction) =>
  console.warn(`Skipped /${interaction.commandName}: Discord says it was already handled or timed out.`);

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    const command = commandsByName.get(interaction.commandName);
    return command?.autocomplete?.(interaction).catch((err) => console.warn("Autocomplete failed:", err.message));
  }
  if (!interaction.isChatInputCommand()) return;
  const command = commandsByName.get(interaction.commandName);
  if (!command) return;
  if (isClientChannel(interaction.channel) && !clientCommandNames.has(interaction.commandName)) {
    return interaction
      .reply({ embeds: [noticeCard("That command isn't available here.")], flags: MessageFlags.Ephemeral })
      .catch(() => {});
  }
  if (command.handle) {
    return command.handle(interaction).catch((err) => {
      if (isExpiredInteraction(err)) return logExpired(interaction);
      console.error(err);
      interaction
        .editReply({ embeds: [noticeCard("Something went sideways on my end. Try again?", { color: COLORS.error })] })
        .catch(() => {});
    });
  }

  try {
    await interaction.deferReply();
  } catch (err) {
    if (isExpiredInteraction(err)) return logExpired(interaction);
    throw err;
  }
  try {
    const attachment = interaction.options.getAttachment("image") ?? interaction.options.getAttachment("design");
    const messages = buildClaudeMessages([
      {
        fromBot: false,
        author: interaction.member?.displayName ?? interaction.user.globalName ?? interaction.user.username,
        text: command.brief(interaction.options),
        imageUrls: attachment?.contentType?.startsWith("image/") ? [attachment.url] : [],
      },
    ]);

    const requester = interaction.member?.displayName ?? interaction.user.username;
    const files = [];
    const progress = new ProgressCard(
      { post: (p) => interaction.editReply(p), edit: (_m, p) => interaction.editReply(p), requester },
      startStep({ imageCount: attachment?.contentType?.startsWith("image/") ? 1 : 0 }),
    );
    try {
      const reply = await askMimi(messages, { requester, files, guild: interaction.guild, progress });
      const [first, ...rest] = replyMessages(reply, { requester, files });
      await progress.finish(first);
      for (const p of rest) await interaction.followUp(p);
    } finally {
      await progress.cancel();
    }
  } catch (err) {
    console.error(err);
    await interaction.editReply({ embeds: [noticeCard(describeError(err), { color: COLORS.error })], attachments: [] }).catch(() => {});
  }
});

// The web server hosts sample preview pages and the Canva sign-in callback.
if (config.publicUrl) {
  startServer({
    onCanvaConnected: ({ connectedBy }) => console.log(`Canva connected by ${connectedBy}.`),
  });
} else {
  console.log("No public URL (generate a Railway domain or set PUBLIC_URL) — sample previews and Canva are off.");
}
if (!canvaConfigured) console.log(`Canva not configured — missing: ${missingCanvaVars().join(", ")}.`);

client.login(config.discordToken);

import { ActivityType, ChannelType, Client, Events, GatewayIntentBits, MessageFlags, Partials } from "discord.js";
import {
  canvaConfigured,
  config,
  isAllowedBot,
  isClientChannel,
  isSmsRelay,
  isWatchedChannel,
  mentionsAds,
  missingCanvaVars,
  missingRequired,
} from "./config.js";
import { forgetShare, setShareMessage } from "./samples/clientShare.js";
import { askMimi, describeError } from "./mimi.js";
import { buildClaudeMessages, fromDiscordMessage } from "./history.js";
import { COLORS, noticeCard, parseReply, replyMessages, setIdentity } from "./ui.js";
import { clientCommandNames, commandsByName } from "./commands.js";
import { registerCommands } from "./deploy-commands.js";
import { ensureGuildInstallSettings, inviteUrl, missingChannelPermissions } from "./install.js";
import { startServer } from "./server.js";
import { ProgressCard, startStep } from "./progress.js";
import { SEND_EMOJI, claimDraft, draftMessage, releaseDraft, saveDraft, sentMessage } from "./smsDrafts.js";
import { openRequestsIn, refsIn } from "./rook/requests.js";
import { formatForRook, formatForSms } from "./rook/format.js";

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
    // For the 📤 "send this draft" reaction in client SMS threads.
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
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

  // Check the channels where Mimi answers Rook, and say plainly what's missing.
  for (const id of config.botWatchChannelIds.filter((x) => x !== "*")) {
    const channel = c.channels.cache.get(id);
    if (!channel) {
      console.warn(`Rook channel ${id}: Mimi can't see it (not in that server, or no View Channel).`);
      continue;
    }
    const missing = missingChannelPermissions(channel, channel.guild.members.me);
    console.log(missing.length ? `#${channel.name}: Mimi is missing ${missing.join(", ")}.` : `#${channel.name}: all permissions OK (threads included).`);
  }

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

/** The channel a conversation lives in (a thread's parent), for matching Rook's answers to open questions. */
const homeChannelId = (channel) => (channel.isThread?.() ? channel.parentId : channel.id);

/**
 * A bot message, not addressed to Mimi, in a watched channel, that might need her:
 * it's about ads, names a request ref (AS-12), or there's an open question waiting there.
 */
function isWatchedBotMessage(message) {
  if (!(message.author.bot && isAllowedBot(message.author) && isWatchedChannel(message.channel))) return false;
  if (message.mentions.users.has(client.user.id)) return false;
  return (
    mentionsAds(message.content) ||
    refsIn(message.content).length > 0 ||
    openRequestsIn(homeChannelId(message.channel)).length > 0
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
    if (!botAllowance(message.channelId, { consume: false })) {
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
  // Threads Mimi started (e.g. on a Rook request): teammates can answer her without tagging.
  if (message.channel.isThread?.() && message.channel.ownerId === client.user.id) return true;
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
  // Client SMS threads: Rook texts anything without a leading "//" to the client.
  const smsRelay = isSmsRelay(message.channel);
  // Answers to Rook go in a thread on its message, keeping its channel clean.
  const useThread = message.author.bot && Boolean(message.guild) && !message.channel.isThread?.() && !smsRelay;
  // Rook's requests (and anything in a client SMS thread) are answered in fixed formats.
  const rook = message.author.bot || smsRelay ? { parts: [], homeChannelId: homeChannelId(message.channel), channelId: message.channel.id } : undefined;
  const stopTyping = watched || useThread || smsRelay ? () => {} : keepTyping(message.channel);
  let progress;
  try {
    const earlier = await message.channel.messages
      .fetch({ limit: config.historyLimit, before: message.id })
      .catch(() => new Map());
    const history = [...earlier.values()].reverse();
    // Inside a thread, include the message the thread was started from (e.g. Rook's request).
    if (message.channel.isThread?.()) {
      const starter = await message.channel.fetchStarterMessage().catch(() => null);
      if (starter && !history.some((m) => m.id === starter.id)) history.unshift(starter);
    }
    const entries = history.concat(message).map((m) => fromDiscordMessage(m, client.user.id, botRoleId(message)));

    const requester = message.member?.displayName ?? message.author.globalName ?? message.author.username;
    const files = [];
    // In client servers, Mimi only shares ad samples (by channel lead type, once per channel).
    const clientContext = isClientChannel(message.channel) ? { channel: message.channel, botId: client.user.id, shared: false } : undefined;
    const claudeMessages = buildClaudeMessages(entries);
    const imageCount = claudeMessages.flatMap((m) => m.content).filter((b) => b.type === "image").length;
    // Slower jobs get a live progress card that turns into the answer.
    if (!watched && !useThread && !smsRelay) {
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
      smsRelay,
      rook,
    });
    stopTyping();

    if (rook) {
      if (!rook.parts.length) return; // nothing for Mimi to do (NO_REPLY / not about ad samples)
      botAllowance(message.channelId); // count it toward the loop cap
      if (smsRelay) {
        // Mimi never texts the client herself: client texts become "//" drafts a teammate
        // sends with 📤 (or copies); everything else is a "//" note.
        const { drafts, notes } = formatForSms(rook.parts);
        for (const text of drafts) {
          const draft = await message.channel.send({ content: draftMessage(text), allowedMentions: { parse: [] } });
          saveDraft(draft.id, { channelId: message.channel.id, text, requestedBy: requester });
          await draft.react(SEND_EMOJI).catch(() => {});
        }
        for (const note of notes) await message.channel.send({ content: note, allowedMentions: { parse: [] } });
        console.log(`SMS thread #${message.channel.name}: ${drafts.length} draft(s), ${notes.length} note(s).`);
        return;
      }
      // To Rook: one plain-text message in a fixed format, tagging Rook so it picks it up.
      const rookId = message.author.bot ? message.author.id : config.allowedBotIds[0];
      const content = formatForRook(rook.parts, rookId);
      const client0 = rook.parts[0]?.client ?? "client";
      const thread = useThread ? await threadFor(message, `Ad samples — ${client0}`) : null;
      const payload = { content, allowedMentions: { users: rookId ? [rookId] : [] } };
      if (thread) await thread.send(payload);
      else await replyTo(message, payload);
      console.log(`Answered Rook in #${(thread ?? message.channel).name}: ${rook.parts.map((p) => p.type).join(", ")}.`);
      return;
    }

    try {
      const payloads = replyMessages(reply, { requester, files });
      const thread = useThread ? await threadFor(message, parseReply(reply).title) : null;
      if (useThread && !thread) {
        const tip = threadTip(message.channel);
        if (tip) payloads.push(tip);
      }
      const sent = thread ? await sendAll(thread, payloads) : await send(message, payloads, progress);
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

/** The thread on a message (created if needed), or null if Mimi can't make one. */
async function threadFor(message, title) {
  if (message.thread) return message.thread;
  const name = (title || "Ad sample").replace(/[*_`~|#]/g, "").trim().slice(0, 95) || "Ad sample";
  try {
    return await message.startThread({ name, autoArchiveDuration: 1440 });
  } catch (err) {
    console.warn(`Couldn't start a thread in #${message.channel.name} (${err.message}); replying in the channel.`);
    return null;
  }
}

// Say once per channel (per restart) why Mimi answered in the channel instead of a thread.
const tippedChannels = new Set();
function threadTip(channel) {
  if (tippedChannels.has(channel.id)) return null;
  tippedChannels.add(channel.id);
  const missing = missingChannelPermissions(channel, channel.guild.members.me).filter((p) => /Thread/.test(p));
  return {
    embeds: [
      noticeCard(
        `I couldn't start a thread here, so I answered in the channel. Give me ${
          missing.length ? missing.map((p) => `**${p.replace(/([a-z])([A-Z])/g, "$1 $2")}**`).join(" and ") : "**Create Public Threads**"
        } in #${channel.name} and I'll keep Rook's answers in threads.`,
      ),
    ],
  };
}

async function sendAll(channel, payloads) {
  let first;
  for (const p of payloads) {
    const sent = await channel.send(p);
    first ??= sent;
  }
  return first;
}

// Reply to the message; if Discord refuses (e.g. Mimi lacks Read Message
// History in that channel), fall back to a plain message so she isn't silent.
async function replyTo(message, payload) {
  try {
    return await message.reply({ ...payload, allowedMentions: { repliedUser: false, ...payload.allowedMentions } });
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

// A teammate reacts 📤 on Mimi's draft in a client SMS thread: post it as-is (without
// "//"), so Rook texts it to the client. One send per draft; bots can't trigger it.
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) reaction = await reaction.fetch();
    if (reaction.emoji.name !== SEND_EMOJI) return;
    const draftMsg = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
    if (draftMsg.author?.id !== client.user.id || !isSmsRelay(draftMsg.channel)) return;
    const member = await draftMsg.guild?.members.fetch(user.id).catch(() => null);
    const who = member?.displayName ?? user.globalName ?? user.username;
    const draft = claimDraft(draftMsg.id, who);
    if (!draft) return; // unknown draft, or already sent
    try {
      await draftMsg.channel.send({ content: draft.text, allowedMentions: { parse: [] } });
    } catch (err) {
      releaseDraft(draftMsg.id);
      throw err;
    }
    await draftMsg.edit({ content: sentMessage(draft.text, who), allowedMentions: { parse: [] } }).catch(() => {});
    console.log(`SMS draft sent by ${who} in #${draftMsg.channel.name}.`);
  } catch (err) {
    console.error("Sending SMS draft failed:", err);
  }
});

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

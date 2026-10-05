import { ActivityType, ChannelType, Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { canvaConfigured, config, missingCanvaVars, missingRequired } from "./config.js";
import { askMimi, describeError } from "./mimi.js";
import { buildClaudeMessages, fromDiscordMessage } from "./history.js";
import { chunkMessage } from "./text.js";
import { commandsByName } from "./commands.js";
import { registerCommands } from "./deploy-commands.js";
import { ensureGuildInstallSettings, inviteUrl } from "./install.js";
import { startServer } from "./server.js";

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
  c.user.setActivity("your briefs", { type: ActivityType.Listening });
  // Keep slash commands in sync on every start, so hosting needs no extra step.
  registerCommands(c.application.id).catch((err) => console.error("Slash command registration failed:", err));

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

// Discord's @ autocomplete often picks Mimi's auto-created bot role instead of
// her user, so a mention of that role counts too.
function botRoleId(message) {
  return message.guild?.members.me?.roles.botRole?.id;
}

const NAME_PATTERN = /\bmimi\b/i;

async function shouldReply(message) {
  if (message.author.bot) return false;
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

  const stopTyping = keepTyping(message.channel);
  try {
    const earlier = await message.channel.messages
      .fetch({ limit: config.historyLimit, before: message.id })
      .catch(() => new Map());
    const entries = [...earlier.values()]
      .reverse()
      .concat(message)
      .map((m) => fromDiscordMessage(m, client.user.id, botRoleId(message)));

    const reply = await askMimi(buildClaudeMessages(entries));
    stopTyping();

    await send(message, chunkMessage(reply));
  } catch (err) {
    stopTyping();
    console.error(err);
    await send(message, [describeError(err)]).catch((e) => console.error("Couldn't send error message:", e));
  }
});

// Reply to the message; if Discord refuses (e.g. Mimi lacks Read Message
// History in that channel), fall back to a plain message so she isn't silent.
async function send(message, chunks) {
  const [first, ...rest] = chunks;
  try {
    await message.reply({ content: first, allowedMentions: { repliedUser: false } });
  } catch (err) {
    console.warn(`Reply failed in #${message.channel.name ?? message.channelId} (${err.message}); sending plainly.`);
    await message.channel.send(first);
  }
  for (const chunk of rest) await message.channel.send(chunk);
}

// Discord error 10062: the interaction was already answered (e.g. by the old
// instance during a redeploy) or took over 3 seconds to acknowledge.
const isExpiredInteraction = (err) => err?.code === 10062;
const logExpired = (interaction) =>
  console.warn(`Skipped /${interaction.commandName}: Discord says it was already handled or timed out.`);

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = commandsByName.get(interaction.commandName);
  if (!command) return;
  if (command.handle) {
    return command.handle(interaction).catch((err) => {
      if (isExpiredInteraction(err)) return logExpired(interaction);
      console.error(err);
      interaction.editReply("Something went sideways on my end. Try again?").catch(() => {});
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

    const reply = await askMimi(messages);
    const [first, ...rest] = chunkMessage(reply);
    await interaction.editReply(first);
    for (const chunk of rest) await interaction.followUp(chunk);
  } catch (err) {
    console.error(err);
    await interaction.editReply(describeError(err)).catch(() => {});
  }
});

if (canvaConfigured) {
  startServer({
    onCanvaConnected: ({ connectedBy }) => console.log(`Canva connected by ${connectedBy}.`),
  });
} else {
  console.log(`Canva not configured — missing: ${missingCanvaVars().join(", ")}.`);
}

client.login(config.discordToken);

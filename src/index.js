import { ActivityType, ChannelType, Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { config, missingRequired } from "./config.js";
import { askMimi, describeError } from "./mimi.js";
import { buildClaudeMessages, fromDiscordMessage } from "./history.js";
import { chunkMessage } from "./text.js";
import { commandsByName } from "./commands.js";
import { registerCommands } from "./deploy-commands.js";

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
});

async function shouldReply(message) {
  if (message.author.bot) return false;
  if (message.channel.type === ChannelType.DM) return true;
  if (message.mentions.users.has(client.user.id)) return true;
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
      .map((m) => fromDiscordMessage(m, client.user.id));

    const reply = await askMimi(buildClaudeMessages(entries));
    stopTyping();

    const [first, ...rest] = chunkMessage(reply);
    await message.reply({ content: first, allowedMentions: { repliedUser: false } });
    for (const chunk of rest) await message.channel.send(chunk);
  } catch (err) {
    stopTyping();
    console.error(err);
    await message.reply(describeError(err)).catch(() => {});
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = commandsByName.get(interaction.commandName);
  if (!command) return;

  await interaction.deferReply();
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

client.login(config.discordToken);

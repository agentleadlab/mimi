import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { commands } from "./commands.js";

if (!config.discordToken || !config.discordClientId) {
  console.error("Set DISCORD_TOKEN and DISCORD_CLIENT_ID in .env first.");
  process.exit(1);
}

const rest = new REST().setToken(config.discordToken);
const body = commands.map((c) => c.data.toJSON());

const route = config.discordGuildId
  ? Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId)
  : Routes.applicationCommands(config.discordClientId);

await rest.put(route, { body });
console.log(
  `Registered ${body.length} slash commands ${
    config.discordGuildId ? `to server ${config.discordGuildId}` : "globally (can take up to an hour to appear)"
  }.`,
);

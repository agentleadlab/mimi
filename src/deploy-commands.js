import { pathToFileURL } from "node:url";
import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { commands } from "./commands.js";

/** Register slash commands with Discord (to one server if DISCORD_GUILD_ID is set, else globally). */
export async function registerCommands(applicationId = config.discordClientId) {
  const rest = new REST().setToken(config.discordToken);
  const body = commands.map((c) => c.data.toJSON());

  const route = config.discordGuildId
    ? Routes.applicationGuildCommands(applicationId, config.discordGuildId)
    : Routes.applicationCommands(applicationId);

  await rest.put(route, { body });
  console.log(
    `Registered ${body.length} slash commands ${
      config.discordGuildId ? `to server ${config.discordGuildId}` : "globally (can take up to an hour to appear)"
    }.`,
  );
}

// Run directly: `npm run deploy-commands`
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!config.discordToken || !config.discordClientId) {
    console.error("Set DISCORD_TOKEN and DISCORD_CLIENT_ID in .env first.");
    process.exit(1);
  }
  await registerCommands();
}

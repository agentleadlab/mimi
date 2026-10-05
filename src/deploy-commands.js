import { pathToFileURL } from "node:url";
import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { commands } from "./commands.js";

/**
 * Register slash commands with Discord.
 * - With `guildIds` (Mimi passes the servers she's in): per-server commands, which
 *   show up within seconds, and any old global copies are cleared to avoid duplicates.
 * - Otherwise: DISCORD_GUILD_ID if set, else globally (can take up to an hour).
 */
export async function registerCommands(applicationId = config.discordClientId, guildIds) {
  const rest = new REST().setToken(config.discordToken);
  const body = commands.map((c) => c.data.toJSON());
  const targets = guildIds?.length ? guildIds : config.discordGuildId ? [config.discordGuildId] : null;

  if (!targets) {
    await rest.put(Routes.applicationCommands(applicationId), { body });
    console.log(`Registered ${body.length} slash commands globally (can take up to an hour to appear).`);
    return;
  }

  for (const guildId of targets) {
    await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body });
  }
  console.log(`Registered ${body.length} slash commands in ${targets.length} server(s).`);
  if (guildIds?.length) await rest.put(Routes.applicationCommands(applicationId), { body: [] });
}

// Run directly: `npm run deploy-commands`
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!config.discordToken || !config.discordClientId) {
    console.error("Set DISCORD_TOKEN and DISCORD_CLIENT_ID in .env first.");
    process.exit(1);
  }
  await registerCommands();
}

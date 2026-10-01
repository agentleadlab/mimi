import { OAuth2Scopes, PermissionFlagsBits, PermissionsBitField, Routes } from "discord.js";

// What Mimi needs in a channel to read and answer plain messages.
const BOT_PERMISSIONS = new PermissionsBitField([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
]);

const GUILD_INSTALL = "0";
const GUILD_SCOPES = [OAuth2Scopes.ApplicationsCommands, OAuth2Scopes.Bot];

export function inviteUrl(applicationId) {
  const params = new URLSearchParams({
    client_id: applicationId,
    permissions: BOT_PERMISSIONS.bitfield.toString(),
    integration_type: GUILD_INSTALL,
    scope: GUILD_SCOPES.join(" "),
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

/**
 * Make sure the app's server install link adds Mimi as a bot member (not just
 * her slash commands). Without the `bot` scope she can't be @mentioned or see
 * messages. Leaves any other install settings, like User Install, as they are.
 */
export async function ensureGuildInstallSettings(client) {
  const app = await client.rest.get(Routes.currentApplication());
  const config = app.integration_types_config ?? {};
  const current = config[GUILD_INSTALL]?.oauth2_install_params;

  const hasScopes = GUILD_SCOPES.every((s) => current?.scopes?.includes(s));
  const hasPerms =
    current?.permissions != null &&
    new PermissionsBitField(BigInt(current.permissions)).has(BOT_PERMISSIONS);
  if (hasScopes && hasPerms) return false;

  await client.rest.patch(Routes.currentApplication(), {
    body: {
      integration_types_config: {
        ...config,
        [GUILD_INSTALL]: {
          oauth2_install_params: {
            scopes: GUILD_SCOPES,
            permissions: BOT_PERMISSIONS.bitfield.toString(),
          },
        },
      },
    },
  });
  return true;
}

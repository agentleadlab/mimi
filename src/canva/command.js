import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { canvaConfigured, config, missingCanvaVars } from "../config.js";
import { connection, createConnectLink, disconnect, redirectUri } from "./auth.js";
import { canva } from "./api.js";
import { describeCanvaError } from "./tools.js";

function notConfiguredMessage() {
  return (
    `Canva isn't set up on the server yet — missing: ${missingCanvaVars().map((v) => `\`${v}\``).join(", ")}. ` +
    "Add them in Railway's Variables tab (exact names, on the mimi service), deploy, then try again."
  );
}

/** Admin-only /canva command: connect, status, disconnect. */
export const canvaCommand = {
  data: new SlashCommandBuilder()
    .setName("canva")
    .setDescription("Connect Mimi to your Canva account")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName("connect").setDescription("Sign in to Canva so Mimi can create designs"))
    .addSubcommand((s) => s.setName("status").setDescription("Check Mimi's Canva connection"))
    .addSubcommand((s) => s.setName("disconnect").setDescription("Disconnect Mimi from Canva")),

  async handle(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!canvaConfigured) return interaction.editReply(notConfiguredMessage());

    const sub = interaction.options.getSubcommand();

    if (sub === "connect") {
      const link = createConnectLink(interaction.user.tag);
      const scopes = new URL(link).searchParams.get("scope");
      console.log(`Canva sign-in link created by ${interaction.user.tag} (client ${config.canvaClientId}, scopes: ${scopes})`);
      return interaction.editReply(
        `**[Sign in to Canva](${link})** (link works once, for 15 minutes).\n` +
          "Sign in with the Canva account whose designs and brand templates Mimi should use. " +
          `If Canva shows a redirect error, add \`${redirectUri()}\` as an authentication URL on your Canva integration.\n` +
          `-# Client ID \`${config.canvaClientId}\` · permissions requested: \`${scopes}\``,
      );
    }

    if (sub === "status") {
      const c = connection();
      if (!c) return interaction.editReply("Canva isn't connected. Run `/canva connect`.");
      try {
        const [{ profile }, { capabilities = [] }] = await Promise.all([
          canva("GET", "/v1/users/me/profile"),
          canva("GET", "/v1/users/me/capabilities"),
        ]);
        const has = (cap) => (capabilities.includes(cap) ? "✅" : "❌");
        return interaction.editReply(
          [
            `Connected to Canva as **${profile.display_name}** (by ${c.connectedBy ?? "unknown"}).`,
            `${has("brand_template")} Brand templates · ${has("autofill")} Autofill / bulk create · ${has("resize")} Resize`,
            capabilities.includes("autofill") ? "" : "_Bulk create and resize need a Canva Pro, Teams or Enterprise plan._",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      } catch (err) {
        return interaction.editReply(`Canva connection problem: ${describeCanvaError(err)}`);
      }
    }

    if (sub === "disconnect") {
      await disconnect();
      return interaction.editReply("Disconnected from Canva.");
    }
  },
};

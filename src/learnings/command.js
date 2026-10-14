import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { card, COLORS, noticeCard } from "../ui.js";
import { filterLearnings, formatMetrics, removeLearning } from "./store.js";

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** /winners list | remove — view and prune what Mimi has learned from ad results. */
export const winnersCommand = {
  data: new SlashCommandBuilder()
    .setName("winners")
    .setDescription("See the winning hooks Mimi has learned from ad results")
    .addSubcommand((s) =>
      s
        .setName("list")
        .setDescription("Show saved winners (and losers)")
        .addStringOption((o) => o.setName("vertical").setDescription("e.g. Trucker, Mortgage Protection"))
        .addStringOption((o) =>
          o.setName("show").setDescription("Winners or losers (default winners)").addChoices(
            { name: "Winners", value: "winner" },
            { name: "Losers", value: "loser" },
          ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Remove a saved result (Manage Server)")
        .addStringOption((o) => o.setName("id").setDescription("ID from /winners list").setRequired(true)),
    ),

  async handle(interaction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (sub === "remove") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.editReply({ embeds: [noticeCard("Only people with **Manage Server** can remove saved results.")] });
      }
      const id = interaction.options.getString("id").trim();
      const ok = removeLearning(id);
      return interaction.editReply({
        embeds: [noticeCard(ok ? `Removed \`${id}\`. Mimi won't use it anymore.` : `No saved result with ID \`${id}\`.`, { color: ok ? COLORS.brand : COLORS.warn })],
      });
    }

    const verdict = interaction.options.getString("show") ?? "winner";
    const vertical = interaction.options.getString("vertical") ?? undefined;
    const rows = filterLearnings({ vertical, verdict }).reverse();
    if (!rows.length) {
      return interaction.editReply({
        embeds: [
          noticeCard(
            "Nothing saved yet. Drop your Ads Manager results (CSV export, pasted rows or screenshots) and ask: *\"Mimi, which hooks won? Save the winners.\"*",
            { color: COLORS.info },
          ),
        ],
      });
    }
    const fields = rows.slice(0, 20).map((x) => ({
      name: clip(`${verdict === "winner" ? "🏆" : "🚫"} ${x.vertical}${x.angle ? ` · ${x.angle}` : ""} · ${x.id}`, 256),
      value: clip(
        [`"${x.hook}"`, formatMetrics(x.metrics), x.period, x.why && `_${x.why}_`].filter(Boolean).join("\n"),
        1024,
      ),
    }));
    return interaction.editReply({
      embeds: [
        card({
          title: `${rows.length} ${verdict === "winner" ? "winning" : "losing"} hook${rows.length === 1 ? "" : "s"}${vertical ? ` · ${vertical}` : ""}`,
          description: rows.length > 20 ? "Newest 20 shown." : undefined,
          fields,
          footerText: "Mimi uses these when she writes new copy",
        }),
      ],
    });
  },
};

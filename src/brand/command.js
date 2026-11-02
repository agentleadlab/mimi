import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { card, COLORS, noticeCard } from "../ui.js";
import { listCopyReports, STATUSES } from "./tools.js";

const ICON = { drafted: "📝", submitted: "📨", removed: "✅", rejected: "❌", appealed: "🔁", closed: "📁" };

/** /copies — the copyright report tracker for pages copying our ads. */
export const copiesCommand = {
  data: new SlashCommandBuilder()
    .setName("copies")
    .setDescription("Copyright reports for pages copying our ads")
    .addStringOption((o) =>
      o
        .setName("status")
        .setDescription("Filter by status (default: everything still open)")
        .addChoices(...STATUSES.map((s) => ({ name: s, value: s })), { name: "all", value: "all" }),
    )
    .addStringOption((o) => o.setName("page").setDescription("Filter by page name")),

  async handle(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const status = interaction.options.getString("status");
    const page = interaction.options.getString("page") ?? undefined;
    let rows = listCopyReports({ status: status && status !== "all" ? status : undefined, page });
    if (!status) rows = rows.filter((r) => !["removed", "closed"].includes(r.status));
    if (!rows.length) {
      return interaction.editReply({
        embeds: [noticeCard("No copyright reports here yet. Send Mimi the copied post/ad link plus our original: *\"Mimi, this page copied our ad: <link>\"*", { color: COLORS.info })],
      });
    }
    const counts = STATUSES.map((s) => [s, listCopyReports({ status: s }).length]).filter(([, n]) => n);
    const fields = rows
      .slice(-20)
      .reverse()
      .map((r) => ({
        name: `${ICON[r.status] ?? "•"} ${r.id} · ${r.page_name}`.slice(0, 256),
        value: [
          r.summary,
          `${r.infringing_urls.length} link${r.infringing_urls.length === 1 ? "" : "s"} · ${r.status}${r.meta_report_number ? ` · Meta #${r.meta_report_number}` : ""}${r.also_impersonation ? " · ⚠️ also impersonation" : ""}`,
          `-# logged by ${r.logged_by} <t:${Math.floor(Date.parse(r.created_at) / 1000)}:R>`,
        ]
          .filter(Boolean)
          .join("\n")
          .slice(0, 1024),
      }));
    return interaction.editReply({
      embeds: [
        card({
          title: "🛡️ Copied ads: copyright reports",
          description: counts.map(([s, n]) => `${ICON[s]} ${s} **${n}**`).join(" · "),
          fields,
          footerText: "Update in chat: \"Mimi, CR-3 removed\"",
          showAuthor: false,
        }),
      ],
    });
  },
};

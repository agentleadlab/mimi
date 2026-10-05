import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { config } from "../config.js";
import { getSamples, samplesConfigured, searchSamples, verticalsOf } from "./library.js";
import { createPreviewLink, linkStatus, recentLinks } from "./links.js";

const NOT_CONFIGURED =
  "The ad sample library isn't set up yet. Add `SAMPLES_SHEET_URL` (the Google Sheet link) in Railway's Variables, then deploy.";

const who = (interaction) => interaction.member?.displayName ?? interaction.user.globalName ?? interaction.user.username;

/** Create preview links for samples and format them for Discord. */
export function linksMessage(samples, { requestedBy, client }) {
  const lines = samples.map((s) => {
    const { url } = createPreviewLink(s, { requestedBy, client });
    return `• **${s.name}** — ${url}`;
  });
  return [
    `🎬 **${samples.length === 1 ? "Ad sample" : `${samples.length} ad samples`}**${client ? ` for ${client}` : ""}:`,
    ...lines,
    `-# Each link works for ${config.previewMinutes} min after it's first opened (unopened links expire in ${config.unopenedLinkDays} days). The timer starts when the client presses ▶ Watch, so link previews in texts and emails won't use it up.`,
  ].join("\n");
}

async function autocompleteSamples(interaction) {
  const focused = interaction.options.getFocused(true);
  let samples = [];
  try {
    samples = await getSamples();
  } catch {
    return interaction.respond([]);
  }
  const q = String(focused.value).toLowerCase();
  const choices =
    focused.name === "lead_type"
      ? verticalsOf(samples).map((v) => ({ name: v, value: v }))
      : samples.map((s) => ({ name: `${s.name} (${s.vertical})`.slice(0, 100), value: s.name.slice(0, 100) }));
  return interaction.respond(choices.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 25));
}

/** /sample — get preview links for a lead type or a specific sample. */
export const sampleCommand = {
  data: new SlashCommandBuilder()
    .setName("sample")
    .setDescription("Get time-limited preview links for ad samples to send a client")
    .addStringOption((o) =>
      o.setName("lead_type").setDescription("Lead type, e.g. Veterans, IUL, Truckers").setRequired(true).setAutocomplete(true),
    )
    .addStringOption((o) => o.setName("sample").setDescription("A specific sample (default: all for that lead type)").setAutocomplete(true))
    .addStringOption((o) => o.setName("client").setDescription("Who it's for (shows in the log)")),

  autocomplete: autocompleteSamples,

  async handle(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!samplesConfigured()) return interaction.editReply(NOT_CONFIGURED);

    const leadType = interaction.options.getString("lead_type");
    const sampleName = interaction.options.getString("sample");
    const client = interaction.options.getString("client")?.trim();
    const samples = await getSamples();

    let matches = searchSamples(samples, leadType);
    if (sampleName) {
      const exact = samples.filter((s) => s.name === sampleName);
      matches = exact.length ? exact : searchSamples(samples, sampleName);
    }
    if (!matches.length) {
      return interaction.editReply(
        `No samples found for **${leadType}**. Lead types: ${verticalsOf(samples).join(", ")}.`,
      );
    }
    return interaction.editReply(linksMessage(matches.slice(0, 10), { requestedBy: who(interaction), client }));
  },
};

const fmtTime = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

/** /samples — list, refresh, log. */
export const samplesCommand = {
  data: new SlashCommandBuilder()
    .setName("samples")
    .setDescription("Ad sample library")
    .addSubcommand((s) => s.setName("list").setDescription("Show all ad samples by lead type"))
    .addSubcommand((s) => s.setName("refresh").setDescription("Re-read the Google Sheet now"))
    .addSubcommand((s) => s.setName("log").setDescription("Recent preview links: who requested, who opened")),

  async handle(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!samplesConfigured()) return interaction.editReply(NOT_CONFIGURED);
    const sub = interaction.options.getSubcommand();

    if (sub === "list" || sub === "refresh") {
      const samples = await getSamples({ refresh: sub === "refresh" });
      const body = verticalsOf(samples)
        .map((v) => `**${v}**\n${samples.filter((s) => s.vertical === v).map((s) => `• ${s.name}`).join("\n")}`)
        .join("\n");
      const head = sub === "refresh" ? `🔄 Re-read the sheet: ${samples.length} samples.\n\n` : "";
      return interaction.editReply((head + body).slice(0, 1990) || "The sheet has no samples with a Loom link yet.");
    }

    if (sub === "log") {
      const links = recentLinks(15);
      if (!links.length) return interaction.editReply("No preview links yet.");
      const lines = links.map((l) => {
        const st = linkStatus(l);
        const state =
          st.state === "unopened"
            ? "⏳ not opened yet"
            : st.state === "open"
              ? `👀 opened ${fmtTime(l.firstOpenedAt)} — viewing now`
              : st.reason === "viewed"
                ? `✅ opened ${fmtTime(l.firstOpenedAt)} (${l.opens}×), expired`
                : "⌛ expired unopened";
        return `• **${l.sample.name}**${l.client ? ` → ${l.client}` : ""} · by ${l.requestedBy} ${fmtTime(l.createdAt)} · ${state}`;
      });
      return interaction.editReply(lines.join("\n").slice(0, 1990));
    }
  },
};

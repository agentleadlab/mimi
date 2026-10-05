import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { config } from "../config.js";
import { addToCache, getSamples, loomVideoId, samplesConfigured, searchSamples, verticalsOf } from "./library.js";
import { callSheetScript, sheetLogConfigured } from "./sheetLog.js";
import { card, COLORS, noticeCard } from "../ui.js";
import { createPreviewLink, linkStatus, recentLinks } from "./links.js";

const NOT_CONFIGURED =
  "The ad sample library isn't set up yet. Add `SAMPLES_SHEET_URL` (the Google Sheet link) in Railway's Variables, then deploy.";

const who = (interaction) => interaction.member?.displayName ?? interaction.user.globalName ?? interaction.user.username;

/** Create preview links for samples, as a branded card. */
export function linksMessage(samples, { requestedBy, client }) {
  const fields = samples.map((s) => ({
    name: `🎬 ${s.name}`,
    value: createPreviewLink(s, { requestedBy, client }).url,
  }));
  const types = [...new Set(samples.map((s) => s.vertical).filter(Boolean))];
  return {
    embeds: [
      card({
        title: samples.length === 1 ? "Ad sample ready" : `${samples.length} ad samples ready`,
        description: [
          client ? `**For** ${client}` : null,
          types.length ? `**Lead type** ${types.join(", ")}` : null,
          "Copy a link below and send it to your client.",
        ]
          .filter(Boolean)
          .join("\n"),
        fields: [
          ...fields,
          {
            name: "⏱️ How the links work",
            value:
              `• **${config.previewMinutes} min** of viewing once the client presses ▶ Watch\n` +
              `• Unopened links expire in **${config.unopenedLinkDays} days**\n` +
              "• Safe to paste in texts and emails — previews don't start the timer",
          },
        ],
        footerText: `requested by ${requestedBy}`,
      }),
    ],
  };
}

const say = (interaction, text, color = COLORS.warn) => interaction.editReply({ embeds: [noticeCard(text, { color })] });

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
    if (!samplesConfigured()) return say(interaction, NOT_CONFIGURED);

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
      return say(interaction, `No samples found for **${leadType}**.\nLead types: ${verticalsOf(samples).join(" · ")}`);
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
    .addSubcommand((s) => s.setName("log").setDescription("Recent preview links: who requested, who opened"))
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Add a new ad sample to the library (Manage Server only)")
        .addStringOption((o) => o.setName("name").setDescription("Sample name, e.g. Text-Verified VET PLUS - 3").setRequired(true))
        .addStringOption((o) =>
          o.setName("lead_type").setDescription("Lead type (pick one or type a new one)").setRequired(true).setAutocomplete(true),
        )
        .addStringOption((o) => o.setName("loom").setDescription("Loom share link").setRequired(true))
        .addStringOption((o) => o.setName("tags").setDescription("Comma-separated, e.g. veterans, army"))
        .addStringOption((o) => o.setName("campaign").setDescription("Campaign/context (default: the sample name)")),
    ),

  autocomplete: autocompleteSamples,

  async handle(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!samplesConfigured()) return say(interaction, NOT_CONFIGURED);
    const sub = interaction.options.getSubcommand();

    if (sub === "list" || sub === "refresh") {
      const samples = await getSamples({ refresh: sub === "refresh" });
      const fields = verticalsOf(samples).map((v) => {
        const names = samples.filter((x) => x.vertical === v).map((x) => `• ${x.name}`);
        return { name: `${v} (${names.length})`, value: names.join("\n").slice(0, 1024) };
      });
      if (!fields.length) return say(interaction, "The sheet has no samples with a Loom link yet.");
      return interaction.editReply({
        embeds: [
          card({
            title: sub === "refresh" ? "🔄 Library refreshed" : "📚 Ad sample library",
            description: `**${samples.length} samples** across **${fields.length} lead types**. Use \`/sample\` to get a client link.`,
            fields: fields.slice(0, 25),
            showAuthor: false,
          }),
        ],
      });
    }

    if (sub === "add") return addSample(interaction);

    if (sub === "log") {
      const links = recentLinks(15);
      if (!links.length) return say(interaction, "No preview links yet.", COLORS.info);
      const fields = links.map((l) => {
        const st = linkStatus(l);
        const state =
          st.state === "unopened"
            ? "⏳ Not opened yet"
            : st.state === "open"
              ? `👀 Watching now · opened ${fmtTime(l.firstOpenedAt)}`
              : st.reason === "viewed"
                ? `✅ Watched ${fmtTime(l.firstOpenedAt)}${l.opens > 1 ? ` (${l.opens}×)` : ""}`
                : "⌛ Expired unopened";
        return {
          name: `${l.sample.name}${l.client ? ` → ${l.client}` : ""}`.slice(0, 256),
          value: `${state}\n-# by ${l.requestedBy} · ${fmtTime(l.createdAt)}`,
        };
      });
      return interaction.editReply({
        embeds: [card({ title: "🧾 Recent sample links", description: `Last ${links.length} links, newest first.`, fields, showAuthor: false })],
      });
    }
  },
};

async function addSample(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return say(interaction, "Only people with **Manage Server** can add samples. Ask an admin, or add the row in the sheet.");
  }
  if (!sheetLogConfigured()) {
    return say(interaction, "Adding from Discord needs the sheet script (`SAMPLES_LOG_URL` / `SAMPLES_LOG_SECRET`). For now, add the row in the sheet.");
  }

  const name = interaction.options.getString("name").trim();
  const leadType = interaction.options.getString("lead_type").trim();
  const loomInput = interaction.options.getString("loom").trim();
  const tags = (interaction.options.getString("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const campaign = interaction.options.getString("campaign")?.trim() || name;

  const loomId = loomVideoId(loomInput);
  if (!loomId) {
    return say(interaction, "That doesn't look like a Loom video link. It should look like `https://www.loom.com/share/…`.");
  }
  const loom = `https://www.loom.com/share/${loomId}`;

  const samples = await getSamples({ refresh: true });
  const sameName = samples.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (sameName) return say(interaction, `There's already a sample named **${sameName.name}**. Pick a different name.`);
  const sameVideo = samples.find((s) => s.loomId === loomId);
  if (sameVideo) return say(interaction, `That Loom video is already in the library as **${sameVideo.name}**.`);

  // Match an existing lead type's spelling (e.g. "veterans" → "Veterans").
  const vertical = verticalsOf(samples).find((v) => v.toLowerCase() === leadType.toLowerCase()) ?? leadType;

  try {
    const res = await callSheetScript({ event: "addSample", sample: { name, leadType: vertical, campaign, loom, tags: tags.join(", ") } });
    // An older version of the script answers "ok" without adding anything.
    if (!res.row) throw new Error("the sheet script is out of date");
  } catch (err) {
    console.error("/samples add failed:", err);
    const hint = /out of date|library tab/i.test(err.message) ? " Make sure the latest Apps Script is deployed (see README)." : "";
    return say(interaction, `Couldn't add it to the sheet: ${err.message}.${hint}`, COLORS.error);
  }

  addToCache({ name, vertical, campaign, dateAdded: new Date().toISOString().slice(0, 10), loomUrl: loom, loomId, tags });
  const isNewType = !verticalsOf(samples).includes(vertical);
  console.log(`Sample added by ${who(interaction)}: "${name}" (${vertical}).`);
  return interaction.editReply({
    embeds: [
      card({
        title: "✅ Sample added",
        description: `Added **${name}** to **${vertical}**${isNewType ? " (new lead type)" : ""}. It's available in \`/sample\` now.`,
        fields: [
          { name: "Lead type", value: vertical, inline: true },
          { name: "Campaign", value: campaign.slice(0, 1024), inline: true },
          ...(tags.length ? [{ name: "Tags", value: tags.join(", ").slice(0, 1024), inline: true }] : []),
        ],
        footerText: `added by ${who(interaction)}`,
      }),
    ],
  });
}

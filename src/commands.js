import { SlashCommandBuilder } from "discord.js";
import { canvaCommand } from "./canva/command.js";
import { sampleCommand, samplesCommand } from "./samples/command.js";

/**
 * Slash commands for Mimi's core request types. Each one turns its options
 * into a brief that goes to Mimi like a normal message.
 */
export const commands = [
  {
    data: new SlashCommandBuilder()
      .setName("mimi")
      .setDescription("Ask Mimi anything creative")
      .addStringOption((o) => o.setName("brief").setDescription("What do you need?").setRequired(true))
      .addAttachmentOption((o) => o.setName("image").setDescription("Optional reference or design")),
    brief: (o) => o.getString("brief"),
  },
  {
    data: new SlashCommandBuilder()
      .setName("ideas")
      .setDescription("Get 3-5 creative concepts for a campaign or topic")
      .addStringOption((o) => o.setName("topic").setDescription("Campaign, product, or topic").setRequired(true))
      .addStringOption((o) => o.setName("audience").setDescription("Who it's for"))
      .addStringOption((o) => o.setName("platform").setDescription("Where it runs")),
    brief: (o) =>
      [
        `Give me ideas for: ${o.getString("topic")}`,
        o.getString("audience") && `Audience: ${o.getString("audience")}`,
        o.getString("platform") && `Platform: ${o.getString("platform")}`,
      ]
        .filter(Boolean)
        .join("\n"),
  },
  {
    data: new SlashCommandBuilder()
      .setName("copy")
      .setDescription("Write copy with variations")
      .addStringOption((o) => o.setName("brief").setDescription("Asset, campaign, or offer").setRequired(true))
      .addStringOption((o) => o.setName("platform").setDescription("Where it runs"))
      .addIntegerOption((o) =>
        o.setName("variations").setDescription("How many variations (default 3)").setMinValue(1).setMaxValue(10),
      ),
    brief: (o) =>
      [
        `Write copy for: ${o.getString("brief")}`,
        o.getString("platform") && `Platform: ${o.getString("platform")}`,
        `Variations: ${o.getInteger("variations") ?? 3}`,
      ]
        .filter(Boolean)
        .join("\n"),
  },
  {
    data: new SlashCommandBuilder()
      .setName("review")
      .setDescription("Get structured creative feedback on a design")
      .addAttachmentOption((o) => o.setName("design").setDescription("The design to review").setRequired(true))
      .addStringOption((o) => o.setName("context").setDescription("Goal, audience, platform, etc.")),
    brief: (o) => `Review this design.${o.getString("context") ? `\nContext: ${o.getString("context")}` : ""}`,
  },
  {
    data: new SlashCommandBuilder()
      .setName("plan")
      .setDescription("Build a content calendar")
      .addStringOption((o) => o.setName("timeframe").setDescription("e.g. next 2 weeks, October").setRequired(true))
      .addStringOption((o) => o.setName("focus").setDescription("Brand, campaign, or goal"))
      .addStringOption((o) => o.setName("channels").setDescription("e.g. Instagram, LinkedIn")),
    brief: (o) =>
      [
        `Plan content for: ${o.getString("timeframe")}`,
        o.getString("focus") && `Focus: ${o.getString("focus")}`,
        o.getString("channels") && `Channels: ${o.getString("channels")}`,
      ]
        .filter(Boolean)
        .join("\n"),
  },
  sampleCommand,
  samplesCommand,
  canvaCommand,
];

export const commandsByName = new Map(commands.map((c) => [c.data.name, c]));

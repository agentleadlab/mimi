import { test } from "node:test";
import assert from "node:assert/strict";
import { config, isAllowedBot } from "../src/config.js";

test("only allowed bots get answered", () => {
  assert.equal(isAllowedBot({ bot: true, id: "1", username: "Rook" }), true);
  assert.equal(isAllowedBot({ bot: true, id: "2", username: "rook" }), true);
  assert.equal(isAllowedBot({ bot: true, id: "3", username: "SomeOtherBot" }), false);
  assert.equal(isAllowedBot({ bot: false, id: "4", username: "Rook" }), false); // a person named Rook is just a person
  config.allowedBotIds = ["999"];
  assert.equal(isAllowedBot({ bot: true, id: "999", username: "Renamed" }), true);
});

test("ad-related bot messages pass the first filter; others don't", async () => {
  const { mentionsAds, config: cfg } = await import("../src/config.js");
  assert.equal(
    mentionsAds('<@1> ❓ Question — Robert McCool (AEP, 30 vets): "Am I able to see the advertisement for the lead, or are they different for each lead?"'),
    true,
  );
  assert.equal(mentionsAds("make me a new one: Text-Verified Veteran ad sample link for ReLanda Price"), true);
  assert.equal(mentionsAds("Payment link for Oct 28 is live, 30 vets delivered"), false);
  assert.deepEqual(cfg.botWatchChannelIds, ["1566836453613240511"]);
});

test("reports missing thread permissions by name", async () => {
  const { PermissionsBitField, PermissionFlagsBits: F } = await import("discord.js");
  const { missingChannelPermissions } = await import("../src/install.js");
  const have = new PermissionsBitField([F.ViewChannel, F.SendMessages, F.EmbedLinks, F.AttachFiles, F.ReadMessageHistory, F.SendMessagesInThreads]);
  const channel = { permissionsFor: () => have };
  assert.deepEqual(missingChannelPermissions(channel, {}), ["CreatePublicThreads"]);
});

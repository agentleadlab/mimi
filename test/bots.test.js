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
  assert.deepEqual(cfg.botWatchChannelIds, ["*"]);
});

test("reports missing thread permissions by name", async () => {
  const { PermissionsBitField, PermissionFlagsBits: F } = await import("discord.js");
  const { missingChannelPermissions } = await import("../src/install.js");
  const have = new PermissionsBitField([F.ViewChannel, F.SendMessages, F.EmbedLinks, F.AttachFiles, F.ReadMessageHistory, F.SendMessagesInThreads]);
  const channel = { permissionsFor: () => have };
  assert.deepEqual(missingChannelPermissions(channel, {}), ["CreatePublicThreads"]);
});

test("SMS threads: client texts go out plain, everything else as // notes", async () => {
  const { smsRelayText, isSmsRelay } = await import("../src/config.js");
  const c = smsRelayText("CLIENT: Hi **Aiden**! Here are your ad videos:\nText-Verified VET PLUS: https://x/p/1");
  assert.equal(c.toClient, true);
  assert.equal(c.text, "Hi Aiden! Here are your ad videos:\nText-Verified VET PLUS: https://x/p/1");
  const n = smsRelayText("Which vet lead type is Aiden on?\nVET PLUS or VET Widows");
  assert.equal(n.toClient, false);
  assert.equal(n.text, "// Which vet lead type is Aiden on?\n// VET PLUS or VET Widows");
  assert.equal(smsRelayText("// already internal").text, "// already internal");
  const thread = { isThread: () => true, parent: { name: "♜ | rook-sms" } };
  assert.equal(isSmsRelay(thread), true);
  assert.equal(isSmsRelay({ isThread: () => false, name: "ask-mimi" }), false);
  assert.equal(isSmsRelay({ isThread: () => false, id: "1545452742527426601", name: "anything" }), true);
  assert.equal(isSmsRelay({ isThread: () => true, parentId: "1545452742527426601", parent: { name: "anything" } }), true);
});

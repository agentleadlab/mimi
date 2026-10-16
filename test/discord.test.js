import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChannelType } from "discord.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mimi-discord-"));
let runDiscordTool;
before(async () => {
  process.env.MIMI_DATA_DIR = dataDir;
  process.env.TEAM_MENTIONS = "Tre=111111111111111111";
  ({ runDiscordTool } = await import("../src/discord/tools.js"));
});
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

function fakeGuild(sent) {
  const member = (id, displayName, username) => ({ id, displayName, user: { username, globalName: displayName, bot: false } });
  const people = [member("222222222222222222", "Jen Hashisaki", "jenh"), member("333333333333333333", "K2", "k2dev"), member("444444444444444444", "Jenna", "jenna")];
  const channels = new Map([
    ["9", { id: "9", name: "general", type: ChannelType.GuildText }],
    ["10", { id: "10", name: "📈marketing", type: ChannelType.GuildText, send: async (p) => (sent.push(p), { url: "https://discord.com/channels/1/10/5" }) }],
  ]);
  channels.filter = (fn) => {
    const m = new Map([...channels].filter(([, c]) => fn(c)));
    m.find = (f) => [...m.values()].find(f);
    m.get = (k) => channels.get(k);
    return m;
  };
  return {
    channels: { cache: channels },
    members: { search: async ({ query }) => new Map(people.filter((p) => p.displayName.toLowerCase().includes(query.toLowerCase())).map((p) => [p.id, p])) },
  };
}

test("posts the brief to the marketing channel and really tags people", async () => {
  const sent = [];
  const r = await runDiscordTool(
    "post_to_channel",
    { mention: ["Jen", "K2", "Tre"], message: "This week's Marketing Brief is up — data from the last 30 days.", card_title: "Marketing Brief — last 30 days", link: "https://docs.google.com/presentation/d/abc/edit" },
    { guild: fakeGuild(sent), requester: "Kath" },
  );
  assert.equal(r.isError, false, r.content);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, "<@222222222222222222> <@333333333333333333> <@111111111111111111> This week's Marketing Brief is up — data from the last 30 days.");
  assert.deepEqual(sent[0].allowedMentions.users, ["222222222222222222", "333333333333333333", "111111111111111111"]);
  assert.equal(sent[0].embeds[0].url, "https://docs.google.com/presentation/d/abc/edit");
  assert.equal(JSON.parse(r.content).channel, "#📈marketing");
});

test("refuses to post when a name is ambiguous", async () => {
  const sent = [];
  const guild = fakeGuild(sent);
  guild.members.search = async () => new Map([["1", { id: "1", displayName: "Sam A", user: { username: "sa", bot: false } }], ["2", { id: "2", displayName: "Sam B", user: { username: "sb", bot: false } }]]);
  const r = await runDiscordTool("post_to_channel", { mention: ["Sam"], message: "hi" }, { guild });
  assert.equal(r.isError, true);
  assert.match(r.content, /matches several people/);
  assert.equal(sent.length, 0);
});

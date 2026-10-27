import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mimi-client-"));
let share, tools;
const realFetch = globalThis.fetch;
const VERTICALS = ["Truckers", "Veterans", "Mortgage Protection", "Final Expense", "IUL", "Spanish IUL", "VET Widows"];
const CSV =
  "Sample Name,Vertical,Campaign/Context,Date Added,Loom Link,Tags\n" +
  "Trucker A,Truckers,x,,https://www.loom.com/share/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,\n" +
  "Trucker B,Truckers,x,,https://www.loom.com/share/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb,\n" +
  "Vet A,Veterans,x,,https://www.loom.com/share/cccccccccccccccccccccccccccccccc,\n";

before(async () => {
  process.env.MIMI_DATA_DIR = dataDir;
  process.env.PUBLIC_URL = "https://mimi.example";
  process.env.SAMPLES_SHEET_URL = "https://docs.google.com/spreadsheets/d/abc/edit";
  globalThis.fetch = async () => new Response(CSV);
  share = await import("../src/samples/clientShare.js");
  tools = await import("../src/samples/tools.js");
});
after(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("lead type comes from the channel name", () => {
  const lt = (n) => share.leadTypeFromChannel(n, VERTICALS);
  assert.equal(lt("mia-hilligoss-trucker"), "Truckers");
  assert.equal(lt("john-doe-vets"), "Veterans");
  assert.equal(lt("ann-lee-mortgage-protection"), "Mortgage Protection");
  assert.equal(lt("ann-lee-mp"), "Mortgage Protection");
  assert.equal(lt("bob-fe"), "Final Expense");
  assert.equal(lt("carla-ruiz-spanish-iul"), "Spanish IUL");
  assert.equal(lt("dan-iul"), "IUL");
  assert.equal(lt("eve-vet-widows"), "VET Widows");
  assert.equal(lt("🔥mia-hilligoss-trucker"), "Truckers");
  assert.equal(lt("mia-hilligoss"), null);
  assert.equal(lt("general"), null);
});

function fakeChannel(id, name, history = []) {
  return {
    id,
    name,
    messages: {
      fetch: async ({ before } = {}) => {
        const m = new Map(before ? [] : history.map((h) => [h.id, h]));
        m.last = () => [...m.values()].at(-1);
        return m;
      },
    },
  };
}
const ctx = (channel) => ({ requester: "Agent Mia", client: { channel, botId: "bot", shared: false } });

test("shares only the channel's lead type, once", async () => {
  const channel = fakeChannel("c1", "mia-hilligoss-trucker");
  const c = ctx(channel);
  const r = await tools.runSampleTool("create_sample_preview_links", { sample_names: ["Trucker A", "Vet A"] }, c);
  const out = JSON.parse(r.content);
  assert.equal(r.isError, false);
  assert.equal(out.lead_type, "Truckers");
  assert.deepEqual(out.links.map((l) => l.sample), ["Trucker A"]);
  assert.deepEqual(out.not_shared, ["vet a"]);
  assert.equal(c.client.shared, true);
  share.setShareMessage("c1", "https://discord.com/channels/1/c1/99");

  const again = await tools.runSampleTool("create_sample_preview_links", {}, ctx(channel));
  assert.equal(again.isError, true);
  assert.equal(JSON.parse(again.content).message_link, "https://discord.com/channels/1/c1/99");
});

test("a vet request in a trucker channel gets nothing", async () => {
  const r = await tools.runSampleTool("create_sample_preview_links", { sample_names: ["Vet A"] }, ctx(fakeChannel("c2", "sam-jones-trucker")));
  assert.equal(r.isError, true);
  assert.match(r.content, /Only Truckers samples/);
});

test("unclear channel name: asks first, then uses the confirmed lead type", async () => {
  const channel = fakeChannel("c3", "kim-park");
  const list = JSON.parse((await tools.runSampleTool("list_ad_samples", {}, ctx(channel))).content);
  assert.equal(list.lead_type, null);
  const blocked = await tools.runSampleTool("create_sample_preview_links", {}, ctx(channel));
  assert.match(blocked.content, /Ask the agent which lead type/i);
  const ok = JSON.parse((await tools.runSampleTool("create_sample_preview_links", { confirmed_lead_type: "vets" }, ctx(channel))).content);
  assert.equal(ok.lead_type, "Veterans");
});

test("finds an earlier share in the channel history", async () => {
  const old = { id: "m1", url: "https://discord.com/channels/1/c4/m1", createdTimestamp: 1, author: { id: "bot" }, content: "", embeds: [{ fields: [{ value: "https://mimi.example/p/abc" }] }] };
  const r = await tools.runSampleTool("create_sample_preview_links", {}, ctx(fakeChannel("c4", "lee-trucker", [old])));
  assert.equal(r.isError, true);
  assert.equal(JSON.parse(r.content).message_link, "https://discord.com/channels/1/c4/m1");
});

test("client mode is per category, so team channels in the same server stay normal", async () => {
  process.env.CLIENT_CATEGORY_IDS = "cat-clients";
  const { config, isClientChannel } = await import("../src/config.js");
  config.clientCategoryIds = ["cat-clients"];
  const ch = (parentId, extra = {}) => ({ guildId: "g1", parentId, isThread: () => false, ...extra });
  assert.equal(isClientChannel(ch("cat-clients")), true);
  assert.equal(isClientChannel(ch("cat-team")), false); // e.g. #ask-mimi
  assert.equal(isClientChannel({ guildId: "g1", isThread: () => true, parent: { parentId: "cat-clients" } }), true);
  assert.equal(isClientChannel({ guildId: null }), false);
});

test("client mode never applies in the team server", async () => {
  const { config, isClientChannel, isClientGuild } = await import("../src/config.js");
  config.clientGuildIds = ["1262142521409142825", "999"];
  config.clientCategoryIds = ["cat-clients"];
  const team = { guildId: "1262142521409142825", parentId: "cat-clients", isThread: () => false };
  assert.equal(isClientGuild("1262142521409142825"), false);
  assert.equal(isClientChannel(team), false);
  assert.equal(isClientChannel({ guildId: "999", isThread: () => false }), true);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReply, replyMessages, COLORS } from "../src/ui.js";

test("parses a title, intro and sections from Mimi's markdown", () => {
  const r = parseReply("# 🎯 Three Hooks\nHere's the direction.\n\n## Option A\n- Hook one\n\n## Next steps\nTest A vs B.");
  assert.equal(r.title, "🎯 Three Hooks");
  assert.equal(r.intro, "Here's the direction.");
  assert.deepEqual(r.sections, [
    { heading: "Option A", body: "- Hook one" },
    { heading: "Next steps", body: "Test A vs B." },
  ]);
});

test("plain replies become a single branded card", () => {
  const [msg] = replyMessages("Hey! Drop me a brief.", { requester: "Kath" });
  const [e] = msg.embeds;
  assert.equal(e.color, COLORS.brand);
  assert.equal(e.description, "Hey! Drop me a brief.");
  assert.match(e.author.name, /Creative Director/);
  assert.match(e.footer.text, /for Kath/);
  assert.ok(e.timestamp);
});

test("sections become fields; long content splits within Discord limits", () => {
  const long = Array.from({ length: 60 }, (_, i) => `- bullet number ${i} with some extra words to make it long`).join("\n");
  const text = `# Big Plan\nIntro.\n${Array.from({ length: 30 }, (_, i) => `## Section ${i}\n${long}`).join("\n")}`;
  const msgs = replyMessages(text);
  for (const m of msgs) {
    assert.ok(m.embeds.length <= 10);
    let total = 0;
    for (const e of m.embeds) {
      assert.ok((e.fields?.length ?? 0) <= 25);
      for (const f of e.fields ?? []) {
        assert.ok(f.value.length <= 1024, `field ${f.value.length}`);
        assert.ok(f.name.length <= 256);
      }
      total += (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.author?.name.length ?? 0) + (e.footer?.text.length ?? 0) +
        (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
    }
    assert.ok(total <= 6000, `message size ${total}`);
  }
  assert.equal(msgs[0].embeds[0].title, "Big Plan");
  const all = msgs.flatMap((m) => m.embeds);
  assert.ok(all.at(-1).footer && all.at(-1).timestamp);
  assert.ok(!all[1]?.author, "only the first card has the author header");
});

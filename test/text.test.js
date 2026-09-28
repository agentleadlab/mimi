import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkMessage, DISCORD_LIMIT } from "../src/text.js";

test("short text is a single chunk", () => {
  assert.deepEqual(chunkMessage("hello"), ["hello"]);
});

test("long text splits under the Discord limit on paragraph boundaries", () => {
  const para = "word ".repeat(150).trim();
  const text = Array(6).fill(para).join("\n\n");
  const chunks = chunkMessage(text);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= DISCORD_LIMIT, `chunk length ${c.length}`);
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), text.replace(/\s+/g, " "));
});

test("code fences stay balanced across chunks", () => {
  const code = Array(200).fill("const x = 1; // some code here").join("\n");
  const chunks = chunkMessage("Here:\n```js\n" + code + "\n```\nDone.");
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.length <= DISCORD_LIMIT);
    assert.equal((c.match(/```/g) ?? []).length % 2, 0, "fences balanced");
  }
  assert.ok(chunks[1].startsWith("```js"));
});

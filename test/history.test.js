import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClaudeMessages, stripBotMention } from "../src/history.js";

const user = (author, text, imageUrls = []) => ({ fromBot: false, author, text, imageUrls });
const bot = (text) => ({ fromBot: true, author: "Mimi", text, imageUrls: [] });

test("strips bot mentions", () => {
  assert.equal(stripBotMention("<@123> hey <@!123>", "123"), "hey");
});

test("strips bot role mentions", () => {
  assert.equal(stripBotMention("<@&999> ideas please", "123", "999"), "ideas please");
});

test("maps roles, labels speakers, merges consecutive turns", () => {
  const msgs = buildClaudeMessages([
    user("Ana", "need ideas"),
    user("Ben", "for the launch"),
    bot("On it."),
    user("Ana", "go bolder"),
  ]);
  assert.deepEqual(
    msgs.map((m) => m.role),
    ["user", "assistant", "user"],
  );
  assert.deepEqual(
    msgs[0].content.map((b) => b.text),
    ["Ana: need ideas", "Ben: for the launch"],
  );
});

test("drops leading/trailing assistant turns and empty messages", () => {
  const msgs = buildClaudeMessages([bot("earlier"), user("Ana", ""), user("Ana", "hi"), bot("")]);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].role, "user");
});

test("attaches images only from the latest message", () => {
  const msgs = buildClaudeMessages([
    user("Ana", "old", ["https://x/old.png"]),
    bot("ok"),
    user("Ana", "", ["https://x/new.png"]),
  ]);
  const last = msgs[msgs.length - 1].content;
  assert.equal(last[0].type, "image");
  assert.equal(last[0].source.url, "https://x/new.png");
  assert.equal(last[1].text, "Ana: (shared an image)");
  assert.ok(!msgs[0].content.some((b) => b.type === "image"));
});

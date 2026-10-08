import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { extractImages, generateImage } from "../src/gemini.js";
import { replyMessages } from "../src/ui.js";
import { buildClaudeMessages } from "../src/history.js";

const PNG = Buffer.alloc(200, 7).toString("base64");
const realFetch = globalThis.fetch;
let calls;

function mockFetch(handler) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body && JSON.parse(init.body) });
    const { status = 200, json } = handler(String(url));
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  };
}

beforeEach(() => {
  calls = [];
  config.geminiApiKey = "test-key";
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("finds images in Interactions and generateContent responses", () => {
  assert.equal(extractImages({ steps: [{ type: "model_output", content: [{ type: "image", data: PNG, mime_type: "image/jpeg" }] }] })[0].mimeType, "image/jpeg");
  assert.equal(extractImages({ output_image: { data: PNG } })[0].data, PNG);
  assert.equal(extractImages({ candidates: [{ content: { parts: [{ text: "hi" }, { inlineData: { mimeType: "image/png", data: PNG } }] } }] }).length, 1);
  assert.equal(extractImages({ candidates: [{ content: { parts: [{ text: "no image" }] } }] }).length, 0);
});

test("uses the Interactions API with aspect ratio", async () => {
  mockFetch(() => ({ json: { steps: [{ content: [{ type: "image", data: PNG, mime_type: "image/png" }] }] } }));
  const out = await generateImage({ prompt: "porch at sunset", aspectRatio: "4:5" });
  assert.equal(out.buffer.length, 200);
  assert.match(calls[0].url, /\/interactions$/);
  assert.equal(calls[0].body.response_format.aspect_ratio, "4:5");
  assert.equal(calls[0].body.input[0].text, "porch at sunset");
});

test("falls back to generateContent when the Interactions API is unavailable", async () => {
  mockFetch((url) =>
    url.endsWith("/interactions")
      ? { status: 404, json: { error: { message: "not found" } } }
      : { json: { candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/png", data: PNG } }] } }] } },
  );
  const out = await generateImage({ prompt: "x", aspectRatio: "9:16" });
  assert.equal(out.mimeType, "image/png");
  assert.match(calls[1].url, /:generateContent$/);
  assert.equal(calls[1].body.generationConfig.imageConfig.aspectRatio, "9:16");
});

test("explains when no image comes back", async () => {
  mockFetch(() => ({ json: { candidates: [{ content: { parts: [{ text: "I can't make that." }] } }] } }));
  await assert.rejects(generateImage({ prompt: "x" }), /didn't return an image: I can't make that/);
});

test("generated images attach to the reply card", () => {
  const files = [
    { name: "mimi-image-1.png", buffer: Buffer.from("a"), title: "A" },
    { name: "mimi-image-2.png", buffer: Buffer.from("b"), title: "B" },
  ];
  const msgs = replyMessages("# Two takes\nHere you go.", { files });
  assert.equal(msgs[0].embeds[0].image.url, "attachment://mimi-image-1.png");
  assert.equal(msgs[0].files[0].name, "mimi-image-1.png");
  assert.equal(msgs[1].embeds[0].title, "B");
  assert.equal(msgs[1].files[0].name, "mimi-image-2.png");
});

test("Mimi sees her own generated image URLs in history", () => {
  const msgs = buildClaudeMessages([
    { fromBot: false, author: "Ana", text: "make an ad", imageUrls: [] },
    { fromBot: true, author: "Mimi", text: "# Done", imageUrls: ["https://cdn/x.png"] },
    { fromBot: false, author: "Ana", text: "make it warmer", imageUrls: [] },
  ]);
  assert.match(msgs[1].content[0].text, /\[your generated image: https:\/\/cdn\/x.png\]/);
});

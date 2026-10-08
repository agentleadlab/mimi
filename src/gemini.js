import { config } from "./config.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;

export const ASPECT_RATIOS = ["1:1", "4:5", "5:4", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9", "21:9"];

export const geminiConfigured = () => Boolean(config.geminiApiKey);

export class GeminiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Download a reference image (e.g. a Discord attachment) as base64. */
async function fetchReference(url) {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("Reference images must be https links.");
  const res = await fetch(u);
  if (!res.ok) throw new Error(`Couldn't download the reference image (${res.status}). Discord links expire — re-share it.`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_REFERENCE_BYTES) throw new Error("Reference image is over 10 MB.");
  const mimeType = (res.headers.get("content-type") || "image/png").split(";")[0];
  return { mimeType, data: bytes.toString("base64") };
}

/**
 * Find generated images anywhere in a Gemini response. Handles the
 * Interactions API ({type:"image", data, mime_type}, output_image) and
 * generateContent ({inlineData|inline_data: {mimeType|mime_type, data}}).
 */
export function extractImages(json) {
  const found = [];
  const seen = new Set();
  const push = (data, mimeType) => {
    if (typeof data === "string" && data.length > 100 && !seen.has(data)) {
      seen.add(data);
      found.push({ data, mimeType: mimeType || "image/png" });
    }
  };
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    const inline = node.inlineData ?? node.inline_data;
    if (inline) push(inline.data, inline.mimeType ?? inline.mime_type);
    if (node.type === "image" && node.data) push(node.data, node.mime_type ?? node.mimeType);
    if (node.output_image?.data) push(node.output_image.data, node.output_image.mime_type);
    for (const v of Object.values(node)) if (v && typeof v === "object") walk(v);
  };
  walk(json);
  return found;
}

/** Any text the model returned alongside the image. */
function extractText(json) {
  if (typeof json?.output_text === "string") return json.output_text;
  const texts = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node.text === "string" && !node.thought) texts.push(node.text);
    for (const v of Object.values(node)) if (v && typeof v === "object") walk(v);
  };
  walk(json?.steps ?? json?.candidates);
  return texts.join("\n").trim();
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "x-goog-api-key": config.geminiApiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new GeminiError(res.status, json.error?.message ?? `Gemini error ${res.status}`);
  return json;
}

// Interactions API (current).
function interactionsRequest(prompt, aspectRatio, refs) {
  return post("/interactions", {
    model: config.geminiImageModel,
    input: [{ type: "text", text: prompt }, ...refs.map((r) => ({ type: "image", mime_type: r.mimeType, data: r.data }))],
    response_format: { type: "image", ...(aspectRatio && { aspect_ratio: aspectRatio }) },
  });
}

// generateContent (older API), used if the Interactions API isn't available for this key/model.
function generateContentRequest(prompt, aspectRatio, refs) {
  return post(`/models/${encodeURIComponent(config.geminiLegacyImageModel)}:generateContent`, {
    contents: [
      { parts: [{ text: prompt }, ...refs.map((r) => ({ inline_data: { mime_type: r.mimeType, data: r.data } }))] },
    ],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...(aspectRatio && { imageConfig: { aspectRatio } }) },
  });
}

/**
 * Generate an image with Gemini. Returns { buffer, mimeType, text }.
 * `referenceImageUrls` are optional images to edit or take style from.
 */
export async function generateImage({ prompt, aspectRatio, referenceImageUrls = [] }) {
  if (!geminiConfigured()) throw new Error("Image generation isn't set up (GEMINI_API_KEY is missing).");
  const ratio = ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : undefined;
  const refs = await Promise.all(referenceImageUrls.slice(0, 3).map(fetchReference));

  let json;
  try {
    json = await interactionsRequest(prompt, ratio, refs);
  } catch (err) {
    // Unknown endpoint/model for this key → try the older API before giving up.
    if (!(err instanceof GeminiError) || ![400, 404].includes(err.status)) throw err;
    console.warn(`Gemini Interactions API failed (${err.status}: ${err.message}); trying generateContent.`);
    json = await generateContentRequest(prompt, ratio, refs);
  }

  const [image] = extractImages(json);
  if (!image) {
    const reason = extractText(json) || json?.promptFeedback?.blockReason || "no image came back";
    throw new Error(`Gemini didn't return an image: ${reason}`.slice(0, 400));
  }
  return { buffer: Buffer.from(image.data, "base64"), mimeType: image.mimeType, text: extractText(json) };
}

export function describeGeminiError(err) {
  if (err instanceof GeminiError) {
    if (err.status === 401 || err.status === 403) return "Gemini rejected the API key — check GEMINI_API_KEY in Railway.";
    if (err.status === 429) return "Gemini's rate limit or quota was hit — wait a minute, or check billing in Google AI Studio.";
    return `Gemini error ${err.status}: ${err.message}`.slice(0, 400);
  }
  return err.message ?? String(err);
}

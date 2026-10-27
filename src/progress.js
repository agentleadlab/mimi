import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLORS, card } from "./ui.js";

// Live progress card: for slower jobs, Mimi posts an animated card and updates
// it at each real step (reading, tools, writing), then turns it into her answer.

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "progress");
const STRIPS = [1, 2, 3, 4].map((n) => ({ name: `progress-${n}.gif`, file: path.join(dir, `step-${n}.gif`) }));
let cache = null;
const strip = (step) => {
  cache ??= STRIPS.map((s) => (fs.existsSync(s.file) ? { name: s.name, buffer: fs.readFileSync(s.file) } : null));
  return cache[Math.min(Math.max(step, 1), 4) - 1];
};

// Only show the card if the answer takes longer than this.
export const SHOW_AFTER_MS = 3500;
// Discord allows ~5 edits per 5 s per channel; stay well under it.
const MIN_EDIT_GAP_MS = 1200;

// What Mimi is doing, by tool.
const TOOL_STEPS = [
  [/^create_report_deck$/, "Designing the deck", "Building slides in the house style"],
  [/^meta_ad_insights$/, "Pulling live Meta numbers", "Spend, leads and CPL from Ads Manager"],
  [/^meta_ad_details$/, "Grabbing the ads", "Copy, headlines and images"],
  [/^generate_image$/, "Generating the image", "Gemini is drawing it"],
  [/^canva_autofill$/, "Building designs in Canva", "Filling the template"],
  [/^canva_(resize|export)$/, "Working in Canva", "Resizing and exporting"],
  [/^canva_/, "Checking Canva", "Templates and designs"],
  [/^(list_ad_samples|create_sample_preview_links)$/, "Finding the samples", "Checking the ad sample library"],
  [/^post_to_channel$/, "Posting it", "Sending to the channel"],
];

export function describeTools(names) {
  for (const [re, title, detail] of TOOL_STEPS) if (names.some((n) => re.test(n))) return { title, detail };
  return { title: "Working on it", detail: "Running the numbers" };
}

/** Step 1 wording, based on what was sent. */
export function startStep({ imageCount = 0, fileCount = 0 } = {}) {
  if (imageCount) return { title: `Reading ${imageCount} screenshot${imageCount === 1 ? "" : "s"}`, detail: "Pulling out every number" };
  if (fileCount) return { title: "Reading your file", detail: "Going through it line by line" };
  return { title: "On it", detail: "Reading your request" };
}

export class ProgressCard {
  /**
   * @param {{ post: (payload) => Promise<Message>, edit: (msg, payload) => Promise<Message>, requester?: string }} io
   */
  constructor(io, first, { showAfterMs = SHOW_AFTER_MS, minGapMs = MIN_EDIT_GAP_MS } = {}) {
    this.io = io;
    this.minGapMs = minGapMs;
    this.state = { step: 1, ...first };
    this.message = null;
    this.done = false;
    this.lastEdit = 0;
    this.pending = null;
    this.chain = Promise.resolve();
    this.timer = setTimeout(() => this.#run(() => this.#show()), showAfterMs);
  }

  /** Mimi is about to run tools (round = how many tool rounds so far). */
  tools(names) {
    const next = Math.min(this.state.step + 1, 3);
    this.#set({ step: Math.max(next, 2), ...describeTools(names) });
  }

  /** Tools are done; she's writing the answer. */
  writing() {
    if (this.state.step >= 2) this.#set({ step: 4, title: "Putting it together", detail: "Writing it up" });
  }

  /** Replace the card with the final first payload (or send normally if it never showed). Returns the message. */
  finish(payload) {
    this.done = true;
    clearTimeout(this.timer);
    clearTimeout(this.pending);
    return this.#run(async () => {
      const sent = this.message
        ? // Drop the progress GIF; keep any real files from the answer.
          await this.io.edit(this.message, { content: payload.content ?? "", embeds: payload.embeds ?? [], files: payload.files ?? [], attachments: [] })
        : await this.io.post(payload);
      this.finished = true;
      return sent;
    });
  }

  /** Stop updating. Returns the card message if it's showing and wasn't turned into an answer. */
  async cancel() {
    this.done = true;
    clearTimeout(this.timer);
    clearTimeout(this.pending);
    await this.chain.catch(() => {});
    return this.finished ? null : this.message;
  }

  #set(next) {
    if (this.done) return;
    this.state = { ...this.state, ...next };
    if (!this.message) return; // shown later with the latest state
    clearTimeout(this.pending);
    const wait = Math.max(0, this.lastEdit + this.minGapMs - Date.now());
    this.pending = setTimeout(() => this.#run(() => this.#update()), wait);
  }

  #run(fn) {
    const p = this.chain.then(fn);
    this.chain = p.catch((err) => console.warn("Progress card update failed:", err.message));
    return p;
  }

  #payload() {
    const { step, title, detail } = this.state;
    const s = strip(step);
    const embed = card({
      title: `${title}…`,
      description: `${detail}\n-# Step ${step} of 4`,
      color: COLORS.brand,
      footerText: this.io.requester ? `working for ${this.io.requester}` : "working",
      timestamp: false,
    });
    if (s) embed.image = { url: `attachment://${s.name}` };
    return { embeds: [embed], files: s ? [{ attachment: s.buffer, name: s.name }] : [], attachments: [] };
  }

  async #show() {
    if (this.done || this.message) return;
    this.message = await this.io.post(this.#payload());
    this.lastEdit = Date.now();
  }

  async #update() {
    if (this.done || !this.message) return;
    await this.io.edit(this.message, this.#payload());
    this.lastEdit = Date.now();
  }
}

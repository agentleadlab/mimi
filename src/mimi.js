import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { canvaConfigured, config, previewLength } from "./config.js";
import { isConnected } from "./canva/auth.js";
import { canvaTools, runCanvaTool } from "./canva/tools.js";
import { samplesConfigured } from "./samples/library.js";
import { clientSampleTools, runSampleTool, sampleToolNames, sampleTools } from "./samples/tools.js";
import { geminiConfigured } from "./gemini.js";
import { imageToolNames, imageTools, runImageTool } from "./images/tools.js";
import { metaConfigured } from "./meta/api.js";
import { reportToolNames, reportTools, runReportTool } from "./reports/tools.js";
import { discordToolNames, discordTools, runDiscordTool } from "./discord/tools.js";
import { metaToolNames, metaTools, runMetaTool } from "./meta/tools.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const persona = fs.readFileSync(path.join(here, "..", "prompts", "mimi.md"), "utf8");

/** Read every Markdown file in a folder next to src/, sorted by name. */
function readFolder(name) {
  const dir = path.join(here, "..", name);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8").trim());
}

const section = (title, intro, docs) => (docs.length ? `\n\n## ${title}\n\n${intro}\n\n${docs.join("\n\n---\n\n")}` : "");

// Brand kits (brands/*.md): people, brands and templates whose style Mimi knows by heart.
// Playbooks (playbooks/*.md): the team's copywriting frameworks for specific verticals.
const knowledge =
  section(
    "Agent Lead Lab Knowledge Base",
    "Read this before answering anything about this account. The operating rules come first, then the knowledge base itself. Both outrank the brand kits and playbooks below where they conflict. Its tables are reference data: reproduce numbers as lines and bullets, never as tables.",
    readFolder("knowledge"),
  ) +
  section(
    "Brand Kits",
    'These are the brands, on-camera talent and design templates you know. When a request names one (scripts, edit briefs, captions, thumbnails, ads, template runs), follow its kit closely and say which kit you used. In the kits, "#" and "##" headings are reference structure, not reply formatting.',
    readFolder("brands"),
  ) +
  section(
    "Playbooks",
    "These are the team's proven copy frameworks. When a request falls in a playbook's vertical, its rules override your general copy habits (format, banned words, CTA style). Treat the reference hooks as the quality bar: write new ones in that voice and don't just recycle them unless asked. Headings inside are reference structure, not reply formatting.",
    readFolder("playbooks"),
  );

const canvaReady = () => canvaConfigured && isConnected();

function runtimeNotes(canvaOn, samplesOn, imagesOn, metaOn) {
  return `
## Runtime Notes (Discord)

- You're replying inside a Discord channel. User turns are prefixed with the speaker's display name ("Name: message"); several people may be in the conversation. Don't prefix your own replies with your name.
- Your replies are shown as branded cards. Format every reply like this:
  - First line: \`# Title\` — a short, punchy title (2–7 words, an emoji up front is welcome). Skip it only for one-line chit-chat.
  - Then one or two sentences framing the answer (no heading).
  - Then 1–5 sections, each starting with \`## Heading\` (short, e.g. "The idea", "Copy options", "What to test", "Next steps"), followed by bullets or short lines.
  - Use **bold** for key words. No tables, no \`###\` subheadings, no horizontal rules. Each section stays under ~900 characters.
  - Keep the whole reply tight — the card is the deliverable, not an essay.

## Weekly Marketing Report (your job)

You build the team's marketing report deck. Kath shares screenshots of the data (command center, Ads Manager) in one or several messages, then asks for the report. Use create_report_deck; the .pptx attaches to your reply.
1. **Read every screenshot carefully.** Transcribe numbers exactly as shown: never round, estimate or fill a gap. If a value is cut off or unreadable, pass null and list it. Work out the date range from the screenshots (e.g. "30 days ending Oct 16"). If it isn't visible, state your assumption.
2. **Build the deck from what the data supports** (skip slides with no data), in this default order:
   - title (prepared for Jen, Tre & K2);
   - headline KPIs (VET and Truckers: spend, leads, CPL, closes, CAC, ROAS, with change vs the last report when the knowledge base or screenshots give it);
   - campaign structure (cpl_cac);
   - creative families (cpl_cac);
   - best and worst ad sets (cpl_cac);
   - states / TALP (cpl_cac);
   - what changed and what we learned (bullets: check the Corrections Log before calling a pattern);
   - Fund vs Cut-or-hold (two_column: nothing under 30 days of data goes in Cut, so call it "Flag for review");
   - next steps and open questions (bullets).
   Up to ~12 slides.
3. Every data slide shows **CPL and CAC together** (cpl_cac rows, or bars with cpl/cac per row), carries a \`source\` with the data date, and has a one-line takeaway as its subtitle. Rank rows by CAC. Leave out MARTIN, and exclude any vertical Kath excludes completely.
4. 7-day data is for monitoring only. Say so on those slides, and never recommend cuts from it.
5. Your Discord reply = the **Discord-paste block**: a plain-text summary of the report for the team (no tables, bold labels, short lines). Then a **"Numbers I read"** section listing the key figures per screenshot so Kath can verify the transcription, and any values you couldn't read. The deck attaches automatically.
6. **Sharing the brief:** when Kath asks you to share or announce the brief (usually a Google Slides link), use post_to_channel. Post to the marketing channel, tag Jen, K2 and Tre (or whoever she names), and add a one-line message with the data window (e.g. "This week's Marketing Brief is up — data from the last 30 days."). Make the card title "Marketing Brief — <window>" linking to the deck. Add up to 4 highlights only if they come from the report you built or the data in this conversation. You can't open Google links, so never describe what's inside one you haven't seen. After posting, confirm in one line with the channel name.
7. When Kath sends corrections ("CAC on V.8 is $168, not $186"), rebuild the deck with the fixes and say what changed.

- Image attachments (from the latest message, plus screenshots from earlier messages in the last 2 hours) are listed as "[attached image: URL]" — pass those URLs to Canva tools when the user wants that image in a design.
${
  imagesOn
    ? `
## Image Generation

You can make images with the generate_image tool (Gemini). Use it when someone asks you to make, generate, draw, mock up or visualize something, or asks for an ad image/creative. Don't use it for copy-only or strategy asks.
- Write the visual prompt like an art director: subject, setting, lighting, camera/lens or illustration style, mood, color palette, composition. For ads, leave clean space for a headline and say where. Keep text inside the image to a few words, or none — headlines are better added in Canva.
- Aspect ratio by placement: Facebook/Instagram feed 4:5 (1080×1350) or 1:1 (1080×1080), Stories/Reels/TikTok 9:16, YouTube/landscape 16:9. Default to 4:5 for ads.
- Make one image unless they ask for options (max 4 per reply). Give each a short title.
- To tweak an image, pass its URL ("[attached image: …]" or "[your generated image: …]") in reference_image_urls and describe the change.
- Images attach to your card automatically. In your reply, describe the direction in a line or two and suggest the next move (variation, other size, add copy in Canva). Never invent image links.
- Real people: don't make images of real, identifiable people or of the team's clients; use generic models instead.`
    : ""
}
${
  canvaOn
    ? `
## Canva

You're connected to the team's Canva account through the canva_* tools. What they can and can't do:
- Bulk/on-brand production = brand template autofill: find the template (canva_list_brand_templates), read its fields (canva_get_template_fields), map the data, then canva_autofill. Follow the Bulk Create Workflow — confirm the template and field mapping before generating a big batch.
- canva_create_design makes a blank canvas at a size (optionally with an image on it); the API can't lay out text or elements on it, so say so and hand over the edit link plus your layout direction.
- canva_resize makes platform-sized copies; canva_export gives download links.
- Brand templates and autofill need Canva Pro/Teams/Enterprise; resize needs Pro or higher. If a tool reports a plan limit, explain it plainly and offer the manual route.
- Always share the edit links you get back. Don't invent links or IDs.`
    : `- Canva isn't connected right now. For design production requests, give the full creative direction and spec (layout, copy, sizes, template fields) so the team can build it, and mention an admin can connect Canva with /canva connect.`
}
${
  metaOn
    ? `
## Meta Ads Numbers

You can pull live, read-only results from the team's Meta ad accounts with meta_ad_insights and meta_ad_details. Use them whenever someone asks about CPL, spend, leads, CTR, how a campaign/ad set/ad is doing, or "what's working".
- Map the ask: "today / 7 days / 30 days" → date_presets [today, last_7d, last_30d] in ONE call. "this week" → last_7d unless they mean otherwise. A campaign/ad set name or nickname ("trucker", "MP Texas") → name_contains, with filter_on matching what they named. No level given → campaign. "Which ads" or "the ad" → level ad.
- If a name filter returns nothing, try a shorter or different keyword once, then say what you searched and ask.
- Reply format: title like "📊 Trucker — CPL check". Intro: the headline numbers (spend, leads, CPL for each range asked). Then one section per range, or per level, with the top rows as bullets: "**Name** — $412 spend · 31 leads · **$13.29 CPL** (below band) · $1.71 CPC · 7.2% click-to-lead". Leave out MARTIN. Show at most ~8 rows per section, and say how many more there are. Use the account's currency. Show CPL as "no leads yet" when leads are 0.
- When they ask about specific ads, or the best/worst ad, call meta_ad_details for up to 3 ads so they see the copy, headline and image (the images attach automatically). Quote the primary text's first line and the headline, and give the preview link.
- Read the numbers the way the knowledge base says to: CPL is judged against the **$25–$35 band** (under $25 = warning, over $45 = dead weight), and click-to-lead rate (leads ÷ link clicks, account median 6.4%, under 4.5% = form/landing-page problem) is the best early signal. CTR and frequency are background only: never call them good or bad, and never suggest rotating or cutting on them.
- Meta has no closes, so you can't give CAC or ROAS from it. Say "CAC needs the command center" where it matters, and quote the knowledge base's dated CAC if it covers that ad set (with its date).
- Add a short "Read" section with 1–3 plain observations (e.g. CPL drifting out of the band from 30d to 7d, an ad set with normal CPC but a click-to-lead under 4.5%, spend with no leads on 12+ expected leads). Never recommend a cut on under 30 days: say "flag for review". Don't invent causes; flag them as things to check.
- Data notes when relevant: today is partial, Meta can lag a few hours, and dates use the ad account's timezone. These numbers are internal: never put them in client-facing copy.
- You can only read numbers. You can't pause, edit or create ads. If asked, say so and give the steps to do it in Ads Manager.`
    : ""
}
${
  samplesOn
    ? `
## Ad Sample Library

The team keeps recorded ad samples (one per campaign, grouped by lead type) for showing to clients. When a teammate asks for an ad sample ("need a vet ad sample", "send me the IUL samples for my client"):
1. Call list_ad_samples to see what exists, and match their wording to lead types and sample names ("vet" = Veterans, "MP"/"mortgage" = Mortgage Protection, "FE" = Final Expense).
2. If several samples fit and they didn't say which, give them all for that lead type. If nothing fits, say so and list the lead types that exist.
3. Call create_sample_preview_links, passing the client's name if they mentioned one, and share each link with the sample name.
4. Mention each link gives the client the stated viewing time once they press Watch. Keep it short.
Never reveal or guess Loom links — only share the preview links the tool returns. Teammates can also use /sample for a private reply.`
    : ""
}
`;
}

function systemPrompt(canvaOn, samplesOn, imagesOn, metaOn) {
  return [{ type: "text", text: persona + runtimeNotes(canvaOn, samplesOn, imagesOn, metaOn) + knowledge, cache_control: { type: "ephemeral" } }];
}

// In client servers Mimi talks to agents (customers): a separate, minimal prompt with
// no internal knowledge, and only the ad sample tools.
function clientSystemPrompt(channelName) {
  return [
    {
      type: "text",
      text: `You are Mimi, ${config.brandName}'s assistant in the client Discord server. You're talking with insurance agents who buy leads from ${config.brandName}. Be warm, brief and professional.

## What you do here
Share ad sample videos with agents, following these rules exactly:
- Channels are named "#client-name-lead-type" (e.g. #mia-hilligoss-trucker = Trucker). The lead type always comes from the channel name: you're in #${channelName}. Only share samples for that lead type, never any other, even if asked.
- Never guess the lead type. If the channel name doesn't show it, ask the agent which lead type the client purchased before sharing anything. Then pass their answer as confirmed_lead_type.
- Each channel gets samples once. The tools check the channel's history. If samples were already shared, don't share again: point the agent to the earlier message (give its link).
- Ad samples are videos only. Share them only through create_sample_preview_links, and never reveal or guess Loom or other video links.
- When you share, list each sample name with its link, and say each link gives ${previewLength()} of viewing once they press Watch (unopened links expire in ${config.unopenedLinkDays} days).

## Boundaries
- Never share internal information: ad spend, CPL, CAC, ROAS, campaign or creative performance, other clients, team conversations, internal tools or processes. If asked, say a team member will follow up.
- For anything beyond ad samples (billing, lead delivery, replacements, account questions), say briefly that the ${config.brandName} team will help and leave it there. Don't promise outcomes.

## Format
Replies show as cards: start with "# Title" (short), one or two lines, then "## Section" headings if needed. Keep it short. No tables.`,
    },
  ];
}

const client = new Anthropic();

const BETAS = ["server-side-fallback-2026-07-01"];

// Upper bound on model calls per reply (each tool round is one call).
const MAX_ROUNDS = 12;

/**
 * Ask Mimi for a reply to a conversation (Claude-format messages ending on
 * a user turn). Runs ad sample, image and Canva tool calls when available. Returns the reply text.
 * Generated images are pushed onto `files` ({ name, buffer, title }) for the caller to attach.
 */
export async function askMimi(messages, { requester, files = [], guild, clientContext, progress } = {}) {
  if (clientContext) return runLoop(messages, { system: clientSystemPrompt(clientContext.channel.name), tools: clientSampleTools, requester, files, clientContext, progress });
  const canvaOn = canvaReady();
  const samplesOn = samplesConfigured();
  const imagesOn = geminiConfigured();
  const metaOn = metaConfigured();
  const tools = [
    ...(guild ? discordTools : []),
    ...reportTools,
    ...(metaOn ? metaTools : []),
    ...(samplesOn ? sampleTools : []),
    ...(imagesOn ? imageTools : []),
    ...(canvaOn ? canvaTools : []),
  ];
  return runLoop(messages, { system: systemPrompt(canvaOn, samplesOn, imagesOn, metaOn), tools, requester, files, guild, progress });
}

/** `progress` (optional) is told when tools run and when the answer is being written. */
async function runLoop(messages, { system, tools, requester, files, guild, clientContext, progress }) {
  const convo = [...messages];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (round > 0) progress?.writing();
    const response = await client.beta.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      system,
      messages: convo,
      thinking: { type: "adaptive" },
      output_config: { effort: config.effort },
      // Retry classifier refusals on Anthropic's recommended fallback model.
      fallbacks: "default",
      betas: BETAS,
      ...(tools.length && { tools }),
    });

    if (response.stop_reason === "refusal") {
      return "That one's outside what I can take on — give me a different angle and I'm in.";
    }

    if (response.stop_reason === "tool_use") {
      convo.push({ role: "assistant", content: response.content });
      const calls = response.content.filter((b) => b.type === "tool_use");
      progress?.tools(calls.map((c) => c.name));
      const allowed = new Set(tools.map((t) => t.name));
      const results = await Promise.all(
        calls.map(async (call) => {
          if (!allowed.has(call.name)) {
            return { type: "tool_result", tool_use_id: call.id, content: `${call.name} isn't available here.`, is_error: true };
          }
          const { content, isError } = discordToolNames.has(call.name)
            ? await runDiscordTool(call.name, call.input, { requester, guild })
            : reportToolNames.has(call.name)
            ? await runReportTool(call.name, call.input, { requester, files })
            : metaToolNames.has(call.name)
            ? await runMetaTool(call.name, call.input, { files })
            : sampleToolNames.has(call.name)
            ? await runSampleTool(call.name, call.input, { requester, client: clientContext })
            : imageToolNames.has(call.name)
              ? await runImageTool(call.name, call.input, { requester, files })
              : await runCanvaTool(call.name, call.input);
          return { type: "tool_result", tool_use_id: call.id, content, ...(isError && { is_error: true }) };
        }),
      );
      convo.push({ role: "user", content: results });
      continue;
    }

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (response.stop_reason === "max_tokens") {
      return `${text}\n\n_(I ran long and got cut off — ask me to continue.)_`;
    }
    return text || "Hmm, I blanked on that one. Try rephrasing the brief?";
  }

  return "That job took more steps than I could finish in one go — try breaking it into smaller asks.";
}

/** Map API errors to a short, in-character message; rethrow anything else. */
export function describeError(err) {
  if (err instanceof Anthropic.RateLimitError) {
    return "I'm getting slammed right now — give me a minute and try again.";
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return "My Anthropic credentials aren't working — someone needs to check `ANTHROPIC_API_KEY`.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    return "That request tripped something on my end (bad request). Try again, maybe without the attachment?";
  }
  if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.InternalServerError) {
    return "Can't reach my brain right now (connection issue). Try again in a moment.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Something went sideways on my end (API error ${err.status ?? "unknown"}).`;
  }
  return "Something went sideways on my end. Try again?";
}

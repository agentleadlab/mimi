import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { canvaConfigured, config } from "./config.js";
import { isConnected } from "./canva/auth.js";
import { canvaTools, runCanvaTool } from "./canva/tools.js";
import { samplesConfigured } from "./samples/library.js";
import { runSampleTool, sampleToolNames, sampleTools } from "./samples/tools.js";
import { geminiConfigured } from "./gemini.js";
import { imageToolNames, imageTools, runImageTool } from "./images/tools.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const persona = fs.readFileSync(path.join(here, "..", "prompts", "mimi.md"), "utf8");

const canvaReady = () => canvaConfigured && isConnected();

function runtimeNotes(canvaOn, samplesOn, imagesOn) {
  return `
## Runtime Notes (Discord)

- You're replying inside a Discord channel. User turns are prefixed with the speaker's display name ("Name: message"); several people may be in the conversation. Don't prefix your own replies with your name.
- Your replies are shown as branded cards. Format every reply like this:
  - First line: \`# Title\` — a short, punchy title (2–7 words, an emoji up front is welcome). Skip it only for one-line chit-chat.
  - Then one or two sentences framing the answer (no heading).
  - Then 1–5 sections, each starting with \`## Heading\` (short, e.g. "The idea", "Copy options", "What to test", "Next steps"), followed by bullets or short lines.
  - Use **bold** for key words. No tables, no \`###\` subheadings, no horizontal rules. Each section stays under ~900 characters.
  - Keep the whole reply tight — the card is the deliverable, not an essay.
- Image attachments in the latest message are listed as "[attached image: URL]" — pass those URLs to Canva tools when the user wants that image in a design.
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
  samplesOn
    ? `
## Ad Sample Library

The team keeps recorded ad samples (one per campaign, grouped by lead type) for showing to clients. When a teammate asks for an ad sample ("need a vet ad sample", "send me the IUL samples for my client"):
1. Call list_ad_samples to see what exists, and match their wording to lead types and sample names ("vet" = Veterans, "MP"/"mortgage" = Mortgage Protection, "FE" = Final Expense).
2. If several samples fit and they didn't say which, give them all for that lead type. If nothing fits, say so and list the lead types that exist.
3. Call create_sample_preview_links, passing the client's name if they mentioned one, and share each link with the sample name.
4. Mention each link gives the client the stated minutes once they press Watch. Keep it short.
Never reveal or guess Loom links — only share the preview links the tool returns. Teammates can also use /sample for a private reply.`
    : ""
}
`;
}

function systemPrompt(canvaOn, samplesOn, imagesOn) {
  return [{ type: "text", text: persona + runtimeNotes(canvaOn, samplesOn, imagesOn), cache_control: { type: "ephemeral" } }];
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
export async function askMimi(messages, { requester, files = [] } = {}) {
  const canvaOn = canvaReady();
  const samplesOn = samplesConfigured();
  const imagesOn = geminiConfigured();
  const tools = [
    ...(samplesOn ? sampleTools : []),
    ...(imagesOn ? imageTools : []),
    ...(canvaOn ? canvaTools : []),
  ];
  const convo = [...messages];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      system: systemPrompt(canvaOn, samplesOn, imagesOn),
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
      const results = await Promise.all(
        calls.map(async (call) => {
          const { content, isError } = sampleToolNames.has(call.name)
            ? await runSampleTool(call.name, call.input, { requester })
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

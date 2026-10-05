import { getSamples, samplesConfigured, verticalsOf } from "./library.js";
import { createPreviewLink } from "./links.js";
import { config } from "../config.js";

export const sampleTools = [
  {
    name: "list_ad_samples",
    description:
      "List the team's ad sample library (sample name, lead type/vertical, campaign, tags). Use it to find which samples fit a request, e.g. 'vet ad' = Veterans, 'MP' = Mortgage Protection.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_sample_preview_links",
    description:
      `Create time-limited preview links for ad samples, for the requester to send to a client. Each link works for ${config.previewMinutes} minutes after it's first opened. ` +
      "Pass exact sample names from list_ad_samples. Only call this when someone actually asks for sample links.",
    input_schema: {
      type: "object",
      properties: {
        sample_names: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 },
        client: { type: "string", description: "Client the links are for, if mentioned." },
      },
      required: ["sample_names"],
    },
  },
];

export const sampleToolNames = new Set(sampleTools.map((t) => t.name));

/** Run a sample tool. `context.requester` is the Discord display name of whoever asked. */
export async function runSampleTool(name, input, context = {}) {
  try {
    if (!samplesConfigured()) throw new Error("The ad sample library isn't set up yet.");
    const samples = await getSamples();

    if (name === "list_ad_samples") {
      return {
        content: JSON.stringify({
          lead_types: verticalsOf(samples),
          samples: samples.map((s) => ({ name: s.name, lead_type: s.vertical, campaign: s.campaign, tags: s.tags })),
        }),
        isError: false,
      };
    }

    if (name === "create_sample_preview_links") {
      const wanted = (input?.sample_names ?? []).map((n) => String(n).trim().toLowerCase());
      const found = samples.filter((s) => wanted.includes(s.name.toLowerCase()));
      const missing = wanted.filter((n) => !found.some((s) => s.name.toLowerCase() === n));
      const links = found.map((s) => ({
        sample: s.name,
        lead_type: s.vertical,
        url: createPreviewLink(s, { requestedBy: context.requester, client: input?.client }).url,
      }));
      return {
        content: JSON.stringify({
          links,
          missing,
          note: `Links work for ${config.previewMinutes} min after first open; unopened links expire in ${config.unopenedLinkDays} days. The timer starts when the viewer presses Watch on the page, so pasting the link into texts/emails is safe.`,
        }),
        isError: links.length === 0,
      };
    }

    return { content: `Unknown tool: ${name}`, isError: true };
  } catch (err) {
    return { content: err.message, isError: true };
  }
}

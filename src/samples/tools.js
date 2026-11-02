import { getSamples, samplesConfigured, verticalsOf } from "./library.js";
import { createPreviewLink } from "./links.js";
import { config, previewLength } from "../config.js";
import { findPreviousShare, leadTypeFromChannel, recordShare } from "./clientShare.js";

export const sampleTools = [
  {
    name: "list_ad_samples",
    description:
      "List the team's ad sample library. Each sample is one lead type product (e.g. 'Text-Verified VET PLUS', 'Text-Verified VET Standard'), grouped by vertical (Veterans, Truckers, Final Expense…). Use it to match an agent to the one sample for the lead type they're running.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_sample_preview_links",
    description:
      `Create time-limited preview links (${previewLength()} of viewing after the viewer presses Watch): one link for each lead type requested. ` +
      "Pass the exact sample names from list_ad_samples, one per requested lead type. Don't add samples that weren't asked for.",
    input_schema: {
      type: "object",
      properties: {
        sample_names: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10, description: "Exact sample names, one per requested lead type." },
        client: { type: "string", description: "The agent/client the links are for." },
      },
      required: ["sample_names"],
    },
  },
];

export const sampleToolNames = new Set(sampleTools.map((t) => t.name));

// Client server versions: lead type comes from the channel name, once per channel.
export const clientSampleTools = [
  {
    name: "list_ad_samples",
    description: "See which ad samples exist for this channel's lead type (the lead type comes from the channel name).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_sample_preview_links",
    description:
      `Share the ad sample video for this channel's lead type as a time-limited preview link (${previewLength()} of viewing after the viewer presses Watch). If the channel's lead type has several samples and you don't know which one the agent runs, this returns the options to ask about. ` +
      "The lead type always comes from the channel name; you can't share other lead types. Each channel gets samples only once: if they were already shared, this returns the earlier message to point to. " +
      "Only pass confirmed_lead_type when the channel name doesn't show the lead type AND the agent has told you which lead type the client purchased.",
    input_schema: {
      type: "object",
      properties: {
        sample_name: { type: "string", description: "The exact sample for the lead type they run (needed when the lead type has several samples)." },
        confirmed_lead_type: { type: "string", description: "Only when the channel name doesn't show the lead type: what the agent confirmed." },
        client: { type: "string", description: "The agent/client name, for the log." },
      },
    },
  },
];

async function runClientSampleTool(name, input, context, samples) {
  const { channel, botId } = context.client;
  const verticals = verticalsOf(samples);
  const fromChannel = leadTypeFromChannel(channel.name, verticals);

  if (name === "list_ad_samples") {
    if (!fromChannel) {
      return {
        content: JSON.stringify({
          lead_type: null,
          channel: `#${channel.name}`,
          instruction: "The channel name doesn't show the lead type. Ask the agent which lead type the client purchased before sharing anything. Don't guess.",
        }),
        isError: false,
      };
    }
    return {
      content: JSON.stringify({
        lead_type: fromChannel,
        channel: `#${channel.name}`,
        samples: samples.filter((s) => s.vertical === fromChannel).map((s) => ({ name: s.name, campaign: s.campaign })),
      }),
      isError: false,
    };
  }

  // create_sample_preview_links: one share at a time per channel.
  if (sharing.has(channel.id)) return { content: "Samples are already being shared in this channel right now.", isError: true };
  sharing.add(channel.id);
  try {
    return await shareOnce(input, context, samples, verticals, fromChannel);
  } finally {
    sharing.delete(channel.id);
  }
}

const sharing = new Set();

async function shareOnce(input, context, samples, verticals, fromChannel) {
  const { channel, botId } = context.client;
  const previous = await findPreviousShare(channel, botId);
  if (previous) {
    return {
      content: JSON.stringify({
        already_shared: true,
        shared_at: new Date(previous.at).toISOString(),
        message_link: previous.messageUrl ?? "(earlier in this channel)",
        samples: previous.samples,
        instruction: "Don't share again. Point the agent to the earlier message link.",
      }),
      isError: true,
    };
  }

  let leadType = fromChannel;
  if (!leadType) {
    const confirmed = String(input?.confirmed_lead_type ?? "").trim().toLowerCase();
    leadType = confirmed ? leadTypeFromChannel(`x-${confirmed}`, verticals) ?? verticals.find((v) => v.toLowerCase() === confirmed) : null;
    if (!leadType) {
      return {
        content: confirmed
          ? `"${input.confirmed_lead_type}" doesn't match a lead type in the library (${verticals.join(", ")}). Ask the agent to confirm.`
          : "The channel name doesn't show the lead type. Ask the agent which lead type the client purchased first.",
        isError: true,
      };
    }
  }

  const ofType = samples.filter((s) => s.vertical === leadType);
  const wanted = String(input?.sample_name ?? input?.sample_names?.[0] ?? "").trim().toLowerCase();
  const picked = wanted ? ofType.filter((s) => s.name.toLowerCase() === wanted) : ofType;
  if (wanted && !picked.length) {
    return { content: `"${input.sample_name ?? wanted}" isn't a ${leadType} sample. Only ${leadType} samples can be shared here: ${ofType.map((s) => s.name).join(", ")}.`, isError: true };
  }
  if (!picked.length) return { content: `There are no ${leadType} samples in the library yet. The team will follow up.`, isError: true };
  if (picked.length > 1) {
    return {
      content: JSON.stringify({
        needs_confirmation: true,
        lead_type: leadType,
        options: picked.map((s) => s.name),
        instruction: "Ask the agent which of these lead types they're running, then share that one.",
      }),
      isError: true,
    };
  }

  const chosen = picked;
  recordShare(channel.id, { samples: chosen.map((s) => s.name), leadType, by: context.requester });
  context.client.shared = true;
  const links = chosen.map((s) => ({ sample: s.name, url: createPreviewLink(s, { requestedBy: context.requester, client: input?.client ?? `#${channel.name}` }).url }));
  return {
    content: JSON.stringify({
      lead_type: leadType,
      links,
      note: `Each link gives ${previewLength()} of viewing once the viewer presses Watch; unopened links expire in ${config.unopenedLinkDays} days. This is the one-time share for this channel.`,
    }),
    isError: false,
  };
}

/** Run a sample tool. `context.requester` is the Discord display name of whoever asked. */
export async function runSampleTool(name, input, context = {}) {
  try {
    if (!samplesConfigured()) throw new Error("The ad sample library isn't set up yet.");
    const samples = await getSamples();
    if (context.client) return await runClientSampleTool(name, input, context, samples);

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
      // One link per requested lead type.
      const names = [input?.sample_name, ...(input?.sample_names ?? [])].map((n) => String(n ?? "").trim()).filter(Boolean);
      const unique = [...new Set(names.map((n) => n.toLowerCase()))].slice(0, 10);
      const found = unique.map((n) => samples.find((s) => s.name.toLowerCase() === n)).filter(Boolean);
      const missing = unique.filter((n) => !found.some((s) => s.name.toLowerCase() === n));
      const links = found.map((s) => ({
        sample: s.name,
        lead_type: s.vertical,
        url: createPreviewLink(s, { requestedBy: context.requester, client: input?.client }).url,
      }));
      return {
        content: JSON.stringify({
          links,
          missing,
          note: `Links give ${previewLength()} of viewing after the client presses Watch; unopened links expire in ${config.unopenedLinkDays} days. The timer starts when the viewer presses Watch on the page, so pasting the link into texts/emails is safe.`,
        }),
        isError: links.length === 0,
      };
    }

    return { content: `Unknown tool: ${name}`, isError: true };
  } catch (err) {
    return { content: err.message, isError: true };
  }
}

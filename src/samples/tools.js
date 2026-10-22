import { getSamples, samplesConfigured, verticalsOf } from "./library.js";
import { createPreviewLink } from "./links.js";
import { config, previewLength } from "../config.js";
import { findPreviousShare, leadTypeFromChannel, recordShare } from "./clientShare.js";

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
      `Create time-limited preview links for ad samples, for the requester to send to a client. Each link gives the client ${previewLength()} of viewing after they press Watch. ` +
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
      `Share this channel's ad sample video(s) as time-limited preview links (${previewLength()} of viewing after the viewer presses Watch). ` +
      "The lead type always comes from the channel name; you can't share other lead types. Each channel gets samples only once: if they were already shared, this returns the earlier message to point to. " +
      "Only pass confirmed_lead_type when the channel name doesn't show the lead type AND the agent has told you which lead type the client purchased.",
    input_schema: {
      type: "object",
      properties: {
        sample_names: { type: "array", items: { type: "string" }, maxItems: 10, description: "Specific samples; default: all samples for the lead type." },
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
  const wanted = (input?.sample_names ?? []).map((n) => String(n).trim().toLowerCase()).filter(Boolean);
  const picked = wanted.length ? ofType.filter((s) => wanted.includes(s.name.toLowerCase())) : ofType;
  const refused = wanted.filter((n) => !ofType.some((s) => s.name.toLowerCase() === n));
  if (!picked.length) {
    return {
      content: `No ${leadType} samples match that request${refused.length ? ` (${refused.join(", ")} isn't a ${leadType} sample)` : ""}. Only ${leadType} samples can be shared here.`,
      isError: true,
    };
  }

  const chosen = picked.slice(0, 10);
  recordShare(channel.id, { samples: chosen.map((s) => s.name), leadType, by: context.requester });
  context.client.shared = true;
  const links = chosen.map((s) => ({ sample: s.name, url: createPreviewLink(s, { requestedBy: context.requester, client: input?.client ?? `#${channel.name}` }).url }));
  return {
    content: JSON.stringify({
      lead_type: leadType,
      links,
      ...(refused.length && { not_shared: refused, reason: `not ${leadType} samples` }),
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

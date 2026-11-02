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
      `Create ONE time-limited preview link: the single ad sample matching the lead type this agent runs (${previewLength()} of viewing after they press Watch). ` +
      "One sample per agent. Only call this once you know their exact lead type; if more than one sample could fit, ask which lead type they're running instead.",
    input_schema: {
      type: "object",
      properties: {
        sample_name: { type: "string", description: "Exact sample name from list_ad_samples." },
        client: { type: "string", description: "The agent/client the link is for." },
      },
      required: ["sample_name"],
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
      `Share this agent's ONE ad sample video as a time-limited preview link (${previewLength()} of viewing after the viewer presses Watch). One sample per agent: if the channel's lead type has several samples and you don't know which one they run, this returns the options to ask about. ` +
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
        instruction: "One sample per agent. Ask the agent which of these lead types they're running, then share that one.",
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
      // One sample per agent.
      const names = [input?.sample_name, ...(input?.sample_names ?? [])].map((n) => String(n ?? "").trim()).filter(Boolean);
      const unique = [...new Set(names.map((n) => n.toLowerCase()))];
      if (unique.length > 1) {
        return {
          content: JSON.stringify({
            needs_confirmation: true,
            options: names,
            instruction: "One sample per agent. Ask which lead type they're running, then share only that one.",
          }),
          isError: true,
        };
      }
      const found = samples.filter((s) => s.name.toLowerCase() === unique[0]);
      const missing = found.length ? [] : names;
      const links = found.slice(0, 1).map((s) => ({
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

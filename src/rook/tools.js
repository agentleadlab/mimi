import { getSamples, samplesConfigured, verticalsOf } from "../samples/library.js";
import { createPreviewLink } from "../samples/links.js";
import { createRequest, getRequest, resolveRequests } from "./requests.js";

// Tools Mimi uses when Rook (or a client SMS thread) asks for ad samples. Each one
// adds a "part" to the reply; the message itself is built from fixed templates.

export const rookTools = [
  {
    name: "list_ad_samples",
    description: "The current ad sample library: each sample is one lead type product (e.g. Text-Verified VET PLUS, Text-Verified VET Widows), grouped by vertical.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "send_samples_to_rook",
    description:
      "Send preview links: one per lead type that is clearly identified. Pass the exact sample names. If this answers an earlier NEED CLARIFICATION, pass its ref. " +
      "List anything requested that isn't in the library in `unavailable` (with the closest existing sample, if there's an obvious one) instead of substituting it.",
    input_schema: {
      type: "object",
      properties: {
        client: { type: "string", description: "The agent/client's name." },
        sample_names: { type: "array", items: { type: "string" }, maxItems: 10 },
        ref: { type: "string", description: "The AS-n reference this answers, if any." },
        unavailable: {
          type: "array",
          items: { type: "object", properties: { requested: { type: "string" }, closest: { type: "string" } }, required: ["requested"] },
        },
      },
      required: ["client"],
    },
  },
  {
    name: "send_catalog_to_rook",
    description: "When Rook asks what ad samples exist (or which ones it can offer a client), send the whole library as one list grouped by vertical.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "ask_rook_to_clarify",
    description:
      "When a requested lead type is vague (e.g. 'Vets' and there are two Vet samples), ask Rook to ask the client which one, with a short question in plain words and the exact sample names as options. " +
      "Use it once per vague lead type. Anything that IS clear in the same request still goes through send_samples_to_rook.",
    input_schema: {
      type: "object",
      properties: {
        client: { type: "string" },
        requested: { type: "string", description: "What they asked for, in their words, e.g. 'a sample for Vets'." },
        question_for_client: { type: "string", description: "e.g. 'Which Vet ad would you like to see: VET PLUS or VET Widows?'" },
        options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6, description: "Exact sample names." },
      },
      required: ["client", "question_for_client", "options"],
    },
  },
];

export const rookToolNames = new Set(rookTools.map((t) => t.name));

const lower = (s) => String(s ?? "").trim().toLowerCase();

/** context: { requester, rook: { parts: [], homeChannelId, channelId } } */
export async function runRookTool(name, input = {}, context = {}) {
  try {
    if (!samplesConfigured()) return { content: "The ad sample library isn't set up yet.", isError: true };
    const samples = await getSamples();
    const byName = (n) => samples.find((s) => lower(s.name) === lower(n));
    const rook = context.rook;

    if (name === "list_ad_samples") {
      return {
        content: JSON.stringify({
          verticals: verticalsOf(samples),
          samples: samples.map((s) => ({ name: s.name, vertical: s.vertical, tags: s.tags })),
        }),
        isError: false,
      };
    }

    if (name === "send_samples_to_rook") {
      const wanted = [...new Set((input.sample_names ?? []).map(lower).filter(Boolean))];
      const found = wanted.map(byName).filter(Boolean);
      const notFound = wanted.filter((n) => !byName(n));
      const unavailable = [...(input.unavailable ?? []), ...notFound.map((n) => ({ requested: n }))].filter((u) => u.requested);
      if (!found.length && !unavailable.length) return { content: "Nothing to send: pass sample_names or unavailable.", isError: true };

      let ref = input.ref && getRequest(input.ref) ? String(input.ref).toUpperCase() : null;
      if (found.length) {
        const resolved = resolveRequests(ref ? { ref } : { client: input.client, homeChannelId: rook.homeChannelId });
        ref ??= resolved[0] ?? createRequest({ client: input.client, homeChannelId: rook.homeChannelId, channelId: rook.channelId, requested: wanted.join(", "), status: "done" }).ref;
        const links = found.map((s) => ({ sample: s.name, url: createPreviewLink(s, { requestedBy: context.requester, client: input.client }).url }));
        rook.parts.push({ type: "links", client: input.client, ref, links });
      }
      if (unavailable.length) rook.parts.push({ type: "unavailable", client: input.client, items: unavailable });
      return { content: JSON.stringify({ queued: true, ref, sent: found.map((s) => s.name), unavailable }), isError: false };
    }

    if (name === "send_catalog_to_rook") {
      const groups = verticalsOf(samples).map((v) => ({ vertical: v, samples: samples.filter((s) => s.vertical === v).map((s) => s.name) }));
      rook.parts.push({ type: "catalog", groups });
      return { content: JSON.stringify({ queued: true, verticals: groups.length }), isError: false };
    }

    if (name === "ask_rook_to_clarify") {
      const options = [...new Set((input.options ?? []).map((o) => byName(o)?.name).filter(Boolean))];
      if (options.length < 2) {
        return { content: "Options must be at least two exact sample names from list_ad_samples. If only one fits, send it instead.", isError: true };
      }
      const req = createRequest({
        client: input.client,
        homeChannelId: rook.homeChannelId,
        channelId: rook.channelId,
        requested: input.requested,
        question: input.question_for_client,
        options,
      });
      rook.parts.push({ type: "clarify", client: req.client, ref: req.ref, requested: req.requested, question: req.question, options });
      return { content: JSON.stringify({ queued: true, ref: req.ref, options }), isError: false };
    }

    return { content: `Unknown tool: ${name}`, isError: true };
  } catch (err) {
    return { content: `Couldn't do that: ${err.message}`, isError: true };
  }
}

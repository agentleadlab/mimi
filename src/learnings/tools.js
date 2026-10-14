import { addLearnings, filterLearnings, formatMetrics, removeLearning } from "./store.js";

const metricsSchema = {
  type: "object",
  description: "Key metrics as shown in the results, e.g. {\"spend\": \"$412\", \"leads\": 31, \"CPL\": \"$13.29\", \"CTR\": \"2.4%\", \"hook rate\": \"38%\"}.",
  additionalProperties: { type: ["string", "number"] },
};

export const learningTools = [
  {
    name: "save_ad_learnings",
    description:
      "Save winning hooks (and clear losers) from real Meta ad results so future copy builds on them. " +
      "Only call after you've analyzed the results and the teammate has confirmed (or explicitly said to save). " +
      "Save the actual hook text, never just an ad name. Re-saving a hook updates it.",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string", description: "Date range of the results, e.g. 'Oct 1–14 2026'." },
        entries: {
          type: "array",
          minItems: 1,
          maxItems: 40,
          items: {
            type: "object",
            properties: {
              verdict: { type: "string", enum: ["winner", "loser"] },
              vertical: { type: "string", description: "e.g. Trucker, Mortgage Protection, Final Expense, Veterans, IUL" },
              angle: { type: "string", description: "e.g. 'Angle 3: CDL holders' or 'Spouses'" },
              hook: { type: "string", description: "The exact hook text that ran." },
              ad_name: { type: "string" },
              metrics: metricsSchema,
              why: { type: "string", description: "One line on why it won or lost (pattern, trigger, specificity)." },
            },
            required: ["verdict", "vertical", "hook"],
          },
        },
      },
      required: ["entries"],
    },
  },
  {
    name: "list_ad_learnings",
    description: "List saved ad learnings (winners/losers), optionally filtered by vertical, angle or verdict. Includes IDs for removal.",
    input_schema: {
      type: "object",
      properties: {
        vertical: { type: "string" },
        angle: { type: "string" },
        verdict: { type: "string", enum: ["winner", "loser"] },
      },
    },
  },
  {
    name: "remove_ad_learning",
    description: "Remove a saved learning by ID (when a teammate says it was saved by mistake or is outdated).",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

export const learningToolNames = new Set(learningTools.map((t) => t.name));

export async function runLearningTool(name, input = {}, { requester } = {}) {
  try {
    if (name === "save_ad_learnings") {
      const saved = addLearnings(input.entries ?? [], { savedBy: requester, period: input.period });
      if (!saved.length) return { content: "Nothing saved — each entry needs a verdict (winner/loser) and the hook text.", isError: true };
      console.log(`Saved ${saved.length} ad learning(s) for ${requester ?? "someone"}.`);
      return {
        content: JSON.stringify({ saved: saved.map((s) => ({ id: s.id, verdict: s.verdict, hook: s.hook, updated: Boolean(s.updated) })) }),
        isError: false,
      };
    }
    if (name === "list_ad_learnings") {
      const rows = filterLearnings(input).slice(-50);
      return {
        content: JSON.stringify(
          rows.map((x) => ({ id: x.id, verdict: x.verdict, vertical: x.vertical, angle: x.angle, hook: x.hook, metrics: formatMetrics(x.metrics), period: x.period, savedBy: x.savedBy })),
        ),
        isError: false,
      };
    }
    if (name === "remove_ad_learning") {
      return removeLearning(String(input.id ?? ""))
        ? { content: "Removed.", isError: false }
        : { content: "No learning with that ID.", isError: true };
    }
    return { content: `Unknown tool: ${name}`, isError: true };
  } catch (err) {
    console.error(`${name} failed:`, err);
    return { content: `Couldn't do that: ${err.message}`, isError: true };
  }
}

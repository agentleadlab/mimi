import { buildDeck, SLIDE_TYPES } from "./deck.js";

const unitProp = { type: "string", enum: ["$", "%", "x", ""], description: "$ money, % percent, x multiple (ROAS), empty for plain numbers" };
const numOrNull = { type: ["number", "null"] };

export const reportTools = [
  {
    name: "create_report_deck",
    description:
      "Build the weekly marketing report as a PowerPoint deck (Agent Lead Lab house style: dark theme, green accent, drawn bar charts, CPL and CAC on every data view) and attach it to your reply. " +
      "Slide types: title; kpis (headline number tiles); cpl_cac (rows with CPL and CAC side by side: the default for comparing campaigns, ad sets, creative families or states); " +
      "bars (one other metric, e.g. spend or ROAS, with optional cpl/cac per row); bullets (findings, next steps, with an optional callout line); two_column (e.g. Fund vs Cut). " +
      "Use only numbers read from the screenshots or provided data: never estimate a missing value; pass null instead. Put the data date on every data slide via `source`.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "e.g. 'Weekly Marketing Report'" },
        date_range: { type: "string", description: "e.g. '30 days ending Oct 16, 2026'" },
        file_name: { type: "string", description: "e.g. 'ALL Weekly Report - Oct 16 2026'" },
        slides: {
          type: "array",
          minItems: 1,
          maxItems: 30,
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: SLIDE_TYPES },
              title: { type: "string" },
              subtitle: { type: "string", description: "One-line takeaway for the slide." },
              source: { type: "string", description: "Where/when the data is from, e.g. 'Command center, 30d ending Oct 16'." },
              notes: { type: "string", description: "Speaker notes." },
              prepared_for: { type: "string" },
              prepared_by: { type: "string" },
              kpis: {
                type: "array",
                maxItems: 8,
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    value: { type: ["number", "string", "null"] },
                    unit: unitProp,
                    sub: { type: "string", description: "Context line, e.g. '+3% vs Oct 2'." },
                    tone: { type: "string", enum: ["good", "warn", "bad", "neutral"] },
                  },
                  required: ["label", "value"],
                },
              },
              rows: {
                type: "array",
                maxItems: 12,
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    cpl: numOrNull,
                    cac: numOrNull,
                    value: numOrNull,
                    spend: numOrNull,
                    roas: numOrNull,
                    note: { type: "string" },
                  },
                  required: ["label"],
                },
              },
              metric: { type: "string", description: "bars: the metric name, e.g. 'Spend'." },
              unit: unitProp,
              bullets: { type: "array", items: { type: "string" }, maxItems: 10 },
              callout: { type: "string" },
              left: { type: "object", properties: { heading: { type: "string" }, tone: { type: "string", enum: ["good", "warn", "bad", "neutral"] }, bullets: { type: "array", items: { type: "string" } } } },
              right: { type: "object", properties: { heading: { type: "string" }, tone: { type: "string", enum: ["good", "warn", "bad", "neutral"] }, bullets: { type: "array", items: { type: "string" } } } },
            },
            required: ["type"],
          },
        },
      },
      required: ["title", "slides"],
    },
  },
];

export const reportToolNames = new Set(reportTools.map((t) => t.name));

const safeName = (s) => String(s || "Marketing Report").replace(/[^\w\s.-]+/g, "").trim().slice(0, 80) || "Marketing Report";

export async function runReportTool(name, input = {}, context = {}) {
  if (name !== "create_report_deck") return { content: `Unknown tool: ${name}`, isError: true };
  try {
    const buffer = await buildDeck(input);
    const file = { name: `${safeName(input.file_name ?? `${input.title} ${input.date_range ?? ""}`)}.pptx`, buffer, kind: "document" };
    (context.files ?? []).push(file);
    console.log(`Report deck built for ${context.requester ?? "someone"}: ${file.name} (${input.slides?.length ?? 0} slides).`);
    return { content: `Deck built and attached as "${file.name}" (${input.slides?.length ?? 0} slides).`, isError: false };
  } catch (err) {
    console.error("create_report_deck failed:", err);
    return { content: `Couldn't build the deck: ${err.message}`, isError: true };
  }
}

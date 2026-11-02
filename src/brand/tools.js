import { getState, setState } from "../store.js";

// Tracker for copyright reports about pages copying our ads.
const KEY = "copyReports";
export const STATUSES = ["drafted", "submitted", "removed", "rejected", "appealed", "closed"];

const load = () => getState(KEY) ?? { next: 1, reports: [] };
const save = (s) => setState(KEY, s);
const clean = (v) => String(v ?? "").trim();
const urls = (list) => [...new Set((list ?? []).map(clean).filter((u) => /^https?:\/\//i.test(u)))].slice(0, 20);

export function listCopyReports({ status, page } = {}) {
  const q = clean(page).toLowerCase();
  return load().reports.filter(
    (r) => (!status || r.status === status) && (!q || r.page_name.toLowerCase().includes(q) || r.page_url.toLowerCase().includes(q)),
  );
}

export const brandTools = [
  {
    name: "log_copy_report",
    description:
      "Record a copyright report about a page copying our ads (after drafting it with the Copied Ads playbook). Returns its ID, e.g. CR-7. " +
      "If the same infringing URL is already logged, returns that report instead of a duplicate.",
    input_schema: {
      type: "object",
      properties: {
        page_name: { type: "string" },
        page_url: { type: "string" },
        infringing_urls: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 },
        original_urls: { type: "array", items: { type: "string" }, maxItems: 10 },
        content_type: { type: "string", enum: ["video", "photo", "ad", "text", "mixed"] },
        summary: { type: "string", description: "One line: what was copied." },
        also_impersonation: { type: "boolean", description: "The page also pretends to be Agent Lead Lab or Tre." },
      },
      required: ["page_name", "infringing_urls", "summary"],
    },
  },
  {
    name: "update_copy_report",
    description: "Update a copyright report's status (drafted, submitted, removed, rejected, appealed, closed) and/or add a note such as Meta's report number.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "e.g. CR-7" },
        status: { type: "string", enum: STATUSES },
        note: { type: "string" },
        meta_report_number: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "list_copy_reports",
    description: "List logged copyright reports, optionally by status or page name.",
    input_schema: {
      type: "object",
      properties: { status: { type: "string", enum: STATUSES }, page: { type: "string" } },
    },
  },
];

export const brandToolNames = new Set(brandTools.map((t) => t.name));

export async function runBrandTool(name, input = {}, { requester } = {}) {
  const state = load();
  const now = new Date().toISOString();
  if (name === "log_copy_report") {
    const infringing = urls(input.infringing_urls);
    if (!infringing.length) return { content: "Need at least one link to the copied post, video or ad.", isError: true };
    const dupe = state.reports.find((r) => r.infringing_urls.some((u) => infringing.includes(u)));
    if (dupe) return { content: JSON.stringify({ already_logged: true, report: dupe }), isError: false };
    const report = {
      id: `CR-${state.next}`,
      page_name: clean(input.page_name) || "Unknown page",
      page_url: clean(input.page_url),
      infringing_urls: infringing,
      original_urls: urls(input.original_urls),
      content_type: input.content_type ?? "mixed",
      summary: clean(input.summary),
      also_impersonation: Boolean(input.also_impersonation),
      status: "drafted",
      logged_by: requester ?? "unknown",
      created_at: now,
      updated_at: now,
      notes: [],
    };
    state.next += 1;
    state.reports.push(report);
    save(state);
    return { content: JSON.stringify({ logged: true, report }), isError: false };
  }
  if (name === "update_copy_report") {
    const id = clean(input.id).toUpperCase().replace(/^(\d+)$/, "CR-$1");
    const report = state.reports.find((r) => r.id === id);
    if (!report) return { content: `No report ${id}.`, isError: true };
    if (input.status) report.status = input.status;
    if (input.meta_report_number) report.meta_report_number = clean(input.meta_report_number);
    if (input.note) report.notes.push({ at: now, by: requester ?? "unknown", text: clean(input.note) });
    report.updated_at = now;
    save(state);
    return { content: JSON.stringify({ updated: true, report }), isError: false };
  }
  if (name === "list_copy_reports") {
    return { content: JSON.stringify(listCopyReports(input).slice(-30)), isError: false };
  }
  return { content: `Unknown tool: ${name}`, isError: true };
}

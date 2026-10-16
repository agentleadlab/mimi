import PptxGenJS from "pptxgenjs";
import { config } from "../config.js";

// House deck style (knowledge base, section 12): dark theme, green accent,
// bar charts drawn with shapes (native charts drop category labels),
// CPL and CAC on every data view.
const C = {
  bg: "0B0F0E",
  panel: "131A18",
  line: "25302C",
  text: "E8EFEC",
  muted: "8A9893",
  green: "22C55E",
  amber: "F59E0B",
  red: "EF4444",
  band: "123222",
};
const FONT = "Arial";
const W = 13.333;
const H = 7.5;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export function fmt(v, unit) {
  if (!isNum(v)) return v === null || v === undefined || v === "" ? "—" : String(v);
  if (unit === "$") return `$${v.toLocaleString("en-US", { maximumFractionDigits: v >= 1000 ? 0 : 2, minimumFractionDigits: v >= 1000 || Number.isInteger(v) ? 0 : 2 })}`;
  if (unit === "%") return `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  if (unit === "x") return `${v.toFixed(1)}x`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function cplColor(cpl) {
  if (!isNum(cpl)) return C.muted;
  const { low, high, dead } = config.cplBand;
  if (cpl < low) return C.amber;
  if (cpl <= high) return C.green;
  if (cpl <= dead) return C.amber;
  return C.red;
}

function base(pptx, deck, slideSpec, index) {
  const s = pptx.addSlide();
  s.background = { color: C.bg };
  s.addText(
    [config.brandName, deck.title, deck.date_range].filter(Boolean).join("  ·  "),
    { x: 0.5, y: H - 0.45, w: 10, h: 0.3, fontFace: FONT, fontSize: 9, color: C.muted },
  );
  s.addText(String(index + 1), { x: W - 1, y: H - 0.45, w: 0.5, h: 0.3, fontFace: FONT, fontSize: 9, color: C.muted, align: "right" });
  if (slideSpec.source) {
    s.addText(`Source: ${slideSpec.source}`, { x: 0.5, y: H - 0.75, w: W - 1, h: 0.28, fontFace: FONT, fontSize: 9, italic: true, color: C.muted });
  }
  if (slideSpec.title && slideSpec.type !== "title") {
    s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.45, w: 0.08, h: 0.5, fill: { color: C.green }, line: { color: C.green } });
    s.addText(slideSpec.title, { x: 0.7, y: 0.35, w: W - 1.2, h: 0.7, fontFace: FONT, fontSize: 26, bold: true, color: C.text });
    if (slideSpec.subtitle) {
      s.addText(slideSpec.subtitle, { x: 0.7, y: 1.0, w: W - 1.2, h: 0.4, fontFace: FONT, fontSize: 13, color: C.muted });
    }
  }
  return s;
}

const TOP = 1.6; // content starts below the title block
const BOTTOM = H - 0.85;

function titleSlide(pptx, s, spec, deck) {
  s.addShape(pptx.ShapeType.rect, { x: 0.8, y: 2.3, w: 0.12, h: 1.9, fill: { color: C.green }, line: { color: C.green } });
  s.addText(spec.title ?? deck.title, { x: 1.1, y: 2.1, w: 11, h: 1.2, fontFace: FONT, fontSize: 40, bold: true, color: C.text });
  s.addText(spec.subtitle ?? deck.date_range ?? "", { x: 1.1, y: 3.25, w: 11, h: 0.6, fontFace: FONT, fontSize: 18, color: C.green });
  if (spec.prepared_for || spec.prepared_by) {
    s.addText([spec.prepared_for && `For ${spec.prepared_for}`, spec.prepared_by && `Prepared by ${spec.prepared_by}`].filter(Boolean).join("  ·  "), {
      x: 1.1, y: 3.85, w: 11, h: 0.4, fontFace: FONT, fontSize: 12, color: C.muted,
    });
  }
}

function kpiSlide(pptx, s, spec) {
  const kpis = (spec.kpis ?? []).slice(0, 8);
  const cols = kpis.length <= 3 ? kpis.length : 4;
  const rows = Math.ceil(kpis.length / cols) || 1;
  const gap = 0.25;
  const w = (W - 1 - gap * (cols - 1)) / cols;
  const h = Math.min(2.3, (BOTTOM - TOP - 0.2 - gap * (rows - 1)) / rows);
  const tone = { good: C.green, warn: C.amber, bad: C.red };
  kpis.forEach((k, i) => {
    const x = 0.5 + (i % cols) * (w + gap);
    const y = TOP + Math.floor(i / cols) * (h + gap);
    const accent = tone[k.tone] ?? C.line;
    s.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: C.panel }, line: { color: accent, width: 1 } });
    s.addText(k.label ?? "", { x: x + 0.25, y: y + 0.18, w: w - 0.5, h: 0.4, fontFace: FONT, fontSize: 12, color: C.muted, bold: true });
    s.addText(fmt(k.value, k.unit), { x: x + 0.25, y: y + 0.6, w: w - 0.5, h: 0.8, fontFace: FONT, fontSize: 30, bold: true, color: tone[k.tone] ?? C.text });
    if (k.sub) s.addText(k.sub, { x: x + 0.25, y: y + h - 0.65, w: w - 0.5, h: 0.5, fontFace: FONT, fontSize: 11, color: C.muted, valign: "top" });
  });
}

/** Horizontal bars drawn with shapes inside a panel. */
function barPanel(pptx, s, { x, y, w, h, heading, rows, unit, colorFor, band, labelW }) {
  s.addText(heading, { x, y, w, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: C.text });
  const top = y + 0.45;
  const rowH = Math.min(0.55, (h - 0.5) / Math.max(rows.length, 1));
  const barX = x + labelW;
  const valueW = 1.1;
  const barMaxW = w - labelW - valueW;
  const max = Math.max(...rows.map((r) => (isNum(r.value) ? r.value : 0)), band ? band.high * 1.15 : 0, 1);
  if (band) {
    const bx = barX + (band.low / max) * barMaxW;
    const bw = ((band.high - band.low) / max) * barMaxW;
    s.addShape(pptx.ShapeType.rect, { x: bx, y: top - 0.05, w: bw, h: rowH * rows.length + 0.05, fill: { color: C.band }, line: { color: C.band } });
    s.addText(`$${band.low}–$${band.high} target`, { x: bx - 0.3, y: top + rowH * rows.length, w: bw + 0.6, h: 0.25, fontFace: FONT, fontSize: 8, color: C.green, align: "center" });
  }
  rows.forEach((r, i) => {
    const ry = top + i * rowH;
    s.addText(r.label, { x, y: ry, w: labelW - 0.1, h: rowH, fontFace: FONT, fontSize: rows.length > 8 ? 9 : 10.5, color: C.text, valign: "middle", fit: "shrink" });
    if (isNum(r.value) && r.value > 0) {
      s.addShape(pptx.ShapeType.rect, {
        x: barX, y: ry + rowH * 0.2, w: Math.max((r.value / max) * barMaxW, 0.04), h: rowH * 0.6,
        fill: { color: colorFor(r) }, line: { color: colorFor(r) },
      });
    }
    s.addText(fmt(r.value, unit), { x: barX + barMaxW + 0.05, y: ry, w: valueW, h: rowH, fontFace: FONT, fontSize: 10.5, bold: true, color: C.text, valign: "middle" });
  });
}

function cplCacSlide(pptx, s, spec) {
  const rows = (spec.rows ?? []).slice(0, 12);
  const hasExtra = rows.some((r) => r.spend !== undefined || r.roas !== undefined || r.note);
  const panelH = BOTTOM - TOP - (hasExtra ? 0.1 : 0);
  const half = (W - 1.3) / 2;
  const minCac = Math.min(...rows.map((r) => (isNum(r.cac) ? r.cac : Infinity)));
  const label = (r) =>
    hasExtra ? `${r.label}\n${[isNum(r.spend) && fmt(r.spend, "$"), isNum(r.roas) && fmt(r.roas, "x"), r.note].filter(Boolean).join(" · ")}` : r.label;
  barPanel(pptx, s, {
    x: 0.5, y: TOP, w: half, h: panelH, heading: "CPL", unit: "$", labelW: 2.4,
    rows: rows.map((r) => ({ label: label(r), value: r.cpl })),
    colorFor: (r) => cplColor(r.value), band: config.cplBand,
  });
  barPanel(pptx, s, {
    x: 0.8 + half, y: TOP, w: half, h: panelH, heading: "CAC (cost per sale)", unit: "$", labelW: 2.4,
    rows: rows.map((r) => ({ label: r.label, value: r.cac })),
    colorFor: (r) => (r.value === minCac ? C.green : C.muted),
  });
}

function barsSlide(pptx, s, spec) {
  const rows = (spec.rows ?? []).slice(0, 12);
  const withPair = rows.some((r) => r.cpl !== undefined || r.cac !== undefined);
  barPanel(pptx, s, {
    x: 0.5, y: TOP, w: withPair ? W - 4 : W - 1, h: BOTTOM - TOP, heading: spec.metric ?? "", unit: spec.unit, labelW: 3,
    rows: rows.map((r) => ({ label: r.label, value: r.value })),
    colorFor: () => C.green,
  });
  if (withPair) {
    const rowH = Math.min(0.55, (BOTTOM - TOP - 0.5) / Math.max(rows.length, 1));
    s.addText("CPL  ·  CAC", { x: W - 3.3, y: TOP, w: 2.8, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: C.text });
    rows.forEach((r, i) =>
      s.addText(
        [
          { text: fmt(r.cpl, "$"), options: { color: cplColor(r.cpl), bold: true } },
          { text: "  ·  ", options: { color: C.muted } },
          { text: fmt(r.cac, "$"), options: { color: C.text, bold: true } },
        ],
        { x: W - 3.3, y: TOP + 0.45 + i * rowH, w: 2.8, h: rowH, fontFace: FONT, fontSize: 10.5, valign: "middle" },
      ),
    );
  }
}

function bulletsSlide(pptx, s, spec) {
  const bullets = (spec.bullets ?? []).slice(0, 10);
  const calloutH = spec.callout ? 1.0 : 0;
  s.addText(
    bullets.map((b) => ({ text: b, options: { bullet: { code: "25A0" }, paraSpaceAfter: 10 } })),
    { x: 0.7, y: TOP, w: W - 1.4, h: BOTTOM - TOP - calloutH - 0.2, fontFace: FONT, fontSize: bullets.length > 6 ? 15 : 18, color: C.text, valign: "top" },
  );
  if (spec.callout) {
    s.addShape(pptx.ShapeType.rect, { x: 0.7, y: BOTTOM - calloutH, w: W - 1.4, h: calloutH - 0.1, fill: { color: C.panel }, line: { color: C.green, width: 1 } });
    s.addText(spec.callout, { x: 0.95, y: BOTTOM - calloutH, w: W - 1.9, h: calloutH - 0.1, fontFace: FONT, fontSize: 15, bold: true, color: C.green, valign: "middle" });
  }
}

function twoColumnSlide(pptx, s, spec) {
  const half = (W - 1.3) / 2;
  [spec.left, spec.right].forEach((col, i) => {
    if (!col) return;
    const x = 0.5 + i * (half + 0.3);
    const accent = { good: C.green, warn: C.amber, bad: C.red }[col.tone] ?? C.line;
    s.addShape(pptx.ShapeType.rect, { x, y: TOP, w: half, h: BOTTOM - TOP - 0.1, fill: { color: C.panel }, line: { color: accent, width: 1 } });
    s.addText(col.heading ?? "", { x: x + 0.3, y: TOP + 0.2, w: half - 0.6, h: 0.45, fontFace: FONT, fontSize: 17, bold: true, color: accent === C.line ? C.text : accent });
    s.addText(
      (col.bullets ?? []).slice(0, 8).map((b) => ({ text: b, options: { bullet: true, paraSpaceAfter: 8 } })),
      { x: x + 0.3, y: TOP + 0.75, w: half - 0.6, h: BOTTOM - TOP - 1.1, fontFace: FONT, fontSize: 13, color: C.text, valign: "top" },
    );
  });
}

const RENDER = { title: titleSlide, kpis: kpiSlide, cpl_cac: cplCacSlide, bars: barsSlide, bullets: bulletsSlide, two_column: twoColumnSlide };
export const SLIDE_TYPES = Object.keys(RENDER);

/** Build the deck; returns a .pptx Buffer. */
export async function buildDeck(deck) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Mimi";
  pptx.company = config.brandName;
  pptx.title = deck.title;
  const slides = deck.slides?.length ? deck.slides : [{ type: "title" }];
  slides.slice(0, 30).forEach((spec, i) => {
    const s = base(pptx, deck, spec, i);
    (RENDER[spec.type] ?? bulletsSlide)(pptx, s, spec, deck);
    if (spec.notes) s.addNotes(spec.notes);
  });
  return pptx.write({ outputType: "nodebuffer" });
}

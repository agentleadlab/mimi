import { config } from "../config.js";
import { peekLink, visitLink } from "./links.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `
:root { --bg:#0f1115; --card:#181b22; --text:#f3f4f6; --muted:#9ca3af; --accent:#8b5cf6; }
* { box-sizing:border-box; }
body { margin:0; min-height:100vh; background:var(--bg); color:var(--text);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; display:flex; flex-direction:column; align-items:center; }
header { width:100%; max-width:960px; padding:20px 16px 8px; display:flex; justify-content:space-between; align-items:center; gap:12px; }
.brand { font-weight:700; letter-spacing:.02em; }
.timer { font-variant-numeric:tabular-nums; background:var(--card); border:1px solid #2a2f3a; border-radius:999px; padding:6px 14px; font-size:14px; color:var(--muted); }
.timer b { color:var(--text); }
main { width:100%; max-width:960px; padding:8px 16px 32px; }
h1 { font-size:20px; margin:8px 0 4px; }
.sub { color:var(--muted); margin:0 0 16px; font-size:14px; }
.video { position:relative; width:100%; padding-top:56.25%; background:#000; border-radius:12px; overflow:hidden; }
.video iframe { position:absolute; inset:0; width:100%; height:100%; border:0; }
/* Watermark: a repeating diagonal text tile over the video. Clicks pass through to the player. */
.wm { position:absolute; inset:0; overflow:hidden; pointer-events:none; z-index:2; }
.wm-layer { position:absolute; inset:-75%; transform:rotate(-24deg); background-repeat:repeat; }
.for { color:var(--muted); font-size:14px; }
.notice { text-align:center; margin:18vh auto 0; max-width:30rem; padding:0 16px; }
.notice h1 { font-size:24px; }
.notice p { color:var(--muted); line-height:1.5; }
.btn { display:inline-block; margin-top:12px; background:var(--accent); color:#fff; border:0; border-radius:10px;
  padding:14px 28px; font-size:16px; font-weight:600; cursor:pointer; }
.btn:hover { filter:brightness(1.1); }
footer { color:var(--muted); font-size:12px; padding:16px; margin-top:auto; }
`;

function shell(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body>${body}<footer>${esc(config.brandName)} · Confidential preview — please don't share</footer></body></html>`;
}

function expiredPage(reason) {
  const msg =
    reason === "missing"
      ? "This preview link isn't valid."
      : reason === "unopened"
        ? "This preview link has expired."
        : "Your preview time is up.";
  return shell(
    "Preview expired",
    `<div class="notice"><h1>${esc(msg)}</h1>
<p>Ad samples are shared as short, time-limited previews. Please contact your ${esc(config.brandName)} representative for a fresh link.</p></div>`,
  );
}

/** Watermark text: who the preview is for, and when they watched it. */
export function watermarkText(link) {
  const when = new Date(link.firstOpenedAt ?? Date.now()).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: config.timezone,
  });
  return [link.client, when, `${config.brandName} · Confidential`].filter(Boolean).join(" · ");
}

const xmlEsc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

/** An SVG tile: the watermark text on two staggered rows (the layer is rotated, not the text). */
function watermarkTile(text) {
  const w = Math.round(text.length * 8.4 + 90);
  const h = 96;
  const t = (x, y) =>
    `<text x="${x}" y="${y}" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="15" font-weight="700" fill="rgba(255,255,255,0.22)" stroke="rgba(0,0,0,0.2)" stroke-width="0.6">${xmlEsc(text)}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${t(w / 2, 30)}${t(0, 78)}${t(w, 78)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function watermark(link) {
  return `<div class="wm" aria-hidden="true"><div class="wm-layer" style="background-image:${esc(watermarkTile(watermarkText(link)))}"></div></div>`;
}

function viewerPage(link, endsAt) {
  const s = link.sample;
  const remaining = Math.max(0, Math.floor((endsAt - Date.now()) / 1000));
  const embed = `https://www.loom.com/embed/${encodeURIComponent(s.loomId)}?hide_owner=true&hide_share=true&hide_title=true&hideEmbedTopBar=true`;
  return shell(
    `${s.name} — ${config.brandName}`,
    `<header><div class="brand">${esc(config.brandName)}</div>
<div class="timer" id="timer">Preview ends in <b id="left">--:--</b></div></header>
<main id="main"><h1>${esc(s.name)}</h1>
<p class="sub">${esc([s.vertical, s.campaign].filter(Boolean).join(" · "))}${link.client ? ` · Prepared for ${esc(link.client)}` : ""}</p>
<div class="video"><iframe src="${esc(embed)}" referrerpolicy="no-referrer"></iframe>${watermark(link)}</div></main>
<script>
(function () {
  var left = ${remaining};
  var el = document.getElementById("left");
  function lock() {
    document.getElementById("main").innerHTML =
      '<div class="notice"><h1>Your preview time is up.</h1><p>Please contact your ${esc(config.brandName)} representative for a fresh link.</p></div>';
    document.getElementById("timer").style.display = "none";
  }
  function tick() {
    if (left <= 0) { clearInterval(t); lock(); return; }
    var m = Math.floor(left / 60), s = left % 60;
    el.textContent = m + ":" + (s < 10 ? "0" : "") + s;
    left--;
  }
  var t = setInterval(tick, 1000);
  tick();
})();
</script>`,
  );
}

function startPage(link) {
  const s = link.sample;
  return shell(
    `${s.name} — ${config.brandName}`,
    `<header><div class="brand">${esc(config.brandName)}</div></header>
<div class="notice"><h1>${esc(s.name)}</h1>
<p>${esc([s.vertical, s.campaign].filter(Boolean).join(" · "))}</p>
${link.client ? `<p class="for">Prepared for ${esc(link.client)}</p>` : ""}
<p>You'll have <b>${config.previewMinutes} minutes</b> to watch this ad sample once you start.</p>
<form method="post"><button class="btn" type="submit">▶ Watch sample</button></form></div>`,
  );
}

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};

/**
 * GET /p/<token>: start screen (unopened), player (in its window), or expired.
 * POST /p/<token>: the "Watch" button — starts the window, then shows the player.
 */
export function servePreview(req, res, token) {
  if (req.method === "POST") {
    visitLink(token);
    res.writeHead(303, { Location: `/p/${token}`, "Cache-Control": "no-store" });
    return res.end();
  }

  const { link, status } = peekLink(token);
  let html;
  if (status.state === "unopened") html = startPage(link);
  else if (status.state === "open") html = viewerPage(link, status.endsAt);
  else html = expiredPage(status.state === "missing" ? "missing" : status.reason);

  res.writeHead(status.state === "missing" || status.state === "expired" ? 410 : 200, HEADERS);
  res.end(html);
}

import { config } from "../config.js";
import { peekLink, visitLink } from "./links.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Agent Lead Lab look: near-black background, neon green accent with soft glows, Inter.
const STYLE = `
:root {
  --bg:#06070a; --panel:rgba(255,255,255,.035); --line:rgba(255,255,255,.08);
  --text:#f5f5f5; --muted:#8a8f9a; --soft:#c2c6cf;
  --green:#00ff94; --glow:rgba(0,255,148,.3); --tint:rgba(0,255,148,.08);
  --warn:#ffb020;
}
* { box-sizing:border-box; }
body { margin:0; min-height:100vh; display:flex; flex-direction:column; color:var(--text);
  font-family:"Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; -webkit-font-smoothing:antialiased;
  background:
    radial-gradient(900px 420px at 50% -120px, rgba(0,255,148,.10), transparent 70%),
    radial-gradient(600px 300px at 100% 100%, rgba(0,255,148,.04), transparent 70%),
    var(--bg); }
.wrap { width:100%; max-width:1040px; margin:0 auto; padding:0 20px; }
header .wrap { display:flex; align-items:center; justify-content:space-between; gap:12px; padding-top:18px; padding-bottom:18px; }
.brand { display:flex; align-items:center; gap:12px; color:var(--text); }
.brand img { width:44px; height:44px; border-radius:12px; border:1px solid var(--line); background:#000; }
.brand span { font-weight:800; letter-spacing:.06em; text-transform:uppercase; font-size:14px; }
.brand span b { color:var(--green); font-weight:800; }
.timer { display:flex; align-items:center; gap:8px; font-variant-numeric:tabular-nums; font-size:13px; color:var(--soft);
  background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:8px 14px; white-space:nowrap; }
.timer b { color:var(--text); font-weight:700; }
.dot { width:8px; height:8px; border-radius:50%; background:var(--green); box-shadow:0 0 0 4px var(--tint), 0 0 12px var(--glow);
  animation:pulse 1.6s ease-in-out infinite; }
.timer.low .dot { background:var(--warn); box-shadow:0 0 0 4px rgba(255,176,32,.12), 0 0 12px rgba(255,176,32,.35); }
.timer.low b { color:var(--warn); }
@keyframes pulse { 50% { opacity:.45; } }
main { flex:1; }
.eyebrow { display:inline-flex; align-items:center; gap:8px; color:var(--green); font-size:12px; font-weight:700;
  letter-spacing:.14em; text-transform:uppercase; }
.eyebrow::before { content:""; width:18px; height:2px; background:var(--green); box-shadow:0 0 8px var(--glow); }
h1 { font-size:clamp(24px,3.4vw,34px); line-height:1.15; font-weight:800; letter-spacing:-.02em; margin:10px 0 12px; }
.tags { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 6px; }
.tag { font-size:12px; font-weight:600; color:var(--soft); background:var(--panel); border:1px solid var(--line);
  border-radius:999px; padding:6px 12px; }
.tag.g { color:var(--green); background:var(--tint); border-color:rgba(0,255,148,.25); }
.for { color:var(--muted); font-size:14px; margin:12px 0 0; }
.for b { color:var(--text); font-weight:600; }

/* Start + expired screens */
.center { display:flex; align-items:center; justify-content:center; min-height:calc(100vh - 60px); padding:40px 20px; }
.card { width:100%; max-width:560px; text-align:center; background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));
  border:1px solid var(--line); border-radius:20px; padding:40px 28px; box-shadow:0 30px 80px rgba(0,0,0,.5); }
.card .tags { justify-content:center; }
.card .logo { width:84px; height:84px; border-radius:20px; border:1px solid var(--line); margin:0 auto 18px; display:block;
  box-shadow:0 0 0 6px var(--tint), 0 0 40px rgba(0,255,148,.15); }
.info { display:flex; justify-content:center; gap:8px 18px; flex-wrap:wrap; margin:22px 0 4px; color:var(--soft); font-size:14px; }
.info span { display:inline-flex; align-items:center; gap:8px; }
.info span::before { content:""; width:6px; height:6px; border-radius:50%; background:var(--green); box-shadow:0 0 8px var(--glow); }
.btn { display:inline-flex; align-items:center; gap:10px; margin-top:22px; border:0; cursor:pointer;
  background:var(--green); color:#04140c; font:inherit; font-size:16px; font-weight:800; letter-spacing:.01em;
  padding:16px 30px; border-radius:12px; box-shadow:0 0 0 1px rgba(0,255,148,.4), 0 10px 30px var(--glow);
  transition:transform .15s ease, box-shadow .15s ease; }
.btn:hover { transform:translateY(-1px); box-shadow:0 0 0 1px rgba(0,255,148,.6), 0 14px 40px rgba(0,255,148,.4); }
.fine { color:var(--muted); font-size:12px; margin:16px 0 0; }
.card p.msg { color:var(--soft); line-height:1.6; margin:0 auto; max-width:30rem; }

/* Player */
.player { padding-top:10px; padding-bottom:40px; }
/* 16:9, but never taller than the screen allows, so the whole video fits without scrolling. */
.frame { position:relative; width:min(100%, calc((100vh - 300px) * 16 / 9)); min-width:min(100%, 320px); aspect-ratio:16 / 9;
  margin:18px auto 0; background:#000; border-radius:18px; overflow:hidden;
  border:1px solid rgba(0,255,148,.18); box-shadow:0 0 0 6px rgba(0,255,148,.04), 0 30px 80px rgba(0,0,0,.55); }
.frame iframe { position:absolute; inset:0; width:100%; height:100%; border:0; }
.after { margin-top:16px; color:var(--muted); font-size:13px; text-align:center; }

footer { border-top:1px solid var(--line); color:var(--muted); font-size:12px; }
footer .wrap { display:flex; justify-content:space-between; gap:6px 12px; flex-wrap:wrap; padding-top:16px; padding-bottom:18px; }
@media (max-width:560px) {
  .card { padding:32px 20px; }
  .btn { width:100%; justify-content:center; }
  .timer { font-size:12px; padding:7px 12px; }
}
@media (max-width:420px) { .brand span { display:none; } }
`;

const LOGO = "/assets/logo.png";

function shell(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#06070a">
<link rel="icon" href="${LOGO}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body>${body}
<footer><div class="wrap"><span>© ${new Date().getFullYear()} ${esc(config.brandName)}</span><span>Confidential preview — please don't share</span></div></footer>
</body></html>`;
}

// "Agent Lead Lab" → "Agent Lead <b>Lab</b>" (last word in green).
function wordmark() {
  const words = esc(config.brandName).split(" ");
  const last = words.pop();
  return words.length ? `${words.join(" ")} <b>${last}</b>` : `<b>${last}</b>`;
}

function header(right = "") {
  return `<header><div class="wrap"><div class="brand"><img src="${LOGO}" alt=""><span>${wordmark()}</span></div>${right}</div></header>`;
}

function sampleTags(s) {
  const tags = [
    s.vertical && `<span class="tag g">${esc(s.vertical)}</span>`,
    s.campaign && s.campaign !== s.name && `<span class="tag">${esc(s.campaign)}</span>`,
  ].filter(Boolean);
  return tags.length ? `<div class="tags">${tags.join("")}</div>` : "";
}

const preparedFor = (link) => (link.client ? `<p class="for">Prepared for <b>${esc(link.client)}</b></p>` : "");

function card(inner) {
  return `<main><div class="wrap center"><div class="card">
<img class="logo" src="${LOGO}" alt="${esc(config.brandName)}">
<span class="eyebrow">Ad sample preview</span>
${inner}
</div></div></main>`;
}

function expiredPage(reason) {
  const title =
    reason === "missing" ? "This link isn't valid" : reason === "unopened" ? "This link has expired" : "Your preview time is up";
  return shell(
    `${title} — ${config.brandName}`,
    card(`<h1>${esc(title)}</h1>
<p class="msg">Our ad samples are shared as short, private previews. Reach out to your ${esc(config.brandName)} representative and they'll send you a fresh link.</p>`),
  );
}

function startPage(link) {
  const s = link.sample;
  return shell(
    `${s.name} — ${config.brandName}`,
    card(`<h1>${esc(s.name)}</h1>
${sampleTags(s)}
${preparedFor(link)}
<div class="info"><span>${config.previewMinutes}-minute private preview</span><span>Timer starts when you press Watch</span></div>
<form method="post"><button class="btn" type="submit">▶&nbsp; Watch sample</button></form>
<p class="fine">This link is just for you and expires after your preview.</p>`),
  );
}

function viewerPage(link, endsAt) {
  const s = link.sample;
  const remaining = Math.max(0, Math.floor((endsAt - Date.now()) / 1000));
  const embed = `https://www.loom.com/embed/${encodeURIComponent(s.loomId)}?hide_owner=true&hide_share=true&hide_title=true&hideEmbedTopBar=true`;
  return shell(
    `${s.name} — ${config.brandName}`,
    `${header(`<div class="timer" id="timer"><span class="dot"></span>Preview ends in <b id="left">--:--</b></div>`)}
<main id="main"><div class="wrap player">
<span class="eyebrow">Ad sample preview</span>
<h1>${esc(s.name)}</h1>
${sampleTags(s)}
${preparedFor(link)}
<div class="frame"><iframe src="${esc(embed)}" allow="fullscreen" allowfullscreen referrerpolicy="no-referrer"></iframe></div>
<p class="after">Want to see more samples or talk results? Reach out to your ${esc(config.brandName)} rep.</p>
</div></main>
<script>
(function () {
  var left = ${remaining};
  var el = document.getElementById("left");
  var timer = document.getElementById("timer");
  function lock() {
    document.getElementById("main").innerHTML =
      '<div class="wrap center"><div class="card"><img class="logo" src="${LOGO}" alt="">' +
      '<span class="eyebrow">Ad sample preview</span><h1>Your preview time is up</h1>' +
      '<p class="msg">Thanks for watching! Reach out to your ${esc(config.brandName)} representative and they&#39;ll send you a fresh link.</p></div></div>';
    timer.style.display = "none";
  }
  function tick() {
    if (left <= 0) { clearInterval(t); lock(); return; }
    var m = Math.floor(left / 60), s = left % 60;
    el.textContent = m + ":" + (s < 10 ? "0" : "") + s;
    if (left <= 120) timer.classList.add("low");
    left--;
  }
  var t = setInterval(tick, 1000);
  tick();
})();
</script>`,
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

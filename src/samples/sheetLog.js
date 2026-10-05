import { config } from "../config.js";

export const sheetLogConfigured = () => Boolean(config.samplesLogUrl && config.samplesLogSecret);

/**
 * Send a log event to the "Sample Log" tab (Apps Script web app in
 * scripts/sample-log.gs). Fire-and-forget: a logging hiccup never blocks
 * a teammate's link or a client's preview.
 */
export function logToSheet(event) {
  if (!sheetLogConfigured()) return;
  send(event).catch(async (err) => {
    // One retry after a short pause, then give up (it's still in /samples log).
    await new Promise((r) => setTimeout(r, 3000));
    send(event).catch((err2) => console.warn(`Sample Log sheet update failed (${event.event}):`, err2.message ?? err.message));
  });
}

async function send(event) {
  const res = await fetch(config.samplesLogUrl, {
    method: "POST",
    // text/plain keeps Apps Script happy (no CORS preflight-style issues).
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...event, secret: config.samplesLogSecret }),
    redirect: "follow",
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    const tail = config.samplesLogUrl.replace(/\/(exec|dev)$/, "").slice(-8);
    throw new Error(
      `unexpected response (${res.status}) from SAMPLES_LOG_URL ending "…${tail}/${config.samplesLogUrl.split("/").pop()}" — ` +
        'check it is the Web app URL (ends in /exec) of a deployment with access "Anyone"',
    );
  }
  if (!body.ok) throw new Error(body.error === "unauthorized" ? "secret doesn't match SAMPLES_LOG_SECRET" : body.error);
}

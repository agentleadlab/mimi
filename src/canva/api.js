import { getAccessToken } from "./auth.js";

const BASE = "https://api.canva.com/rest";

export class CanvaApiError extends Error {
  constructor(status, body) {
    super(body?.message ?? `Canva API error ${status}`);
    this.status = status;
    this.code = body?.code;
  }
}

/** Call the Canva Connect API. `body` may be a plain object (sent as JSON) or a Buffer. */
export async function canva(method, path, { query, body, headers = {} } = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const isBinary = Buffer.isBuffer(body);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      ...(body !== undefined && { "Content-Type": isBinary ? "application/octet-stream" : "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : isBinary ? body : JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new CanvaApiError(res.status, data);
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll an async Canva job (exports, autofills, resizes, uploads) until it finishes. */
export async function waitForJob(path, { timeoutMs = 120_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let delay = 1000;
  for (;;) {
    const { job } = await canva("GET", path);
    if (job.status === "success") return job;
    if (job.status === "failed") {
      throw new CanvaApiError(422, { code: job.error?.code, message: job.error?.message ?? "Canva job failed" });
    }
    if (Date.now() > deadline) throw new Error("Canva is taking too long on this one — check back in a minute.");
    await sleep(delay);
    delay = Math.min(delay * 1.5, 5000);
  }
}

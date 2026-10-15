import { config } from "../config.js";

export const metaConfigured = () => Boolean(config.metaAccessToken && config.metaAdAccountIds.length);

export class MetaApiError extends Error {
  constructor(status, error) {
    super(error?.message ?? `Meta API error ${status}`);
    this.status = status;
    this.code = error?.code;
  }
}

const base = () => `https://graph.facebook.com/${config.metaApiVersion}`;

/** GET a Graph API path (or a full paging URL). */
export async function graph(pathOrUrl, params = {}) {
  const url = new URL(pathOrUrl.startsWith("https://") ? pathOrUrl : `${base()}${pathOrUrl}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${config.metaAccessToken}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new MetaApiError(res.status, json.error);
  return json;
}

/** Follow `paging.next` until done (or `max` rows). */
export async function graphAll(path, params, { max = 1000 } = {}) {
  const rows = [];
  let page = await graph(path, params);
  for (;;) {
    rows.push(...(page.data ?? []));
    if (rows.length >= max || !page.paging?.next) break;
    page = await graph(page.paging.next);
  }
  return rows.slice(0, max);
}

const accountCache = new Map();

/** Name, currency and timezone of an ad account (cached). */
export async function accountInfo(accountId) {
  if (!accountCache.has(accountId)) {
    accountCache.set(
      accountId,
      graph(`/${accountId}`, { fields: "name,currency,timezone_name" }).catch((err) => {
        accountCache.delete(accountId);
        throw err;
      }),
    );
  }
  return accountCache.get(accountId);
}

export function describeMetaError(err) {
  if (err instanceof MetaApiError) {
    if (err.code === 190) return "Meta rejected the access token (expired or revoked). Generate a new system user token and update META_ACCESS_TOKEN in Railway.";
    if (err.code === 200 || err.code === 10 || err.status === 403) return `Meta says the token can't read that account (${err.message}). Make sure the system user has ads_read and is assigned to the ad account.`;
    if ([4, 17, 32, 613, 80000, 80004].includes(err.code)) return "Meta's rate limit was hit. Give it a few minutes and ask again.";
    return `Meta error${err.code ? ` ${err.code}` : ""}: ${err.message}`;
  }
  return err.message ?? String(err);
}

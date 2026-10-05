import crypto from "node:crypto";
import { config } from "../config.js";
import { getState, setState } from "../store.js";

const AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";
const TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";
const REVOKE_URL = "https://api.canva.com/rest/v1/oauth/revoke";

export const CORE_SCOPES = [
  "design:meta:read",
  "design:content:read",
  "design:content:write",
  "asset:read",
  "asset:write",
  "profile:read",
];

// Scope sets to try, most capable first. Canva rejects a sign-in that asks for
// any scope not enabled on the app, so on `invalid_scope` Mimi retries with the
// next set. Listing brand templates needs brandtemplate:meta:read; autofill
// from a known template only needs brandtemplate:content:read.
const SCOPE_SETS = process.env.CANVA_SCOPES
  ? [process.env.CANVA_SCOPES.split(/[\s,]+/).filter(Boolean)]
  : [
      [...CORE_SCOPES, "brandtemplate:meta:read", "brandtemplate:content:read"],
      [...CORE_SCOPES, "brandtemplate:content:read"],
      CORE_SCOPES,
    ];

export const SCOPES = SCOPE_SETS[0];

const STATE_KEY = "canva";
const LINK_TTL_MS = 15 * 60 * 1000;

export function redirectUri() {
  return `${config.publicUrl}/canva/callback`;
}

// In-progress sign-ins (state -> { verifier, expiresAt, connectedBy, attempt }),
// saved to disk so a restart mid-sign-in doesn't break the flow.
const PENDING_KEY = "canvaPending";

function putPending(state, entry) {
  const now = Date.now();
  const all = Object.fromEntries(
    Object.entries(getState(PENDING_KEY) ?? {}).filter(([, e]) => e.expiresAt > now),
  );
  all[state] = entry;
  setState(PENDING_KEY, all);
}

function takePending(state) {
  const all = getState(PENDING_KEY) ?? {};
  const entry = all[state];
  if (entry) {
    delete all[state];
    setState(PENDING_KEY, all);
  }
  return entry && entry.expiresAt > Date.now() ? entry : null;
}

function authorizeUrl(connectedBy, attempt) {
  const verifier = crypto.randomBytes(64).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(24).toString("base64url");
  putPending(state, { verifier, expiresAt: Date.now() + LINK_TTL_MS, connectedBy, attempt });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.canvaClientId,
    redirect_uri: redirectUri(),
    scope: SCOPE_SETS[attempt].join(" "),
    code_challenge: challenge,
    code_challenge_method: "s256",
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

/** A one-time Canva sign-in link (valid 15 minutes). */
export function createConnectLink(connectedBy) {
  return authorizeUrl(connectedBy, 0);
}

/**
 * After Canva rejects a sign-in with `invalid_scope`, get a link that asks for
 * fewer scopes, or null if there's nothing smaller to try.
 */
export function retryWithFewerScopes(state) {
  const entry = takePending(state);
  if (!entry) return null;
  const next = entry.attempt + 1;
  if (next >= SCOPE_SETS.length) return null;
  console.warn(`Canva rejected scopes [${SCOPE_SETS[entry.attempt].join(" ")}]; retrying with fewer.`);
  return authorizeUrl(entry.connectedBy, next);
}

export function hasScope(scope) {
  return Boolean(connection()?.scope?.split(" ").includes(scope));
}

async function tokenRequest(fields) {
  const basic = Buffer.from(`${config.canvaClientId}:${config.canvaClientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Canva token request failed (${res.status}): ${body.error_description ?? body.message ?? body.error ?? "unknown error"}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

function save(tokens, extra = {}) {
  const prev = getState(STATE_KEY) ?? {};
  setState(STATE_KEY, {
    ...prev,
    ...extra,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    // Refresh a minute early.
    expiresAt: Date.now() + (tokens.expires_in - 60) * 1000,
    scope: tokens.scope,
  });
}

/** Finish the OAuth flow from the redirect. */
export async function handleCallback({ code, state }) {
  const entry = takePending(state);
  if (!entry) {
    throw new Error("This sign-in link expired or was already used. Run /canva connect in Discord for a fresh one.");
  }
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: entry.verifier,
    redirect_uri: redirectUri(),
  });
  save(tokens, { connectedBy: entry.connectedBy, connectedAt: new Date().toISOString() });
  return entry;
}

export function connection() {
  const s = getState(STATE_KEY);
  return s?.refreshToken ? s : null;
}

export function isConnected() {
  return Boolean(connection());
}

// Canva refresh tokens are single-use, so only one refresh may run at a time.
let refreshing = null;

export async function getAccessToken() {
  const s = connection();
  if (!s) throw new CanvaNotConnectedError();
  if (s.accessToken && s.expiresAt > Date.now()) return s.accessToken;

  refreshing ??= tokenRequest({ grant_type: "refresh_token", refresh_token: s.refreshToken })
    .then((tokens) => {
      save(tokens);
      return tokens.access_token;
    })
    .catch((err) => {
      // A rejected refresh token means the connection is gone for good.
      if (err.status === 400 || err.status === 401) setState(STATE_KEY, undefined);
      throw err;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function disconnect() {
  const s = connection();
  setState(STATE_KEY, undefined);
  if (!s) return;
  const basic = Buffer.from(`${config.canvaClientId}:${config.canvaClientSecret}`).toString("base64");
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: s.refreshToken }),
  }).catch(() => {});
}

export class CanvaNotConnectedError extends Error {
  constructor() {
    super("Canva isn't connected. An admin can run /canva connect in Discord.");
  }
}

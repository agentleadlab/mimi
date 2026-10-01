import crypto from "node:crypto";
import { config } from "../config.js";
import { getState, setState } from "../store.js";

const AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";
const TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";
const REVOKE_URL = "https://api.canva.com/rest/v1/oauth/revoke";

// Must match the scopes enabled on the integration in Canva's Developer Portal.
export const SCOPES = [
  "design:meta:read",
  "design:content:read",
  "design:content:write",
  "asset:read",
  "asset:write",
  "brandtemplate:meta:read",
  "brandtemplate:content:read",
  "profile:read",
];

const STATE_KEY = "canva";
const LINK_TTL_MS = 15 * 60 * 1000;

export function redirectUri() {
  return `${config.publicUrl}/canva/callback`;
}

// state -> { verifier, expiresAt, connectedBy }
const pending = new Map();

/** A one-time Canva sign-in link (valid 15 minutes). */
export function createConnectLink(connectedBy) {
  const verifier = crypto.randomBytes(64).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(24).toString("base64url");
  pending.set(state, { verifier, expiresAt: Date.now() + LINK_TTL_MS, connectedBy });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.canvaClientId,
    redirect_uri: redirectUri(),
    scope: SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "s256",
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
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
  const entry = pending.get(state);
  pending.delete(state);
  if (!entry || entry.expiresAt < Date.now()) {
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

# Mimi samples API: "See an ad example"

For the client profile's **See an ad example** button. The profile server asks Mimi for one ad sample for a paying client, and Mimi returns the usual gated preview link: one viewer, 2 min 30 sec of viewing after Watch, expires in 7 days if unopened.

**Base URL:** `https://mimi-production-952b.up.railway.app`
**Auth:** every request sends `Authorization: Bearer <MIMI_API_TOKEN>`. Keep the key only in the hub at **Settings › Credentials › MIMI_API_TOKEN**; never in Discord, texts or chat.

## POST /api/samples

```http
POST /api/samples
Authorization: Bearer <MIMI_API_TOKEN>
Content-Type: application/json

{
  "lead_type": "vet plus",
  "client_name": "Jordan Ellis",
  "client_ref": "cl_8842",
  "request_id": "a1b2c3d4-…",
  "source": "profile"
}
```

| Field | Required | Notes |
|---|---|---|
| `lead_type` | yes | One of the lead type words (see `GET /api/lead-types`). Short forms work: `fex` = final expense, `mp standard` = mortgage protection standard, `vet plus 2` = vet plus 2.0. |
| `request_id` | yes | A unique id per click/request (a UUID). **The same `request_id` always returns the same link and never creates a second sample**, so retries are safe. |
| `client_name` | no | First and last name. Shown in the sample log. |
| `client_ref` | no | Your internal client id. **Never a phone number or email** (rejected with 400). |
| `source` | no | e.g. `profile`. Shown in the sample log. |

**Responses**

- `200`: `{ "ok": true, "url": "https://…/p/…", "expires_at": "2026-11-25T18:00:00.000Z", "watch_seconds": 150, "lead_type": "vet plus" }`
  - A repeat of the same `request_id` adds `"repeat": true` (same url, no new sample).
  - The test name (below) adds `"test": true`.
- `400`: `{ "ok": false, "error": "unknown_lead_type", "message": "…", "lead_types": ["vet plus", "vet widows", …] }`. Also `missing_request_id`, `missing_lead_type`, `client_ref_personal`, `bad_request`.
- `401`: `{ "ok": false, "error": "unauthorized" }`: missing or wrong key.
- `429`: `{ "ok": false, "error": "rate_limited", "retry_after": 12 }`, plus a `Retry-After` header (seconds). More than 30 new links in a minute.
- `503`: `api_disabled` (key not set on Mimi's side) or `library_unavailable`.

Vague words that match more than one sample (e.g. `vets`, `iul`, `mortgage protection`) return `400 unknown_lead_type` with the list. Map your order's lead type to one exact word.

## GET /api/lead-types

`{ "ok": true, "lead_types": ["trucker", "vet plus", "vet plus 2.0", "vet widows", …], "watch_seconds": 150 }`

The words come from the ad sample sheet's **Sample Name** column, minus the "Text-Verified" prefix, lowercased (e.g. "Text-Verified VET Widows" → `vet widows`). Add or rename a row in the sheet and the list updates within 5 minutes.

## Test name

Use **`Test Client`** as `client_name` to try the flow. It creates a real, working link flagged `"test": true`, so it never counts as a real client's free sample. (Change it with `API_TEST_CLIENT_NAME` in Railway.)

## Rules

- The once-per-client lock lives on the profile/hub side. Mimi's `request_id` dedupe is a safety net for retries and double-clicks.
- Links are always gated: one viewer, 2 min 30 sec after Watch, 7 days if unopened. No link works for everyone or forever.
- Only names and the lead type are sent. Never phone numbers or emails.
- Every link is logged in the Sample Log tab (requested by "Client profile (profile)"). Optionally, Mimi posts a note in #📸│ad-samples (`AD_SAMPLES_CHANNEL_ID`).

## Example

```bash
curl -sS https://mimi-production-952b.up.railway.app/api/samples \
  -H "Authorization: Bearer $MIMI_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"lead_type":"vet plus","client_name":"Test Client","request_id":"test-001","source":"profile"}'
```

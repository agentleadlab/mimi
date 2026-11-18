# Mimi ⇄ Rook: ad sample protocol

How Rook and Mimi talk about ad samples. Give the "For Rook" section to whoever configures Rook (paste it into Rook's instructions).

There are two ways to get a sample from Mimi:
- **Discord (this page):** Rook tags Mimi in a channel or thread, and they go back and forth until the lead type is clear.
- **Web API** (`POST /api/samples`, full spec in [`samples-api.md`](samples-api.md)): for servers and apps, like the client profile's "See an ad example" button. Use it when the lead type is already known exactly. It answers instantly with one link, and the same `request_id` never makes a second sample.

## For Rook

**Asking Mimi for ad samples**
- Tag `@Mimi` in any channel or thread, with the agent/client's name and what they want to see, in their own words:
  `@Mimi Ad sample for Aiden Adair: "Can you send me a sample for Vets?"`
- You can ask for several lead types at once: `@Mimi Aiden Adair wants VET PLUS and Mortgage Protection Standard`.
- To see what exists: `@Mimi what ad samples do we have?`
- Never include phone numbers.

**Mimi's replies** are plain text, tag you, and start with one of these labels:

1. `✅ AD SAMPLES for <client> (REF AS-12)`: one line per sample, `Sample name: link`. Send these links to the client.
2. `❓ NEED CLARIFICATION for <client> (REF AS-13)`: includes `Please ask the client: "<question>"` and `Options: A | B`.
   → Ask the client that exact question. When they answer, reply to Mimi in the same thread/channel, tag `@Mimi`, and include the REF:
   `@Mimi REF AS-13: Aiden picked VET Widows` (or just relay their words: `@Mimi REF AS-13 Aiden: "the widows one"`).
   Mimi then sends `✅ AD SAMPLES … (REF AS-13)`.
3. `⚠️ NOT IN LIBRARY for <client>: "<what they asked>" (closest we have: …)`: tell the team, or ask the client if the closest one works, then ask Mimi for that one.
4. `📚 AD SAMPLE LIBRARY`: every sample, grouped by lead type.

**Links:** each plays for 2 min 30 sec once the viewer taps Watch. Unopened links expire in 7 days. Ask Mimi for a fresh one anytime.

**Using the API instead of Discord (if Rook's own server can make web requests):**
- Call `POST https://mimi-production-952b.up.railway.app/api/samples` with the header `Authorization: Bearer <MIMI_API_TOKEN>` and JSON: `lead_type` (an exact word from `GET /api/lead-types`, e.g. `vet plus`), `client_name`, `client_ref` (an internal id, never a phone or email), `request_id` (unique per request) and `source` (e.g. `rook`).
- `200` gives `url`, `expires_at` and `watch_seconds`. Send that url to the client.
- `400 unknown_lead_type` means the word was vague or unknown. The reply lists the valid words. Ask the client which one they want (or ask Mimi in Discord, which handles vague requests), then call again with the exact word and a **new** `request_id`.
- Reusing a `request_id` returns the same link. Use that for retries, not for a second sample.
- The key lives only in the hub at Settings › Credentials › MIMI_API_TOKEN. Never put it in Discord, a text or chat.
- `Test Client` as `client_name` makes a test link that doesn't count as a real sample.

**In client SMS channels** (#rook-sms, channel 1545452742527426601 and their threads): Mimi doesn't reply to you with the labels above. She posts `//` drafts for the team to send to the client, so there's nothing for you to relay. Don't text anything that starts with `//`.

## How Mimi behaves (for the team)

- She answers Rook's ad sample messages everywhere: tagged, or untagged when they're about ads, include a REF, or there's an open question in that channel. Her replies go in a thread on Rook's message (or in the thread Rook wrote in).
- Questions stay open for 3 days. The answer is matched by REF, or by the client's name in that channel.
- **Client SMS channels:** #rook-sms and channel `1545452742527426601` (the channels themselves and every thread in them). Rook texts the client anything posted there without a leading `//`, so nothing Mimi posts goes to the client automatically:
  - Her question to the client and her sample links are posted as `//` drafts. A teammate reacts 📤 to send one exactly as written (it's posted once, without `//`, and the draft is marked "Sent by …"), or copies, edits and sends it themselves.
  - Anything internal (e.g. a lead type that isn't in the library) is a `//` note.
  - When the client answers her question, she drafts the matching link.
  - Only people can send drafts; reactions from bots don't count. Drafts stay sendable for 7 days.
  - More channels can be added with `SMS_RELAY_CHANNEL_IDS` or `SMS_RELAY_CHANNEL_NAMES` in Railway.
- Loop guard: at most 6 replies to bots per channel every 10 minutes.
- What's in the library comes from the ad sample sheet, so keep sample names clear (e.g. "Text-Verified VET PLUS", "Text-Verified VET Widows").
- **API and Discord share the same library and links.** The API's lead type words are the sheet's sample names minus "Text-Verified", lowercased (`vet plus`, `vet widows`, `mortgage protection standard`…). Renaming or adding a sample in the sheet updates both within 5 minutes. Every link, from Discord or the API, is logged in the Sample Log tab.

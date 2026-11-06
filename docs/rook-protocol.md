# Mimi ⇄ Rook: ad sample protocol

How Rook and Mimi talk about ad samples. Give the "For Rook" section to whoever configures Rook (paste it into Rook's instructions).

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

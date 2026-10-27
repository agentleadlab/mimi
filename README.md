# Mimi 🎨

Mimi is the Creative Director AI bot for Agent Lead Lab's Discord. She handles concepts, copy, design feedback, content calendars, and (with Canva connected) design production. She runs on Claude. Her personality and rules are in [`prompts/mimi.md`](prompts/mimi.md), so edit that file to change how she behaves.

## How to talk to her

- **@mention her**, **say her name** ("hey Mimi, …"), or **reply** to one of her messages, in any channel she can see.
- **DM her** directly.
- In any channel listed in `MIMI_CHANNEL_IDS`, she answers every message without a mention.
- **Attach images** (designs, references, mood boards) and she'll look at them.
- Replies come as branded cards (Agent Lead Lab green): a title, a short intro, and bold sections, with her avatar on top and the logo plus who asked in the footer. `src/ui.js` builds the cards and keeps them within Discord's limits.
- She reads the last ~20 messages in the channel, so follow-ups work naturally.
- **Live progress card:** if an answer takes more than a few seconds (reports, Canva runs, images, Meta pulls), Mimi posts an animated card right away and updates it at each real step (e.g. Reading 8 screenshots → Designing the deck → Putting it together). It then turns into her answer. Quick answers skip it. The animated strips are in `assets/progress/` (regenerate with `python3 scripts/make-progress-assets.py`, which needs Pillow).

Slash commands:

| Command | What it does |
|---|---|
| `/mimi brief [image]` | Ask for anything creative |
| `/ideas topic [audience] [platform]` | 3–5 campaign concepts with rationale |
| `/copy brief [platform] [variations]` | Copy with variations to test |
| `/review design [context]` | Structured feedback on an uploaded design |
| `/plan timeframe [focus] [channels]` | Content calendar |
| `/image prompt [size] [options] [image]` | Generate images with Gemini (needs `GEMINI_API_KEY`) |
| `/refresh hook [vertical] [notes] [versions]` | Refresh a tired hook: same idea, new opening, detail and emotion |
| `/cpl [name] [level] [range]` | Live Meta numbers: spend, leads, CPL (needs `META_ACCESS_TOKEN`) |
| `/sample lead_type [sample] [client]` | Time-limited ad sample links to send a client (private reply) |
| `/samples list \| refresh \| log` | Browse the library, re-read the sheet, see who opened what |
| `/samples add name lead_type loom [tags] [campaign]` | Add a sample to the sheet (Manage Server only; needs the sheet script) |

## Setup

### 1. Create the Discord bot

1. Go to <https://discord.com/developers/applications> → **New Application**, name it **Mimi**.
2. **General Information**: copy the **Application ID**. That's `DISCORD_CLIENT_ID`.
3. **Bot** tab:
   - **Reset Token**, then copy it. That's `DISCORD_TOKEN`.
   - Under **Privileged Gateway Intents**, turn on **Message Content Intent**. Without it, she can't read messages.
   - Optional: upload an avatar.
4. **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot permissions: View Channels, Send Messages, Send Messages in Threads, Read Message History, Attach Files, Embed Links
   - Open the generated URL and invite Mimi to your server.
5. Optional: turn on Developer Mode (User Settings → Advanced), then right-click your server → **Copy Server ID**. That's `DISCORD_GUILD_ID`, and with it set, slash commands show up instantly.

### 2. Get an Anthropic API key

Create one at <https://console.anthropic.com> → API Keys. That's `ANTHROPIC_API_KEY`.

### 3. Install and run

Requires Node.js 20+.

```bash
npm install
cp .env.example .env         # then fill in the values
npm run check                # optional: test the Claude connection without Discord
npm start
```

When it's working, you'll see `Mimi is online as Mimi#1234`.

## Configuration

All settings live in `.env` (see `.env.example`):

| Variable | Default | Notes |
|---|---|---|
| `DISCORD_TOKEN` | (required) | Bot token |
| `DISCORD_CLIENT_ID` | (required for `deploy-commands`) | Application ID |
| `ANTHROPIC_API_KEY` | (required) | Claude API key |
| `DISCORD_GUILD_ID` | (unset) | Register commands to one server instantly |
| `MIMI_CHANNEL_IDS` | (unset) | Comma-separated channels where she answers every message |
| `MIMI_REPLY_TO_NAME` | `true` | Reply when someone says "Mimi". Set to `false` to require an @mention |
| `MIMI_STATUS` | `💅 Always raising the standard` | Custom status under her name. Set it empty to hide it |
| `SAMPLES_SHEET_URL` | (unset) | Google Sheet with the ad sample library (see below) |
| `PREVIEW_SECONDS` / `PREVIEW_LINK_DAYS` | `150` / `7` | Client viewing window, and how long unopened links last |
| `SAMPLES_LOG_URL` / `SAMPLES_LOG_SECRET` | (unset) | Write the sample log to a tab in the sheet (see below) |
| `BRAND_NAME` | `Agent Lead Lab` | Name on the client-facing preview page |
| `MIMI_MODEL` | `claude-opus-5` | Claude model |
| `MIMI_EFFORT` | `medium` | `low` / `medium` / `high` / `xhigh` / `max`. Higher means deeper thinking, slower and pricier |
| `MIMI_MAX_TOKENS` | `16000` | Max reply length |
| `MIMI_HISTORY_LIMIT` | `20` | How many earlier channel messages she reads |
| `GEMINI_API_KEY` | (unset) | Turns on image generation (see below) |
| `GEMINI_IMAGE_MODEL` | `gemini-nano-banana-2.1` | Gemini image model |
| `META_ACCESS_TOKEN` / `META_AD_ACCOUNT_IDS` | (unset) | Read-only Meta Ads reporting (see below) |
| `CLIENT_CATEGORY_IDS` | (unset) | Channel categories holding client channels: Mimi only shares ad samples there (see below) |
| `CLIENT_GUILD_IDS` | (unset) | Whole servers that are client-only. Don't use this for a server that also has team channels |
| `TEAM_MENTIONS` | (unset) | Teammates Mimi can tag, `Name=UserID` pairs (e.g. `Jen=123,K2=456,Tre=789`). Others are looked up by name |
| `MARKETING_CHANNEL_ID` | (unset) | Where she posts announcements. Default: a channel named like "marketing" |
| `META_EXCLUDE_NAMES` | `MARTIN` | Names left out of Meta numbers (comma-separated) |
| `CPL_BAND_LOW` / `CPL_BAND_HIGH` / `CPL_DEAD` | `25` / `35` / `45` | Target CPL band used to label results |
| `META_LEAD_ACTION` | auto | Which Meta action counts as a lead (e.g. `lead`, `offsite_conversion.fb_pixel_lead`) |
| `CANVA_CLIENT_ID` / `CANVA_CLIENT_SECRET` | (unset) | Canva integration credentials (see below) |
| `PUBLIC_URL` | Railway's generated domain | Public https URL of the deployment, for Canva sign-in |
| `MIMI_DATA_DIR` | `/data` if it exists, else `./data` | Where the Canva login is stored |

If Claude's safety filters decline a request, it's automatically retried on Anthropic's recommended fallback model (server-side fallbacks).

### Weekly marketing report deck

Post the data screenshots (command center, Ads Manager) in one or more messages, then ask: *"Mimi, build this week's marketing report."* She reads every screenshot, builds a PowerPoint in the house style (dark #0B0F0E background, #22C55E accent, bar charts drawn as shapes, CPL and CAC on every data slide, data date on every slide), and attaches it. Her reply is the Discord-paste summary plus a **"Numbers I read"** list to check her transcription. Reply with corrections and she rebuilds it. To share it: *"Mimi, post this week's brief in marketing and tag Jen, K2 and Tre: <link>"*. She posts it in the marketing channel with real @-tags (people get notified) and a card linking to the deck. Screenshots from the last 2 hours (up to 20) are read together.

### Account knowledge base

[`knowledge/`](knowledge/) is loaded ahead of everything else and outranks the brand kits and playbooks:
- [`00-operating-rules.md`](knowledge/00-operating-rules.md): how Mimi weights the knowledge base, the hard rules (rank by CAC with CPL alongside, $25–$35 CPL band, no cuts on under 30 days, no VA/government affiliation, banned phrases) and response style.
- [`agent-lead-lab-kb.md`](knowledge/agent-lead-lab-kb.md): Kath's Ads & Creative Knowledge Base (dated performance snapshot, creative learnings, corrections log, house style).

To refresh it, replace `agent-lead-lab-kb.md` with the new version (keep the "Last updated" date at the top) and redeploy. Mimi always quotes numbers with their date.

### Brand kits

Every Markdown file in [`brands/`](brands/) is loaded into Mimi's memory at startup, so she knows those brands and on-camera talent by heart: voice, script formula, look, edit style and approved claims. [`brands/tre-tarpley.md`](brands/tre-tarpley.md) covers Tre's talking-head ads. [`brands/county-template.md`](brands/county-template.md) is the MTG county ad recipe: per state, 4 counties × 3 versions with AI-generated backgrounds, titled "NN - County - ST" and filed into a "MTG - <State>" Canva folder. To add a brand or template recipe, add a file and redeploy.

### Playbooks

Every Markdown file in [`playbooks/`](playbooks/) is loaded too: the team's copy frameworks for specific verticals. [`playbooks/trucker-vertical.md`](playbooks/trucker-vertical.md) holds the 21 trucker/CDL angles, copy rules, 4x3 stack structure and reference hooks and post-hooks. Ask for *"trucker angle 13, full set"* and Mimi writes the emotional doorway, two stacks of 4 hooks, both post-hooks and ad headlines. [`playbooks/ad-refresh.md`](playbooks/ad-refresh.md) is the method for refreshing tired hooks (`/refresh`, or paste a hook and ask). To add a vertical, add a file and redeploy.

### Meta Ads numbers

Ask in chat (*"Mimi, what's the CPL on the trucker campaign today, 7 days and 30 days?"*, *"which ad in MP Texas is cheapest this week?"*) or use `/cpl`. Mimi pulls live, **read-only** numbers from the Marketing API (spend, leads, CPL, CTR, CPM, frequency) at campaign, ad set or ad level, and for specific ads shows the primary text, headline, preview link and image. She can't change anything in Ads Manager.

Setup (once):
1. In **Meta Business Settings → Users → System users**, add a system user (Employee role is enough).
2. **Assign assets → Ad accounts**: pick your ad account(s) and grant **View performance**.
3. **Generate new token** for that system user with your Meta app, ticking **ads_read** (expiry "Never" if offered). Copy it into `META_ACCESS_TOKEN`.
4. Put the ad account ID(s) in `META_AD_ACCOUNT_IDS` (comma-separated, with or without `act_`; it's in Ads Manager's URL as `act=`).

Leads are counted from Meta's `lead` action by default (falling back to on-Facebook or pixel leads). Set `META_LEAD_ACTION` if your account counts leads differently. Dates follow the ad account's timezone.

### Image generation (Gemini)

Claude stays Mimi's brain; Gemini draws. With `GEMINI_API_KEY` set (create one at <https://aistudio.google.com/apikey>), Mimi gets a `generate_image` tool. Ask in chat (*"Mimi, make a 4:5 ad image of a veteran with his family on the porch at sunset, space for a headline"*) or use `/image`. She writes the art-direction prompt, picks the size for the placement, and the image shows up in her card (up to 4 per reply). Reply with a tweak (*"warmer light, no dog"*) and she edits her last image. Attach an image to use it as a reference.

Mimi calls Gemini's Interactions API and falls back to the older `generateContent` API (`GEMINI_LEGACY_IMAGE_MODEL`, default `gemini-2.5-flash-image`) if that isn't available for your key. Gemini images carry Google's invisible SynthID watermark. Image generation is billed to the Google account behind the key.

### Canva

Without Canva, Mimi still does the creative direction and hands over full specs (layout, copy, sizes, template field mapping) for someone to build. With Canva connected, she can also:

- **Bulk create** on-brand designs from a brand template plus data (autofill), including images people attach in Discord
- **Create** blank designs at any size, optionally starting from an attached image
- **Resize** a design into other platform formats
- **Export** designs as PNG, JPG, PDF, PPTX, GIF or MP4
- **Search** the account's designs, and **file** designs into project folders (e.g. one folder per state)

Brand templates and autofill need Canva Pro, Teams or Enterprise. Resize needs Pro or higher. The Canva API can't lay out text on a blank design, so production that has to be on brand goes through brand templates.

Setup:

1. **Give Mimi a public URL.** On Railway, open the service → **Settings → Networking → Generate Domain**. Mimi picks it up automatically. To use a custom domain instead, set `PUBLIC_URL`.
2. **Add a volume** so the Canva login survives redeploys. Right-click the service → **Attach Volume**, with mount path `/data`.
3. **Create a Canva integration** at <https://www.canva.com/developers/integrations>. Your Canva account needs multi-factor authentication turned on first.
   - **Configuration:** copy the Client ID into `CANVA_CLIENT_ID`. Generate a secret and copy it into `CANVA_CLIENT_SECRET`.
   - **Scopes:** enable design (meta read, content read, content write), asset (read, write), brand template (meta read, content read), folder (read, write) and profile (read).
   - **Authentication:** add the authentication URL `<PUBLIC_URL>/canva/callback`.
   If Canva won't save a permission, Mimi still connects: when Canva rejects the sign-in with `invalid_scope`, she retries without brand-template listing, then without brand templates at all. Set `CANVA_SCOPES` (space-separated) to choose the scopes yourself.
4. Redeploy. Then, in Discord, someone with **Manage Server** runs `/canva connect`, opens the link, and signs in to the Canva account Mimi should use.
5. Run `/canva status` to confirm the connection and see which features the account's plan allows.

Then just ask, e.g. *"Mimi, bulk create listing posts from the Just Listed template for these 5 addresses"*, or *"resize this design for Stories and LinkedIn"*.

### Ad sample library

Mimi hands out ad samples (recorded in Loom) as **time-limited preview links**, so clients can watch them without ever getting the Loom link itself.

- The library lives in a Google Sheet with the columns **Sample Name, Vertical, Campaign/Context, Date Added, Loom Link, Tags**. Share it as *Anyone with the link can view*, and put its link in `SAMPLES_SHEET_URL`. The sheet contains the Loom links, so don't share the sheet link itself. Mimi re-reads the sheet every 5 minutes, or right away with `/samples refresh`.
- A teammate asks in chat (*"Mimi, I need a vet ad sample for John"*) or uses `/sample`, and gets one link per matching sample to send to the client.
- The client sees a branded **Watch sample** page. Their 2 min 30 sec start when they press Watch, so link previews in texts and emails don't use up the time. When time's up the page locks and asks them to contact their rep. Links nobody opens expire after 7 days.
- `/samples add` (Manage Server only) checks the Loom link, rejects duplicate names and videos, and adds the row to the library tab through the same Apps Script. After updating `scripts/sample-log.gs`, redeploy it with **Deploy → Manage deployments → ✏️ → Version: New version** so the URL stays the same.
- `/samples log` shows who requested each link, for which client, and whether it was opened.
- **Optional "Sample Log" tab:** every link and every Watch is also written to a tab in the sheet. Paste [`scripts/sample-log.gs`](scripts/sample-log.gs) into the sheet (**Extensions → Apps Script**), set its `SECRET`, then deploy it as a web app (**Execute as: Me, Who has access: Anyone**). Put the web app URL and the secret in `SAMPLES_LOG_URL` and `SAMPLES_LOG_SECRET`. The log stores a short ID per link, never a working link.
- Loom videos must be viewable by anyone with the link (Loom's default) for the embedded player to work.

**Client channels.** In channels inside the categories listed in `CLIENT_CATEGORY_IDS` (or in whole servers listed in `CLIENT_GUILD_IDS`), Mimi talks to agents directly and runs in a locked-down mode. Every other channel, like #ask-mimi, works normally:
- The lead type comes from the channel name (`#client-name-lead-type`, e.g. `#mia-hilligoss-trucker` = Truckers; short forms like `vets`, `mp`, `fe`, `iul` work). She only shares samples of that lead type.
- If the name doesn't show a lead type, she asks the agent which lead type the client purchased before sharing.
- Each channel gets samples **once**. She checks her record and the channel history, and points to the earlier message instead of re-sharing.
- Only the ad-sample tools and `/sample` exist there. No internal knowledge, numbers, Canva, Meta or posting tools, and other slash commands aren't registered. She doesn't discuss internal data and hands anything else to the team.

This stops casual forwarding, but it isn't DRM: a determined viewer could still find the Loom video address in the page code during their window.

## Hosting

`npm start` runs the bot as a long-lived process, and Mimi is only online while it's running. Slash commands register themselves every time she starts.

### Railway (recommended)

`railway.json` sets the start command and restarts her automatically if she crashes.

1. Sign in at <https://railway.com> with GitHub.
2. **New Project → Deploy from GitHub repo → `agentleadlab/mimi`**. If the repo isn't listed, click **Configure GitHub App** and grant Railway access to it.
3. Open the service → **Settings → Source** and set the branch Mimi lives on.
4. **Variables** tab → add `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` and `ANTHROPIC_API_KEY`, plus any optional ones from `.env.example`.
5. Railway redeploys. Under **Deployments → View logs**, look for `Mimi is online as …`.

No domain or port is needed, because Mimi connects out to Discord.

### Other options

- **A VPS** (DigitalOcean, Hetzner, Lightsail): `pm2 start src/index.js --name mimi`, or a systemd service.
- **Render / Fly.io**: deploy as a background worker with start command `npm start`.

## Development

```bash
npm test
```

Layout:

- `src/index.js`: Discord client, message and slash-command handling
- `src/mimi.js`: Claude API call and error messages
- `src/history.js`: turns channel history into a Claude conversation
- `src/ui.js`: branded cards, within Discord's embed limits
- `src/gemini.js`, `src/images/tools.js`: Gemini image generation
- `src/commands.js`: slash command definitions
- `prompts/mimi.md`: Mimi's system prompt

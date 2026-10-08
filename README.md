# Mimi 🎨

Mimi is the Creative Director AI bot for Agent Lead Lab's Discord. She handles concepts, copy, design feedback, content calendars, and (with Canva connected) design production. She runs on Claude. Her personality and rules are in [`prompts/mimi.md`](prompts/mimi.md), so edit that file to change how she behaves.

## How to talk to her

- **@mention her**, **say her name** ("hey Mimi, …"), or **reply** to one of her messages, in any channel she can see.
- **DM her** directly.
- In any channel listed in `MIMI_CHANNEL_IDS`, she answers every message without a mention.
- **Attach images** (designs, references, mood boards) and she'll look at them.
- Replies come as branded cards (Agent Lead Lab green): a title, a short intro, and bold sections, with her avatar on top and the logo plus who asked in the footer. `src/ui.js` builds the cards and keeps them within Discord's limits.
- She reads the last ~20 messages in the channel, so follow-ups work naturally.

Slash commands:

| Command | What it does |
|---|---|
| `/mimi brief [image]` | Ask for anything creative |
| `/ideas topic [audience] [platform]` | 3–5 campaign concepts with rationale |
| `/copy brief [platform] [variations]` | Copy with variations to test |
| `/review design [context]` | Structured feedback on an uploaded design |
| `/plan timeframe [focus] [channels]` | Content calendar |
| `/image prompt [size] [options] [image]` | Generate images with Gemini (needs `GEMINI_API_KEY`) |
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
| `PREVIEW_MINUTES` / `PREVIEW_LINK_DAYS` | `15` / `7` | Client viewing window, and how long unopened links last |
| `SAMPLES_LOG_URL` / `SAMPLES_LOG_SECRET` | (unset) | Write the sample log to a tab in the sheet (see below) |
| `BRAND_NAME` | `Agent Lead Lab` | Name on the client-facing preview page |
| `MIMI_MODEL` | `claude-opus-5` | Claude model |
| `MIMI_EFFORT` | `medium` | `low` / `medium` / `high` / `xhigh` / `max`. Higher means deeper thinking, slower and pricier |
| `MIMI_MAX_TOKENS` | `16000` | Max reply length |
| `MIMI_HISTORY_LIMIT` | `20` | How many earlier channel messages she reads |
| `GEMINI_API_KEY` | (unset) | Turns on image generation (see below) |
| `GEMINI_IMAGE_MODEL` | `gemini-nano-banana-2.1` | Gemini image model |
| `CANVA_CLIENT_ID` / `CANVA_CLIENT_SECRET` | (unset) | Canva integration credentials (see below) |
| `PUBLIC_URL` | Railway's generated domain | Public https URL of the deployment, for Canva sign-in |
| `MIMI_DATA_DIR` | `/data` if it exists, else `./data` | Where the Canva login is stored |

If Claude's safety filters decline a request, it's automatically retried on Anthropic's recommended fallback model (server-side fallbacks).

### Brand kits

Every Markdown file in [`brands/`](brands/) is loaded into Mimi's memory at startup, so she knows those brands and on-camera talent by heart: voice, script formula, look, edit style and approved claims. [`brands/tre-tarpley.md`](brands/tre-tarpley.md) covers Tre's talking-head ads. To add a brand, add a file and redeploy.

### Image generation (Gemini)

Claude stays Mimi's brain; Gemini draws. With `GEMINI_API_KEY` set (create one at <https://aistudio.google.com/apikey>), Mimi gets a `generate_image` tool. Ask in chat (*"Mimi, make a 4:5 ad image of a veteran with his family on the porch at sunset, space for a headline"*) or use `/image`. She writes the art-direction prompt, picks the size for the placement, and the image shows up in her card (up to 4 per reply). Reply with a tweak (*"warmer light, no dog"*) and she edits her last image. Attach an image to use it as a reference.

Mimi calls Gemini's Interactions API and falls back to the older `generateContent` API (`GEMINI_LEGACY_IMAGE_MODEL`, default `gemini-2.5-flash-image`) if that isn't available for your key. Gemini images carry Google's invisible SynthID watermark. Image generation is billed to the Google account behind the key.

### Canva

Without Canva, Mimi still does the creative direction and hands over full specs (layout, copy, sizes, template field mapping) for someone to build. With Canva connected, she can also:

- **Bulk create** on-brand designs from a brand template plus data (autofill), including images people attach in Discord
- **Create** blank designs at any size, optionally starting from an attached image
- **Resize** a design into other platform formats
- **Export** designs as PNG, JPG, PDF, PPTX, GIF or MP4
- **Search** the account's designs

Brand templates and autofill need Canva Pro, Teams or Enterprise. Resize needs Pro or higher. The Canva API can't lay out text on a blank design, so production that has to be on brand goes through brand templates.

Setup:

1. **Give Mimi a public URL.** On Railway, open the service → **Settings → Networking → Generate Domain**. Mimi picks it up automatically. To use a custom domain instead, set `PUBLIC_URL`.
2. **Add a volume** so the Canva login survives redeploys. Right-click the service → **Attach Volume**, with mount path `/data`.
3. **Create a Canva integration** at <https://www.canva.com/developers/integrations>. Your Canva account needs multi-factor authentication turned on first.
   - **Configuration:** copy the Client ID into `CANVA_CLIENT_ID`. Generate a secret and copy it into `CANVA_CLIENT_SECRET`.
   - **Scopes:** enable design (meta read, content read, content write), asset (read, write), brand template (meta read, content read) and profile (read).
   - **Authentication:** add the authentication URL `<PUBLIC_URL>/canva/callback`.
   If Canva won't save a permission, Mimi still connects: when Canva rejects the sign-in with `invalid_scope`, she retries without brand-template listing, then without brand templates at all. Set `CANVA_SCOPES` (space-separated) to choose the scopes yourself.
4. Redeploy. Then, in Discord, someone with **Manage Server** runs `/canva connect`, opens the link, and signs in to the Canva account Mimi should use.
5. Run `/canva status` to confirm the connection and see which features the account's plan allows.

Then just ask, e.g. *"Mimi, bulk create listing posts from the Just Listed template for these 5 addresses"*, or *"resize this design for Stories and LinkedIn"*.

### Ad sample library

Mimi hands out ad samples (recorded in Loom) as **time-limited preview links**, so clients can watch them without ever getting the Loom link itself.

- The library lives in a Google Sheet with the columns **Sample Name, Vertical, Campaign/Context, Date Added, Loom Link, Tags**. Share it as *Anyone with the link can view*, and put its link in `SAMPLES_SHEET_URL`. The sheet contains the Loom links, so don't share the sheet link itself. Mimi re-reads the sheet every 5 minutes, or right away with `/samples refresh`.
- A teammate asks in chat (*"Mimi, I need a vet ad sample for John"*) or uses `/sample`, and gets one link per matching sample to send to the client.
- The client sees a branded **Watch sample** page. Their 15 minutes start when they press Watch, so link previews in texts and emails don't use up the time. When time's up the page locks and asks them to contact their rep. Links nobody opens expire after 7 days.
- `/samples add` (Manage Server only) checks the Loom link, rejects duplicate names and videos, and adds the row to the library tab through the same Apps Script. After updating `scripts/sample-log.gs`, redeploy it with **Deploy → Manage deployments → ✏️ → Version: New version** so the URL stays the same.
- `/samples log` shows who requested each link, for which client, and whether it was opened.
- **Optional "Sample Log" tab:** every link and every Watch is also written to a tab in the sheet. Paste [`scripts/sample-log.gs`](scripts/sample-log.gs) into the sheet (**Extensions → Apps Script**), set its `SECRET`, then deploy it as a web app (**Execute as: Me, Who has access: Anyone**). Put the web app URL and the secret in `SAMPLES_LOG_URL` and `SAMPLES_LOG_SECRET`. The log stores a short ID per link, never a working link.
- Loom videos must be viewable by anyone with the link (Loom's default) for the embedded player to work.

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

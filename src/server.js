import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canvaConfigured, config as appConfig } from "./config.js";
import { CORE_SCOPES, handleCallback, retryWithFewerScopes } from "./canva/auth.js";
import { servePreview } from "./samples/page.js";

const LOGO = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "agent-lead-lab-logo.png"));

function page(res, status, title, message) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;text-align:center">
<h1>${esc(title)}</h1><p>${esc(message)}</p></body>`);
}

/**
 * Small web server: Canva's OAuth redirect lands here, and Railway can use
 * "/" as a health check. `onCanvaConnected` is called after a successful sign-in.
 */
export function startServer({ onCanvaConnected } = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/assets/logo.png") {
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
      return res.end(LOGO);
    }

    const preview = url.pathname.match(/^\/p\/([A-Za-z0-9_-]{8,64})$/);
    if (preview && (req.method === "GET" || req.method === "POST")) return servePreview(req, res, preview[1]);

    if (url.pathname === "/canva/callback" && canvaConfigured) {
      const { code, state, error } = Object.fromEntries(url.searchParams);
      if (error === "invalid_scope") {
        const retry = retryWithFewerScopes(state);
        if (retry) {
          res.writeHead(302, { Location: retry });
          return res.end();
        }
        return page(
          res,
          400,
          "Canva permissions missing",
          "Canva refused the permissions Mimi asked for. Easiest fix: in the Canva developer portal, open your app → " +
            "Redirect URLs → Authorization URL generator, copy the scope list from the URL it shows " +
            "(the part after scope=, with %20 turned into spaces), and save it in Railway as the variable CANVA_SCOPES. " +
            `It should include at least: ${CORE_SCOPES.join(", ")}. Then run /canva connect in Discord again.`,
        );
      }
      if (error) return page(res, 400, "Canva not connected", `Canva said: ${error}. Run /canva connect in Discord to try again.`);
      if (code && !state) {
        return page(
          res,
          400,
          "Canva works — use Mimi's link",
          "This sign-in came from a link Mimi didn't create (like the Canva portal's test link), so she can't finish it. " +
            "Your Canva app is set up fine, though. Run /canva connect in Discord and use the link Mimi gives you.",
        );
      }
      if (!code || !state) return page(res, 400, "Canva not connected", "Missing sign-in details. Run /canva connect in Discord.");
      try {
        const entry = await handleCallback({ code, state });
        page(res, 200, "Canva connected 🎨", "Mimi can use Canva now. You can close this tab and head back to Discord.");
        onCanvaConnected?.(entry);
      } catch (err) {
        console.error("Canva sign-in failed:", err);
        page(res, 400, "Canva not connected", err.message);
      }
      return;
    }

    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("Mimi is running.");
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  server.listen(appConfig.port, () => console.log(`Web server listening on port ${appConfig.port}.`));
  return server;
}

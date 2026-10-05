import http from "node:http";
import { config } from "./config.js";
import { handleCallback, SCOPES } from "./canva/auth.js";

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

    if (url.pathname === "/canva/callback") {
      const { code, state, error } = Object.fromEntries(url.searchParams);
      if (error === "invalid_scope") {
        return page(
          res,
          400,
          "Canva permissions missing",
          "Your Canva app doesn't have every permission Mimi asks for. In the Canva developer portal, open your app → " +
            `Permissions and turn on: ${SCOPES.join(", ")}. Save, then run /canva connect in Discord again.`,
        );
      }
      if (error) return page(res, 400, "Canva not connected", `Canva said: ${error}. Run /canva connect in Discord to try again.`);
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

  server.listen(config.port, () => console.log(`Web server listening on port ${config.port}.`));
  return server;
}

/**
 * One-time SmartThings OAuth 2.0 setup script.
 * Run: npm run smartthings-setup
 *
 * Starts a local HTTP server on port 4567, prints the auth URL, waits for
 * the redirect callback, exchanges the code for tokens, stores them in SQLite,
 * then exits.
 */

import { createServer } from "node:http";
import { openDb } from "../storage/db.js";

const AUTHORIZE_URL = "https://api.smartthings.com/oauth/authorize";
const TOKEN_ENDPOINT = "https://api.smartthings.com/oauth/token";
const REDIRECT_URI = "http://localhost:4567/callback";
const PORT = 4567;

function requiredEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return val;
}

async function main() {
  const sqlitePath = requiredEnv("SQLITE_PATH");
  const clientId = requiredEnv("SMARTTHINGS_CLIENT_ID");
  const clientSecret = requiredEnv("SMARTTHINGS_CLIENT_SECRET");

  const db = openDb(sqlitePath);

  const authUrl =
    `${AUTHORIZE_URL}?` +
    new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: "r:devices:* x:devices:*",
    }).toString();

  console.log("\n=== SmartThings OAuth Setup ===\n");
  console.log("Open this URL in your browser:\n");
  console.log(authUrl);
  console.log(
    "\nIf this Pi is remote, forward port 4567 first:\n" +
      "  ssh -L 4567:localhost:4567 youruser@homepi.local\n" +
      "Then open the URL above on your local machine.\n"
  );
  console.log("Waiting for callback on http://localhost:4567/callback ...\n");

  await new Promise<void>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error || !code) {
        const msg = `OAuth error: ${error ?? "no code received"}`;
        res.writeHead(400).end(msg);
        server.close();
        reject(new Error(msg));
        return;
      }

      try {
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
        const body = new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
        });

        const tokenRes = await fetch(TOKEN_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        });

        if (!tokenRes.ok) {
          throw new Error(
            `Token exchange failed: ${tokenRes.status} ${tokenRes.statusText}`
          );
        }

        const data = (await tokenRes.json()) as {
          access_token: string;
          refresh_token: string;
          expires_in: number;
        };

        const expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;

        db.prepare(
          `INSERT INTO smartthings_oauth (id, access_token, refresh_token, expires_at, updated_at)
           VALUES (1, ?, ?, ?, unixepoch())
           ON CONFLICT(id) DO UPDATE SET
             access_token  = excluded.access_token,
             refresh_token = excluded.refresh_token,
             expires_at    = excluded.expires_at,
             updated_at    = unixepoch()`
        ).run(data.access_token, data.refresh_token, expiresAt);

        const expiryDate = new Date(expiresAt * 1000).toISOString();
        const successMsg = `Done. Token stored. Expires at ${expiryDate}.`;
        res.writeHead(200, { "Content-Type": "text/plain" }).end(successMsg);
        console.log(successMsg);
        server.close();
        resolve();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.writeHead(500).end(`Error: ${msg}`);
        server.close();
        reject(err);
      }
    });

    server.listen(PORT);
    server.on("error", (err) => {
      reject(err);
    });
  });

  db.close();
}

main().catch((err) => {
  console.error("Setup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

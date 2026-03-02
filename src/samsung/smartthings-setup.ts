/**
 * One-time SmartThings OAuth 2.0 setup script.
 * Run: npm run smartthings-setup
 *
 * Prints the auth URL, waits for the user to paste back the authorisation
 * code from the browser, exchanges it for tokens, and stores them in SQLite.
 *
 * Redirect URI registered in the SmartThings app: https://example.com/callback
 * After approving, SmartThings redirects there — the code is in the URL bar.
 */

import * as readline from "node:readline";
import { openDb } from "../storage/db.js";

const AUTHORIZE_URL = "https://api.smartthings.com/oauth/authorize";
const TOKEN_ENDPOINT = "https://api.smartthings.com/oauth/token";
const REDIRECT_URI = "https://localhost/callback";

function requiredEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return val;
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
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
  console.log("1. Open this URL in your browser:\n");
  console.log("   " + authUrl);
  console.log("\n2. Log in with your Samsung account and approve access.");
  console.log("\n3. You will be redirected to example.com — the page won't load, that's fine.");
  console.log("   Copy the full URL from your browser's address bar.\n");

  const input = await prompt("Paste the full redirect URL here: ");

  let code: string;
  try {
    const parsed = new URL(input);
    const maybeCode = parsed.searchParams.get("code");
    if (!maybeCode) throw new Error("no code parameter found");
    code = maybeCode;
  } catch {
    console.error("Could not parse the URL. Make sure you copied the full address bar URL.");
    process.exit(1);
  }

  console.log("\nExchanging code for tokens...");

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
    console.error(`Token exchange failed: ${tokenRes.status} ${tokenRes.statusText}`);
    process.exit(1);
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

  db.close();

  console.log(`\nDone. Token stored. Expires at ${new Date(expiresAt * 1000).toISOString()}.`);
}

main().catch((err) => {
  console.error("Setup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

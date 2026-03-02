import type Database from "better-sqlite3";

const TOKEN_ENDPOINT = "https://api.smartthings.com/oauth/token";

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export async function refreshTokens(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  fetchFn: typeof fetch = fetch
): Promise<TokenResponse> {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetchFn(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(
      `SmartThings token refresh failed: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
  };
}

export async function getValidToken(
  db: Database.Database,
  clientId: string,
  clientSecret: string,
  fetchFn: typeof fetch = fetch
): Promise<string> {
  const row = db
    .prepare(
      "SELECT access_token, refresh_token, expires_at FROM smartthings_oauth WHERE id = 1"
    )
    .get() as
    | { access_token: string; refresh_token: string; expires_at: number }
    | undefined;

  if (!row) {
    throw new Error(
      "SmartThings not authorised. Run: npm run smartthings-setup"
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (row.expires_at - 300 <= nowSec) {
    const tokens = await refreshTokens(
      clientId,
      clientSecret,
      row.refresh_token,
      fetchFn
    );
    db.prepare(
      `INSERT INTO smartthings_oauth (id, access_token, refresh_token, expires_at, updated_at)
       VALUES (1, ?, ?, ?, unixepoch())
       ON CONFLICT(id) DO UPDATE SET
         access_token  = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at    = excluded.expires_at,
         updated_at    = unixepoch()`
    ).run(tokens.access_token, tokens.refresh_token, tokens.expires_at);
    return tokens.access_token;
  }

  return row.access_token;
}

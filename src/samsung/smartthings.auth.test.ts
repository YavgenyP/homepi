import { describe, it, expect, vi } from "vitest";
import { openDb } from "../storage/db.js";
import { refreshTokens, getValidToken } from "./smartthings.auth.js";

const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret";

function makeDb() {
  return openDb(":memory:");
}

function seedToken(
  db: ReturnType<typeof openDb>,
  opts: { expiresAt: number; refreshToken?: string; accessToken?: string }
) {
  db.prepare(
    `INSERT INTO smartthings_oauth (id, access_token, refresh_token, expires_at)
     VALUES (1, ?, ?, ?)`
  ).run(
    opts.accessToken ?? "stored-access-token",
    opts.refreshToken ?? "stored-refresh-token",
    opts.expiresAt
  );
}

function makeTokenFetch(overrides?: Partial<{ access_token: string; refresh_token: string; expires_in: number }>): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      access_token: overrides?.access_token ?? "new-access-token",
      refresh_token: overrides?.refresh_token ?? "new-refresh-token",
      expires_in: overrides?.expires_in ?? 86400,
    }),
  } as Response);
}

describe("getValidToken", () => {
  it("returns stored token without HTTP call when not near expiry", async () => {
    const db = makeDb();
    const futureExpiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour away
    seedToken(db, { expiresAt: futureExpiry, accessToken: "valid-token" });

    const fetchFn = vi.fn();
    const token = await getValidToken(db, CLIENT_ID, CLIENT_SECRET, fetchFn as unknown as typeof fetch);

    expect(token).toBe("valid-token");
    expect(fetchFn).not.toHaveBeenCalled();
    db.close();
  });

  it("calls token endpoint and updates DB when token expires within 5 minutes", async () => {
    const db = makeDb();
    const soonExpiry = Math.floor(Date.now() / 1000) + 200; // less than 300s
    seedToken(db, { expiresAt: soonExpiry });

    const fetchFn = makeTokenFetch({ access_token: "refreshed-token" });
    const token = await getValidToken(db, CLIENT_ID, CLIENT_SECRET, fetchFn);

    expect(token).toBe("refreshed-token");
    expect(fetchFn).toHaveBeenCalledOnce();

    const row = db
      .prepare("SELECT access_token FROM smartthings_oauth WHERE id = 1")
      .get() as { access_token: string };
    expect(row.access_token).toBe("refreshed-token");
    db.close();
  });

  it("calls token endpoint and updates DB when token is already expired", async () => {
    const db = makeDb();
    const pastExpiry = Math.floor(Date.now() / 1000) - 100;
    seedToken(db, { expiresAt: pastExpiry });

    const fetchFn = makeTokenFetch({ access_token: "fresh-token" });
    const token = await getValidToken(db, CLIENT_ID, CLIENT_SECRET, fetchFn);

    expect(token).toBe("fresh-token");
    expect(fetchFn).toHaveBeenCalledOnce();
    db.close();
  });

  it("stores new refresh_token from response (rotation)", async () => {
    const db = makeDb();
    const pastExpiry = Math.floor(Date.now() / 1000) - 1;
    seedToken(db, { expiresAt: pastExpiry, refreshToken: "old-refresh" });

    const fetchFn = makeTokenFetch({ refresh_token: "rotated-refresh-token" });
    await getValidToken(db, CLIENT_ID, CLIENT_SECRET, fetchFn);

    const row = db
      .prepare("SELECT refresh_token FROM smartthings_oauth WHERE id = 1")
      .get() as { refresh_token: string };
    expect(row.refresh_token).toBe("rotated-refresh-token");
    db.close();
  });

  it("throws helpful message when DB has no row", async () => {
    const db = makeDb();
    const fetchFn = vi.fn();

    await expect(
      getValidToken(db, CLIENT_ID, CLIENT_SECRET, fetchFn as unknown as typeof fetch)
    ).rejects.toThrow("SmartThings not authorised");

    expect(fetchFn).not.toHaveBeenCalled();
    db.close();
  });
});

describe("refreshTokens", () => {
  it("sends Basic auth header (not Bearer)", async () => {
    const fetchFn = makeTokenFetch();
    await refreshTokens(CLIENT_ID, CLIENT_SECRET, "some-refresh-token", fetchFn);

    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const auth = (init.headers as Record<string, string>)["Authorization"];
    expect(auth).toMatch(/^Basic /);
    expect(auth).not.toMatch(/^Bearer /);

    const decoded = Buffer.from(auth.slice("Basic ".length), "base64").toString();
    expect(decoded).toBe(`${CLIENT_ID}:${CLIENT_SECRET}`);
  });

  it("throws on non-ok HTTP response", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    } as Response);

    await expect(
      refreshTokens(CLIENT_ID, CLIENT_SECRET, "bad-token", fetchFn)
    ).rejects.toThrow("401");
  });
});

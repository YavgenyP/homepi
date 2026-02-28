import ping from "ping";
import type Database from "better-sqlite3";
import type { PresenceProvider, PresenceSighting } from "./provider.interface.js";

type PingFn = (host: string, timeoutMs: number) => Promise<boolean>;

async function defaultPing(host: string, timeoutMs: number): Promise<boolean> {
  const result = await ping.promise.probe(host, {
    timeout: Math.ceil(timeoutMs / 1000),
  });
  return result.alive;
}

type DeviceRow = { person_id: number; value: string };

export class PingProvider implements PresenceProvider {
  readonly name = "ping";

  constructor(
    private readonly db: Database.Database,
    private readonly timeoutMs: number = 1000,
    private readonly pingFn: PingFn = defaultPing
  ) {}

  async poll(): Promise<PresenceSighting[]> {
    const devices = this.db
      .prepare(
        "SELECT person_id, value FROM person_devices WHERE kind = 'ping_ip'"
      )
      .all() as DeviceRow[];

    if (devices.length === 0) return [];

    const results = await Promise.all(
      devices.map(async (d) => ({
        personId: d.person_id,
        alive: await this.pingFn(d.value, this.timeoutMs),
      }))
    );

    // A person is seen if any of their devices responded.
    const seenPersonIds = new Set(
      results.filter((r) => r.alive).map((r) => r.personId)
    );

    const now = Math.floor(Date.now() / 1000);
    return Array.from(seenPersonIds).map((personId) => ({ personId, seenAt: now }));
  }
}

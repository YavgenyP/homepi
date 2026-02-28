import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../storage/db.js";
import { PingProvider } from "./ping.provider.js";

let db: Database.Database;

function seedPerson(discordUserId: string, name: string): number {
  db.prepare("INSERT INTO people (discord_user_id, name) VALUES (?, ?)").run(
    discordUserId,
    name
  );
  return (
    db
      .prepare("SELECT id FROM people WHERE discord_user_id = ?")
      .get(discordUserId) as { id: number }
  ).id;
}

function seedDevice(personId: number, ip: string) {
  db.prepare(
    "INSERT INTO person_devices (person_id, kind, value) VALUES (?, 'ping_ip', ?)"
  ).run(personId, ip);
}

beforeEach(() => {
  db = openDb(":memory:");
});

describe("PingProvider", () => {
  it("returns empty array when no devices are registered", async () => {
    const pingFn = vi.fn();
    const provider = new PingProvider(db, 1000, pingFn);
    expect(await provider.poll()).toEqual([]);
    expect(pingFn).not.toHaveBeenCalled();
  });

  it("returns a sighting when device responds", async () => {
    const personId = seedPerson("u1", "Alice");
    seedDevice(personId, "192.168.1.10");

    const pingFn = vi.fn().mockResolvedValue(true);
    const provider = new PingProvider(db, 1000, pingFn);

    const sightings = await provider.poll();
    expect(sightings).toHaveLength(1);
    expect(sightings[0].personId).toBe(personId);
    expect(sightings[0].seenAt).toBeGreaterThan(0);
    expect(pingFn).toHaveBeenCalledWith("192.168.1.10", 1000);
  });

  it("returns no sighting when device does not respond", async () => {
    const personId = seedPerson("u1", "Alice");
    seedDevice(personId, "192.168.1.10");

    const pingFn = vi.fn().mockResolvedValue(false);
    const provider = new PingProvider(db, 1000, pingFn);

    expect(await provider.poll()).toEqual([]);
  });

  it("deduplicates — one sighting per person even with multiple devices", async () => {
    const personId = seedPerson("u1", "Alice");
    seedDevice(personId, "192.168.1.10");
    seedDevice(personId, "192.168.1.11");

    const pingFn = vi.fn().mockResolvedValue(true);
    const provider = new PingProvider(db, 1000, pingFn);

    const sightings = await provider.poll();
    expect(sightings).toHaveLength(1);
    expect(sightings[0].personId).toBe(personId);
    expect(pingFn).toHaveBeenCalledTimes(2);
  });

  it("returns sighting for person with at least one responsive device", async () => {
    const personId = seedPerson("u1", "Alice");
    seedDevice(personId, "192.168.1.10");
    seedDevice(personId, "192.168.1.11");

    const pingFn = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const provider = new PingProvider(db, 1000, pingFn);

    const sightings = await provider.poll();
    expect(sightings).toHaveLength(1);
  });

  it("returns sightings for multiple people independently", async () => {
    const aliceId = seedPerson("u1", "Alice");
    const bobId = seedPerson("u2", "Bob");
    seedDevice(aliceId, "192.168.1.10");
    seedDevice(bobId, "192.168.1.20");

    const pingFn = vi
      .fn()
      .mockImplementation((ip: string) =>
        Promise.resolve(ip === "192.168.1.10")
      );
    const provider = new PingProvider(db, 1000, pingFn);

    const sightings = await provider.poll();
    expect(sightings).toHaveLength(1);
    expect(sightings[0].personId).toBe(aliceId);
  });

  it("has name 'ping'", () => {
    expect(new PingProvider(db).name).toBe("ping");
  });
});

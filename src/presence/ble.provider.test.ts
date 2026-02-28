import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../storage/db.js";
import { BleProvider } from "./ble.provider.js";

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

function seedBleDevice(personId: number, mac: string) {
  db.prepare(
    "INSERT INTO person_devices (person_id, kind, value) VALUES (?, 'ble_mac', ?)"
  ).run(personId, mac);
}

beforeEach(() => {
  db = openDb(":memory:");
});

describe("BleProvider", () => {
  it("returns empty array when no BLE devices are registered", async () => {
    const scanFn = vi.fn();
    const provider = new BleProvider(db, 100, scanFn);
    expect(await provider.poll()).toEqual([]);
    expect(scanFn).not.toHaveBeenCalled();
  });

  it("returns a sighting when registered MAC is seen", async () => {
    const personId = seedPerson("u1", "Alice");
    seedBleDevice(personId, "aa:bb:cc:dd:ee:ff");

    const scanFn = vi.fn().mockResolvedValue(new Set(["aa:bb:cc:dd:ee:ff"]));
    const provider = new BleProvider(db, 100, scanFn);

    const sightings = await provider.poll();
    expect(sightings).toHaveLength(1);
    expect(sightings[0].personId).toBe(personId);
  });

  it("matches case-insensitively", async () => {
    const personId = seedPerson("u1", "Alice");
    seedBleDevice(personId, "AA:BB:CC:DD:EE:FF");

    const scanFn = vi.fn().mockResolvedValue(new Set(["aa:bb:cc:dd:ee:ff"]));
    const provider = new BleProvider(db, 100, scanFn);

    expect(await provider.poll()).toHaveLength(1);
  });

  it("returns no sighting when MAC is not seen", async () => {
    const personId = seedPerson("u1", "Alice");
    seedBleDevice(personId, "aa:bb:cc:dd:ee:ff");

    const scanFn = vi.fn().mockResolvedValue(new Set<string>());
    const provider = new BleProvider(db, 100, scanFn);

    expect(await provider.poll()).toEqual([]);
  });

  it("deduplicates — one sighting per person with multiple BLE devices", async () => {
    const personId = seedPerson("u1", "Alice");
    seedBleDevice(personId, "aa:bb:cc:dd:ee:ff");
    seedBleDevice(personId, "11:22:33:44:55:66");

    const scanFn = vi
      .fn()
      .mockResolvedValue(
        new Set(["aa:bb:cc:dd:ee:ff", "11:22:33:44:55:66"])
      );
    const provider = new BleProvider(db, 100, scanFn);

    expect(await provider.poll()).toHaveLength(1);
  });

  it("returns sightings for multiple people independently", async () => {
    const aliceId = seedPerson("u1", "Alice");
    const bobId = seedPerson("u2", "Bob");
    seedBleDevice(aliceId, "aa:bb:cc:dd:ee:ff");
    seedBleDevice(bobId, "11:22:33:44:55:66");

    const scanFn = vi
      .fn()
      .mockResolvedValue(new Set(["aa:bb:cc:dd:ee:ff"]));
    const provider = new BleProvider(db, 100, scanFn);

    const sightings = await provider.poll();
    expect(sightings).toHaveLength(1);
    expect(sightings[0].personId).toBe(aliceId);
  });

  it("passes scanDurationMs to scanFn", async () => {
    seedPerson("u1", "Alice");
    const personId = (
      db.prepare("SELECT id FROM people").get() as { id: number }
    ).id;
    seedBleDevice(personId, "aa:bb:cc:dd:ee:ff");

    const scanFn = vi.fn().mockResolvedValue(new Set<string>());
    const provider = new BleProvider(db, 7500, scanFn);
    await provider.poll();

    expect(scanFn).toHaveBeenCalledWith(7500);
  });

  it("has name 'ble'", () => {
    expect(new BleProvider(db).name).toBe("ble");
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../storage/db.js";
import { handlePair } from "./pair.handler.js";
import type { Intent } from "../intent.schema.js";

const baseIntent: Intent = {
  intent: "pair_phone",
  trigger: "none",
  action: "none",
  message: null,
  time_spec: null,
  person: { ref: "me" },
  phone: { ip: "192.168.1.23" },
  sound_source: null,
  confidence: 0.98,
  clarifying_question: null,
};

let db: Database.Database;

beforeEach(() => {
  db = openDb(":memory:");
});

describe("handlePair", () => {
  it("registers a new user and IP device", () => {
    const reply = handlePair(baseIntent, "u1", "Alice", db);
    expect(reply).toMatch(/registered/i);
    expect(reply).toContain("192.168.1.23");

    const person = db
      .prepare("SELECT * FROM people WHERE discord_user_id = 'u1'")
      .get() as { name: string };
    expect(person.name).toBe("Alice");

    const device = db
      .prepare("SELECT * FROM person_devices WHERE value = '192.168.1.23'")
      .get() as { kind: string };
    expect(device.kind).toBe("ping_ip");
  });

  it("registers a BLE MAC device", () => {
    const intent: Intent = {
      ...baseIntent,
      phone: { ble_mac: "aa:bb:cc:dd:ee:ff" },
    };
    const reply = handlePair(intent, "u1", "Alice", db);
    expect(reply).toMatch(/registered/i);

    const device = db
      .prepare("SELECT * FROM person_devices WHERE value = 'aa:bb:cc:dd:ee:ff'")
      .get() as { kind: string };
    expect(device.kind).toBe("ble_mac");
  });

  it("returns 'already registered' when device is registered again", () => {
    handlePair(baseIntent, "u1", "Alice", db);
    const reply = handlePair(baseIntent, "u1", "Alice", db);
    expect(reply).toMatch(/already registered/i);
  });

  it("reuses existing person record when same user registers a second device", () => {
    handlePair(baseIntent, "u1", "Alice", db);
    const intent2: Intent = { ...baseIntent, phone: { ip: "192.168.1.99" } };
    handlePair(intent2, "u1", "Alice", db);

    const people = db.prepare("SELECT * FROM people").all();
    expect(people).toHaveLength(1);

    const devices = db.prepare("SELECT * FROM person_devices").all();
    expect(devices).toHaveLength(2);
  });

  it("returns an error when phone field has no ip or ble_mac", () => {
    const intent: Intent = { ...baseIntent, phone: {} };
    const reply = handlePair(intent, "u1", "Alice", db);
    expect(reply).toMatch(/ip address or ble mac/i);
  });

  it("returns an error when phone is null", () => {
    const intent: Intent = { ...baseIntent, phone: null };
    const reply = handlePair(intent, "u1", "Alice", db);
    expect(reply).toMatch(/ip address or ble mac/i);
  });
});

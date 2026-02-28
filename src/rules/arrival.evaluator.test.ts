import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../storage/db.js";
import { evaluateArrivalRules } from "./arrival.evaluator.js";

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

function seedArrivalRule(personId: number, message: string, enabled = 1) {
  db.prepare(
    `INSERT INTO rules (name, trigger_type, trigger_json, action_type, action_json, enabled)
     VALUES (?, 'arrival', ?, 'notify', ?, ?)`
  ).run(
    `arrival: ${message}`,
    JSON.stringify({ person_id: personId }),
    JSON.stringify({ message }),
    enabled
  );
}

beforeEach(() => {
  db = openDb(":memory:");
});

describe("evaluateArrivalRules", () => {
  it("does nothing when no arrival rules exist", async () => {
    const send = vi.fn();
    const id = seedPerson("u1", "Alice");
    await evaluateArrivalRules(id, db, send);
    expect(send).not.toHaveBeenCalled();
  });

  it("fires the matching rule message", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const id = seedPerson("u1", "Alice");
    seedArrivalRule(id, "welcome home");
    await evaluateArrivalRules(id, db, send);
    expect(send).toHaveBeenCalledWith("welcome home");
  });

  it("fires multiple rules for the same person", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const id = seedPerson("u1", "Alice");
    seedArrivalRule(id, "welcome home");
    seedArrivalRule(id, "check the mail");
    await evaluateArrivalRules(id, db, send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not fire rules for a different person", async () => {
    const send = vi.fn();
    const aliceId = seedPerson("u1", "Alice");
    const bobId = seedPerson("u2", "Bob");
    seedArrivalRule(bobId, "Bob is home");
    await evaluateArrivalRules(aliceId, db, send);
    expect(send).not.toHaveBeenCalled();
  });

  it("skips disabled rules", async () => {
    const send = vi.fn();
    const id = seedPerson("u1", "Alice");
    seedArrivalRule(id, "welcome home", 0);
    await evaluateArrivalRules(id, db, send);
    expect(send).not.toHaveBeenCalled();
  });
});

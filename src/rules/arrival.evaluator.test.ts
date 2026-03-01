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

function seedArrivalRule(
  personId: number,
  message: string | null,
  enabled = 1,
  sound?: string
) {
  const actionJson: Record<string, unknown> = {};
  if (message) actionJson.message = message;
  if (sound) actionJson.sound = sound;
  db.prepare(
    `INSERT INTO rules (name, trigger_type, trigger_json, action_type, action_json, enabled)
     VALUES (?, 'arrival', ?, 'notify', ?, ?)`
  ).run(
    `arrival: ${message ?? sound}`,
    JSON.stringify({ person_id: personId }),
    JSON.stringify(actionJson),
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

  it("calls playSoundFn when rule has a sound field", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const play = vi.fn().mockResolvedValue(undefined);
    const id = seedPerson("u1", "Alice");
    seedArrivalRule(id, "welcome home", 1, "/data/sounds/welcome.mp3");
    await evaluateArrivalRules(id, db, send, play);
    expect(send).toHaveBeenCalledWith("welcome home");
    expect(play).toHaveBeenCalledWith("/data/sounds/welcome.mp3");
  });

  it("plays sound even when message is null", async () => {
    const send = vi.fn();
    const play = vi.fn().mockResolvedValue(undefined);
    const id = seedPerson("u1", "Alice");
    seedArrivalRule(id, null, 1, "https://youtube.com/watch?v=abc");
    await evaluateArrivalRules(id, db, send, play);
    expect(send).not.toHaveBeenCalled();
    expect(play).toHaveBeenCalledWith("https://youtube.com/watch?v=abc");
  });

  it("does not throw when playSoundFn is omitted", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const id = seedPerson("u1", "Alice");
    seedArrivalRule(id, "welcome home", 1, "/data/sounds/welcome.mp3");
    await expect(evaluateArrivalRules(id, db, send)).resolves.toBeUndefined();
  });

  it("prepends @mention when action has target_person_id", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const triggerId = seedPerson("u1", "Alice");
    const targetId = seedPerson("u2", "Bob");

    // Seed rule manually with target_person_id
    db.prepare(
      `INSERT INTO rules (name, trigger_type, trigger_json, action_type, action_json)
       VALUES ('arrival: hello', 'arrival', ?, 'notify', ?)`
    ).run(
      JSON.stringify({ person_id: triggerId }),
      JSON.stringify({ message: "you arrived!", target_person_id: targetId })
    );

    await evaluateArrivalRules(triggerId, db, send);
    expect(send).toHaveBeenCalledWith("<@u2> you arrived!");
  });

  it("sends plain message when no target_person_id", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const id = seedPerson("u1", "Alice");
    seedArrivalRule(id, "welcome home");
    await evaluateArrivalRules(id, db, send);
    expect(send).toHaveBeenCalledWith("welcome home");
  });
});

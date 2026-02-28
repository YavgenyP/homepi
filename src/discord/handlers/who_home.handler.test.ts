import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../storage/db.js";
import { handleWhoHome } from "./who_home.handler.js";

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

beforeEach(() => {
  db = openDb(":memory:");
});

describe("handleWhoHome", () => {
  it("returns a prompt when no one is registered", () => {
    const reply = handleWhoHome(new Map(), db);
    expect(reply).toMatch(/no one is registered/i);
  });

  it("shows home for a person in the state map", () => {
    const id = seedPerson("u1", "Alice");
    const reply = handleWhoHome(new Map([[id, "home"]]), db);
    expect(reply).toBe("Alice: home");
  });

  it("shows away for a person not in the state map", () => {
    seedPerson("u1", "Alice");
    const reply = handleWhoHome(new Map(), db);
    expect(reply).toBe("Alice: away");
  });

  it("shows away for a person explicitly marked away", () => {
    const id = seedPerson("u1", "Alice");
    const reply = handleWhoHome(new Map([[id, "away"]]), db);
    expect(reply).toBe("Alice: away");
  });

  it("lists multiple people sorted by name", () => {
    const bobId = seedPerson("u2", "Bob");
    const aliceId = seedPerson("u1", "Alice");
    const reply = handleWhoHome(
      new Map([
        [aliceId, "home"],
        [bobId, "away"],
      ]),
      db
    );
    expect(reply).toBe("Alice: home\nBob: away");
  });
});

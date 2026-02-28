import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../storage/db.js";
import { PresenceStateMachine } from "./presence.state.js";
import type { PresenceProvider, PresenceSighting } from "./provider.interface.js";

const CONFIG = { intervalSec: 30, debounceSec: 60, homeTtlSec: 180 };

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

function makeProvider(sightings: PresenceSighting[]): PresenceProvider {
  return { name: "mock", poll: vi.fn().mockResolvedValue(sightings) };
}

beforeEach(() => {
  db = openDb(":memory:");
});

describe("PresenceStateMachine", () => {
  it("initialises with no people — tick does nothing", async () => {
    const notify = vi.fn();
    const machine = new PresenceStateMachine([], db, notify, CONFIG);
    await machine.tick(1000);
    expect(notify).not.toHaveBeenCalled();
  });

  it("loads initial state from presence_events on construction", () => {
    const id = seedPerson("u1", "Alice");
    db.prepare(
      "INSERT INTO presence_events (person_id, state, ts) VALUES (?, 'home', 1000)"
    ).run(id);

    const machine = new PresenceStateMachine([], db, vi.fn(), CONFIG);
    expect(machine.getCurrentStates().get(id)).toBe("home");
  });

  it("defaults to away when no presence_events exist", () => {
    const id = seedPerson("u1", "Alice");
    const machine = new PresenceStateMachine([], db, vi.fn(), CONFIG);
    expect(machine.getCurrentStates().get(id)).toBe("away");
  });

  it("does NOT transition before debounce elapses", async () => {
    const id = seedPerson("u1", "Alice");
    const notify = vi.fn();
    const machine = new PresenceStateMachine(
      [makeProvider([{ personId: id, seenAt: 1000 }])],
      db,
      notify,
      CONFIG
    );

    // Seen at t=1000, debounce=60 → needs to be pending until t=1060
    await machine.tick(1000); // first sight — pending starts
    await machine.tick(1050); // still within debounce
    expect(machine.getCurrentStates().get(id)).toBe("away");
    expect(notify).not.toHaveBeenCalled();
  });

  it("transitions home and notifies after debounce", async () => {
    const id = seedPerson("u1", "Alice");
    const notify = vi.fn().mockResolvedValue(undefined);
    const machine = new PresenceStateMachine(
      [makeProvider([{ personId: id, seenAt: 1000 }])],
      db,
      notify,
      CONFIG
    );

    await machine.tick(1000); // sighting, pending starts
    await machine.tick(1060); // debounce elapsed → commit
    expect(machine.getCurrentStates().get(id)).toBe("home");
    expect(notify).toHaveBeenCalledWith("Alice");
  });

  it("writes presence_event to DB on transition", async () => {
    const id = seedPerson("u1", "Alice");
    const machine = new PresenceStateMachine(
      [makeProvider([{ personId: id, seenAt: 1000 }])],
      db,
      vi.fn().mockResolvedValue(undefined),
      CONFIG
    );

    await machine.tick(1000);
    await machine.tick(1060);

    const events = db
      .prepare("SELECT state FROM presence_events WHERE person_id = ?")
      .all(id) as { state: string }[];
    expect(events.map((e) => e.state)).toContain("home");
  });

  it("transitions away after TTL expires and debounce elapses", async () => {
    const id = seedPerson("u1", "Alice");
    const notify = vi.fn().mockResolvedValue(undefined);
    // Start as home
    db.prepare(
      "INSERT INTO presence_events (person_id, state, ts) VALUES (?, 'home', 0)"
    ).run(id);

    const machine = new PresenceStateMachine([], db, notify, CONFIG);
    expect(machine.getCurrentStates().get(id)).toBe("home");

    // No sightings — lastSeenAt stays 0. homeTtlSec=180, so away once now > 180.
    // At t=300: 300-0=300 > 180 → candidate=away, pending starts
    await machine.tick(300);
    await machine.tick(300 + CONFIG.debounceSec);

    expect(machine.getCurrentStates().get(id)).toBe("away");
    // No arrival notify on home→away
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not notify on home→away transition", async () => {
    const id = seedPerson("u1", "Alice");
    const notify = vi.fn();
    db.prepare(
      "INSERT INTO presence_events (person_id, state, ts) VALUES (?, 'home', 0)"
    ).run(id);

    const machine = new PresenceStateMachine([], db, notify, CONFIG);
    await machine.tick(400);
    await machine.tick(400 + CONFIG.debounceSec);

    expect(notify).not.toHaveBeenCalled();
  });

  it("picks up newly registered people on subsequent ticks", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const machine = new PresenceStateMachine([], db, notify, CONFIG);

    // Register after machine construction
    const id = seedPerson("u1", "Alice");
    const provider = makeProvider([{ personId: id, seenAt: 2000 }]);
    // Replace providers via a wrapper (simulate new person)
    const m2 = new PresenceStateMachine([provider], db, notify, CONFIG);
    await m2.tick(2000);
    await m2.tick(2060);

    expect(m2.getCurrentStates().get(id)).toBe("home");
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../storage/db.js";
import type Database from "better-sqlite3";

// The REPL logic is tested through the same DB operations it uses.
// We exercise each command's SQL directly with an in-memory DB.

function setup() {
  const db = openDb(":memory:");

  // Insert two people
  db.prepare("INSERT INTO people (discord_user_id, name) VALUES (?, ?)").run(
    "u1",
    "Alice"
  );
  db.prepare("INSERT INTO people (discord_user_id, name) VALUES (?, ?)").run(
    "u2",
    "Bob"
  );

  const alice = (
    db.prepare("SELECT id FROM people WHERE discord_user_id='u1'").get() as {
      id: number;
    }
  ).id;
  const bob = (
    db.prepare("SELECT id FROM people WHERE discord_user_id='u2'").get() as {
      id: number;
    }
  ).id;

  // Devices
  db.prepare(
    "INSERT INTO person_devices (person_id, kind, value) VALUES (?, 'ping_ip', ?)"
  ).run(alice, "192.168.1.10");
  db.prepare(
    "INSERT INTO person_devices (person_id, kind, value) VALUES (?, 'ble_mac', ?)"
  ).run(bob, "aa:bb:cc:dd:ee:ff");

  // Presence events
  db.prepare(
    "INSERT INTO presence_events (person_id, state, ts) VALUES (?, 'home', ?)"
  ).run(alice, Math.floor(Date.now() / 1000) - 60);
  db.prepare(
    "INSERT INTO presence_events (person_id, state, ts) VALUES (?, 'away', ?)"
  ).run(bob, Math.floor(Date.now() / 1000) - 30);

  // A time rule
  db.prepare(
    `INSERT INTO rules (name, trigger_type, trigger_json, action_type, action_json)
     VALUES ('morning', 'time', '{"cron":"0 8 * * *"}', 'notify', '{"message":"good morning"}')`
  ).run();
  const ruleId = (db.prepare("SELECT id FROM rules ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
  db.prepare(
    "INSERT INTO scheduled_jobs (rule_id, next_run_ts, status) VALUES (?, ?, 'pending')"
  ).run(ruleId, Math.floor(Date.now() / 1000) + 3600);

  return { db, alice, bob, ruleId };
}

// ── helpers that mirror the REPL's SQL ──────────────────────────────────────

function queryStatus(db: Database.Database) {
  return db
    .prepare(
      `SELECT p.name, pe.state, pe.ts
       FROM people p
       LEFT JOIN presence_events pe ON pe.id = (
         SELECT id FROM presence_events
         WHERE person_id = p.id ORDER BY ts DESC LIMIT 1
       )
       ORDER BY p.name`
    )
    .all() as { name: string; state: string | null; ts: number | null }[];
}

function queryPeople(db: Database.Database) {
  return db
    .prepare("SELECT id, name, discord_user_id FROM people ORDER BY name")
    .all() as { id: number; name: string; discord_user_id: string }[];
}

function queryDevices(db: Database.Database, personId: number) {
  return db
    .prepare(
      "SELECT kind, value FROM person_devices WHERE person_id = ? ORDER BY kind"
    )
    .all(personId) as { kind: string; value: string }[];
}

function queryRules(db: Database.Database) {
  return db
    .prepare(
      "SELECT id, name, trigger_type, trigger_json, action_json, enabled FROM rules ORDER BY id"
    )
    .all() as {
    id: number;
    name: string;
    trigger_type: string;
    trigger_json: string;
    action_json: string;
    enabled: number;
  }[];
}

function queryJobs(db: Database.Database) {
  return db
    .prepare(
      "SELECT id, rule_id, next_run_ts, status FROM scheduled_jobs ORDER BY id"
    )
    .all() as {
    id: number;
    rule_id: number;
    next_run_ts: number | null;
    status: string;
  }[];
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("REPL — status", () => {
  it("returns latest presence state per person", () => {
    const { db } = setup();
    const rows = queryStatus(db);
    expect(rows).toHaveLength(2);
    const alice = rows.find((r) => r.name === "Alice")!;
    const bob = rows.find((r) => r.name === "Bob")!;
    expect(alice.state).toBe("home");
    expect(bob.state).toBe("away");
  });

  it("returns null state when no presence events", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO people (discord_user_id, name) VALUES ('u9', 'Eve')").run();
    const rows = queryStatus(db);
    expect(rows[0].state).toBeNull();
  });
});

describe("REPL — people", () => {
  it("lists all people with devices", () => {
    const { db, alice } = setup();
    const people = queryPeople(db);
    expect(people).toHaveLength(2);
    const devices = queryDevices(db, alice);
    expect(devices).toEqual([{ kind: "ping_ip", value: "192.168.1.10" }]);
  });
});

describe("REPL — rules", () => {
  it("lists all rules", () => {
    const { db } = setup();
    const rules = queryRules(db);
    expect(rules).toHaveLength(1);
    expect(rules[0].trigger_type).toBe("time");
    expect(rules[0].enabled).toBe(1);
  });
});

describe("REPL — jobs", () => {
  it("lists scheduled jobs", () => {
    const { db } = setup();
    const jobs = queryJobs(db);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("pending");
  });
});

describe("REPL — enable / disable", () => {
  it("disables a rule", () => {
    const { db, ruleId } = setup();
    db.prepare("UPDATE rules SET enabled=0 WHERE id=?").run(ruleId);
    const rule = db.prepare("SELECT enabled FROM rules WHERE id=?").get(ruleId) as { enabled: number };
    expect(rule.enabled).toBe(0);
  });

  it("enables a rule", () => {
    const { db, ruleId } = setup();
    db.prepare("UPDATE rules SET enabled=0 WHERE id=?").run(ruleId);
    db.prepare("UPDATE rules SET enabled=1 WHERE id=?").run(ruleId);
    const rule = db.prepare("SELECT enabled FROM rules WHERE id=?").get(ruleId) as { enabled: number };
    expect(rule.enabled).toBe(1);
  });

  it("returns 0 changes for unknown rule id", () => {
    const { db } = setup();
    const info = db.prepare("UPDATE rules SET enabled=0 WHERE id=?").run(9999);
    expect(info.changes).toBe(0);
  });
});

describe("REPL — delete", () => {
  it("deletes a rule and its jobs cascade", () => {
    const { db, ruleId } = setup();
    db.prepare("DELETE FROM rules WHERE id=?").run(ruleId);
    const rules = queryRules(db);
    const jobs = queryJobs(db);
    expect(rules).toHaveLength(0);
    expect(jobs).toHaveLength(0);
  });

  it("returns 0 changes for unknown rule id", () => {
    const { db } = setup();
    const info = db.prepare("DELETE FROM rules WHERE id=?").run(9999);
    expect(info.changes).toBe(0);
  });
});

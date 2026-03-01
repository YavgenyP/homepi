import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../storage/db.js";
import {
  handleCreateRule,
  handleListRules,
  handleDeleteRule,
} from "./rule.handler.js";
import type { Intent } from "../intent.schema.js";

const BASE: Intent = {
  intent: "create_rule",
  trigger: "time",
  action: "notify",
  message: "take out the trash",
  time_spec: { datetime_iso: "2099-06-01T08:00:00" },
  person: { ref: "me" },
  phone: null,
  sound_source: null,
  require_home: false,
  confidence: 0.95,
  clarifying_question: null,
};

let db: Database.Database;

function seedPerson(discordUserId = "u1", name = "Alice"): number {
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

// ── create_rule ───────────────────────────────────────────────────────────────

describe("handleCreateRule — time", () => {
  it("creates a time rule and scheduled_job", () => {
    const reply = handleCreateRule(BASE, "u1", db);
    expect(reply).toMatch(/rule created/i);
    expect(reply).toMatch(/#1/);

    const rule = db.prepare("SELECT * FROM rules WHERE id = 1").get() as {
      trigger_type: string;
      action_json: string;
    };
    expect(rule.trigger_type).toBe("time");
    expect(JSON.parse(rule.action_json).message).toBe("take out the trash");

    const job = db
      .prepare("SELECT * FROM scheduled_jobs WHERE rule_id = 1")
      .get() as { next_run_ts: number; status: string };
    expect(job.status).toBe("pending");
    expect(job.next_run_ts).toBeGreaterThan(0);
  });

  it("stores computed next_run_ts for cron trigger", () => {
    const intent: Intent = {
      ...BASE,
      time_spec: { cron: "0 8 * * *" },
    };
    handleCreateRule(intent, "u1", db);
    const job = db
      .prepare("SELECT next_run_ts FROM scheduled_jobs WHERE rule_id = 1")
      .get() as { next_run_ts: number | null };
    expect(job.next_run_ts).not.toBeNull();
    expect(job.next_run_ts).toBeGreaterThan(0);
  });

  it("returns error for invalid cron expression", () => {
    const reply = handleCreateRule(
      { ...BASE, time_spec: { cron: "/5 * * *" } },
      "u1",
      db
    );
    expect(reply).toMatch(/invalid cron/i);
    expect(reply).toMatch(/5 fields/i);
  });

  it("returns error when message is missing", () => {
    const reply = handleCreateRule({ ...BASE, message: null }, "u1", db);
    expect(reply).toMatch(/message/i);
  });

  it("returns error when time_spec is missing", () => {
    const reply = handleCreateRule({ ...BASE, time_spec: null }, "u1", db);
    expect(reply).toMatch(/when/i);
  });

  it("returns error for unparseable datetime_iso", () => {
    const reply = handleCreateRule(
      { ...BASE, time_spec: { datetime_iso: "not-a-date" } },
      "u1",
      db
    );
    expect(reply).toMatch(/could not parse/i);
  });
});

describe("handleCreateRule — arrival", () => {
  it("creates an arrival rule for a registered user", () => {
    seedPerson("u1");
    const intent: Intent = {
      ...BASE,
      trigger: "arrival",
      time_spec: null,
      message: "welcome home",
    };
    const reply = handleCreateRule(intent, "u1", db);
    expect(reply).toMatch(/rule created/i);
    expect(reply).toMatch(/arrive/i);

    const rule = db.prepare("SELECT trigger_type FROM rules WHERE id = 1").get() as {
      trigger_type: string;
    };
    expect(rule.trigger_type).toBe("arrival");
  });

  it("returns error when user is not registered", () => {
    const intent: Intent = {
      ...BASE,
      trigger: "arrival",
      time_spec: null,
      message: "welcome home",
    };
    const reply = handleCreateRule(intent, "unknown-user", db);
    expect(reply).toMatch(/register/i);
  });
});

// ── multi-person + presence-gated ─────────────────────────────────────────────

describe("handleCreateRule — multi-person + require_home", () => {
  it("stores target_person_id when person ref is name and person exists", () => {
    const aliceId = seedPerson("u2", "Alice");
    const intent: Intent = {
      ...BASE,
      person: { ref: "name", name: "Alice" },
    };
    const reply = handleCreateRule(intent, "u1", db);
    expect(reply).toMatch(/rule created/i);
    expect(reply).toMatch(/Alice/);

    const rule = db.prepare("SELECT action_json FROM rules WHERE id = 1").get() as {
      action_json: string;
    };
    const action = JSON.parse(rule.action_json);
    expect(action.target_person_id).toBe(aliceId);
  });

  it("returns error when named person is not registered", () => {
    const reply = handleCreateRule(
      { ...BASE, person: { ref: "name", name: "Bob" } },
      "u1",
      db
    );
    expect(reply).toMatch(/don't know who/i);
  });

  it("stores require_home in action_json when set", () => {
    const reply = handleCreateRule({ ...BASE, require_home: true }, "u1", db);
    expect(reply).toMatch(/rule created/i);
    expect(reply).toMatch(/only if/i);

    const rule = db.prepare("SELECT action_json FROM rules WHERE id = 1").get() as {
      action_json: string;
    };
    const action = JSON.parse(rule.action_json);
    expect(action.require_home).toBe(true);
  });

  it("omits require_home from action_json when false", () => {
    handleCreateRule(BASE, "u1", db);
    const rule = db.prepare("SELECT action_json FROM rules WHERE id = 1").get() as {
      action_json: string;
    };
    const action = JSON.parse(rule.action_json);
    expect(action.require_home).toBeUndefined();
  });
});

// ── list_rules ────────────────────────────────────────────────────────────────

describe("handleListRules", () => {
  it("returns 'No rules yet' when empty", () => {
    expect(handleListRules(db)).toBe("No rules yet.");
  });

  it("lists created rules", () => {
    handleCreateRule(BASE, "u1", db);
    const reply = handleListRules(db);
    expect(reply).toMatch(/#1/);
    expect(reply).toMatch(/time/);
    expect(reply).toMatch(/take out the trash/);
  });

  it("lists multiple rules", () => {
    handleCreateRule(BASE, "u1", db);
    handleCreateRule({ ...BASE, message: "pay bills" }, "u1", db);
    const lines = handleListRules(db).split("\n");
    expect(lines).toHaveLength(2);
  });
});

// ── delete_rule ───────────────────────────────────────────────────────────────

describe("handleDeleteRule", () => {
  it("deletes an existing rule", () => {
    handleCreateRule(BASE, "u1", db);
    const reply = handleDeleteRule(
      { ...BASE, intent: "delete_rule", message: "1" },
      db
    );
    expect(reply).toMatch(/deleted rule #1/i);
    expect(db.prepare("SELECT id FROM rules").all()).toHaveLength(0);
  });

  it("cascades delete to scheduled_jobs", () => {
    handleCreateRule(BASE, "u1", db);
    handleDeleteRule({ ...BASE, intent: "delete_rule", message: "1" }, db);
    expect(db.prepare("SELECT id FROM scheduled_jobs").all()).toHaveLength(0);
  });

  it("returns not found for unknown id", () => {
    const reply = handleDeleteRule(
      { ...BASE, intent: "delete_rule", message: "99" },
      db
    );
    expect(reply).toMatch(/not found/i);
  });

  it("returns guidance when message is not a number", () => {
    const reply = handleDeleteRule(
      { ...BASE, intent: "delete_rule", message: "trash rule" },
      db
    );
    expect(reply).toMatch(/rule number/i);
  });
});

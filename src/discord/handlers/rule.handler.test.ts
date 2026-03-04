import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../storage/db.js";
import {
  handleCreateRule,
  handleListRules,
  handleDeleteRule,
  formatIsoLocal,
} from "./rule.handler.js";
import type { Intent } from "../intent.schema.js";

const { mockCreateCalendarEvent } = vi.hoisted(() => ({
  mockCreateCalendarEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../gcal/gcal.client.js", () => ({
  createCalendarEvent: mockCreateCalendarEvent,
}));

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
  device: null,
  device_alias: null,
  confidence: 0.95,
  clarifying_question: null,
};

const DEVICE_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function seedDevice(name: string, uuid: string): void {
  db.prepare(
    "INSERT INTO smart_devices (name, smartthings_device_id) VALUES (?, ?)"
  ).run(name, uuid);
}

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
  mockCreateCalendarEvent.mockClear();
});

// ── formatIsoLocal ────────────────────────────────────────────────────────────

describe("formatIsoLocal", () => {
  it("shows the local time from the ISO string, not the UTC equivalent", () => {
    // 22:00 Jerusalem (+02:00) — UTC equivalent would be 20:00 (8 PM); must show 22:00 (10 PM)
    const result = formatIsoLocal("2026-03-02T22:00:00+02:00");
    expect(result).toMatch(/22:00|10:00/); // 24h or 12h AM/PM format
    expect(result).not.toMatch(/20:00|8:00 PM/);
  });

  it("works for UTC offset (+00:00)", () => {
    const result = formatIsoLocal("2026-03-02T08:00:00+00:00");
    expect(result).toMatch(/08:00|8:00/);
  });

  it("works for Z suffix", () => {
    const result = formatIsoLocal("2026-03-02T08:00:00Z");
    expect(result).toMatch(/08:00|8:00/);
  });

  it("works for negative offset", () => {
    // 15:00 New York (UTC-5) — UTC equivalent would be 20:00 (8 PM); must show 15:00 (3 PM)
    const result = formatIsoLocal("2026-03-02T15:00:00-05:00");
    expect(result).toMatch(/15:00|3:00/); // 24h or 12h AM/PM format
    expect(result).not.toMatch(/20:00|8:00 PM/);
  });
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

// ── GCal integration ──────────────────────────────────────────────────────────

describe("handleCreateRule — GCal integration", () => {
  it("calls createCalendarEvent when gcalKeyFile and datetime_iso are present", async () => {
    seedPerson("u1");
    handleCreateRule(BASE, "u1", db, "/fake/key.json");
    // fire-and-forget: yield to microtask queue
    await Promise.resolve();
    expect(mockCreateCalendarEvent).toHaveBeenCalledOnce();
    const [personId, , keyFile, event] = mockCreateCalendarEvent.mock.calls[0];
    expect(keyFile).toBe("/fake/key.json");
    expect(event.summary).toBe("take out the trash");
    expect(event.startIso).toBe("2099-06-01T08:00:00");
  });

  it("does not call createCalendarEvent for arrival rules", async () => {
    seedPerson("u1");
    const intent: Intent = {
      ...BASE,
      trigger: "arrival",
      time_spec: null,
      message: "welcome home",
    };
    handleCreateRule(intent, "u1", db, "/fake/key.json");
    await Promise.resolve();
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });

  it("does not call createCalendarEvent for cron rules", async () => {
    const intent: Intent = { ...BASE, time_spec: { cron: "0 8 * * *" } };
    handleCreateRule(intent, "u1", db, "/fake/key.json");
    await Promise.resolve();
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });

  it("rule is created and reply returned even if GCal throws", async () => {
    seedPerson("u1");
    mockCreateCalendarEvent.mockRejectedValueOnce(new Error("GCal network error"));
    const reply = handleCreateRule(BASE, "u1", db, "/fake/key.json");
    expect(reply).toMatch(/rule created/i);
    // Let the rejected promise flush — no unhandled rejection should propagate
    await Promise.resolve();
  });

  it("does not call createCalendarEvent when gcalKeyFile is absent", async () => {
    seedPerson("u1");
    handleCreateRule(BASE, "u1", db);
    await Promise.resolve();
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });
});

// ── device_control rules ──────────────────────────────────────────────────────

describe("handleCreateRule — device_control time rule", () => {
  it("creates rule with action_type=device_control and UUID in action_json", () => {
    seedDevice("tv", DEVICE_UUID);
    const intent: Intent = {
      ...BASE,
      action: "device_control",
      message: null,
      device: { name: "tv", command: "on" },
    };
    const reply = handleCreateRule(intent, "u1", db);
    expect(reply).toMatch(/rule created/i);
    expect(reply).toMatch(/#1/);

    const rule = db.prepare("SELECT action_type, action_json FROM rules WHERE id = 1").get() as {
      action_type: string;
      action_json: string;
    };
    expect(rule.action_type).toBe("device_control");
    const action = JSON.parse(rule.action_json);
    expect(action.smartthings_device_id).toBe(DEVICE_UUID);
    expect(action.command).toBe("on");
    // Name must NOT be stored — UUID only
    expect(action.name).toBeUndefined();
  });

  it("creates a scheduled_jobs row for time trigger", () => {
    seedDevice("tv", DEVICE_UUID);
    const intent: Intent = {
      ...BASE,
      action: "device_control",
      message: null,
      device: { name: "tv", command: "on" },
    };
    handleCreateRule(intent, "u1", db);
    const job = db
      .prepare("SELECT status, next_run_ts FROM scheduled_jobs WHERE rule_id = 1")
      .get() as { status: string; next_run_ts: number };
    expect(job.status).toBe("pending");
    expect(job.next_run_ts).toBeGreaterThan(0);
  });

  it("returns error when device is null", () => {
    const intent: Intent = {
      ...BASE,
      action: "device_control",
      message: null,
      device: null,
    };
    const reply = handleCreateRule(intent, "u1", db);
    expect(reply).toMatch(/which device/i);
  });

  it("returns error when device is not registered", () => {
    const intent: Intent = {
      ...BASE,
      action: "device_control",
      message: null,
      device: { name: "lights", command: "on" },
    };
    const reply = handleCreateRule(intent, "u1", db);
    expect(reply).toMatch(/don't know a device/i);
  });
});

describe("handleCreateRule — device_control arrival rule", () => {
  it("creates arrival rule with action_type=device_control", () => {
    seedPerson("u1");
    seedDevice("lights", DEVICE_UUID);
    const intent: Intent = {
      ...BASE,
      trigger: "arrival",
      action: "device_control",
      message: null,
      time_spec: null,
      device: { name: "lights", command: "on" },
    };
    const reply = handleCreateRule(intent, "u1", db);
    expect(reply).toMatch(/rule created/i);
    expect(reply).toMatch(/arrive home/i);

    const rule = db.prepare("SELECT action_type, trigger_type, action_json FROM rules WHERE id = 1").get() as {
      action_type: string;
      trigger_type: string;
      action_json: string;
    };
    expect(rule.action_type).toBe("device_control");
    expect(rule.trigger_type).toBe("arrival");
    const action = JSON.parse(rule.action_json);
    expect(action.smartthings_device_id).toBe(DEVICE_UUID);
  });

  it("returns error when user is not registered", () => {
    seedDevice("lights", DEVICE_UUID);
    const intent: Intent = {
      ...BASE,
      trigger: "arrival",
      action: "device_control",
      message: null,
      time_spec: null,
      device: { name: "lights", command: "on" },
    };
    const reply = handleCreateRule(intent, "unknown-user", db);
    expect(reply).toMatch(/register/i);
  });
});

describe("handleCreateRule — device_control with value", () => {
  it("stores value in action_json for setVolume rule", () => {
    seedDevice("tv", DEVICE_UUID);
    const intent: Intent = {
      ...BASE,
      action: "device_control",
      message: null,
      device: { name: "tv", command: "setVolume", value: 30 },
    };
    handleCreateRule(intent, "u1", db);
    const rule = db.prepare("SELECT action_json FROM rules WHERE id = 1").get() as {
      action_json: string;
    };
    const action = JSON.parse(rule.action_json);
    expect(action.command).toBe("setVolume");
    expect(action.value).toBe(30);
  });

  it("omits value from action_json for on/off rules", () => {
    seedDevice("tv", DEVICE_UUID);
    const intent: Intent = {
      ...BASE,
      action: "device_control",
      message: null,
      device: { name: "tv", command: "on" },
    };
    handleCreateRule(intent, "u1", db);
    const rule = db.prepare("SELECT action_json FROM rules WHERE id = 1").get() as {
      action_json: string;
    };
    const action = JSON.parse(rule.action_json);
    expect(action.command).toBe("on");
    expect(action.value).toBeUndefined();
  });
});

// ── HA device_control rules ───────────────────────────────────────────────────

const HA_ENTITY_ID = "climate.tadiran_ac";

function seedHADevice(name: string, entityId: string): void {
  db.prepare("INSERT INTO ha_devices (name, entity_id) VALUES (?, ?)").run(name, entityId);
}

describe("handleCreateRule — device_control HA time rule", () => {
  it("stores ha_entity_id in action_json for HA device", () => {
    seedHADevice("ac", HA_ENTITY_ID);
    const intent: Intent = {
      ...BASE,
      action: "device_control",
      message: null,
      device: { name: "ac", command: "on" },
    };
    handleCreateRule(intent, "u1", db);
    const rule = db.prepare("SELECT action_type, action_json FROM rules WHERE id = 1").get() as {
      action_type: string;
      action_json: string;
    };
    expect(rule.action_type).toBe("device_control");
    const action = JSON.parse(rule.action_json);
    expect(action.ha_entity_id).toBe(HA_ENTITY_ID);
    expect(action.command).toBe("on");
    expect(action.smartthings_device_id).toBeUndefined();
  });

  it("prefers SmartThings when device exists in both tables", () => {
    seedDevice("ac", DEVICE_UUID);
    seedHADevice("ac", HA_ENTITY_ID);
    const intent: Intent = {
      ...BASE,
      action: "device_control",
      message: null,
      device: { name: "ac", command: "on" },
    };
    handleCreateRule(intent, "u1", db);
    const rule = db.prepare("SELECT action_json FROM rules WHERE id = 1").get() as { action_json: string };
    const action = JSON.parse(rule.action_json);
    expect(action.smartthings_device_id).toBe(DEVICE_UUID);
    expect(action.ha_entity_id).toBeUndefined();
  });

  it("returns error when device is not in either table", () => {
    const intent: Intent = {
      ...BASE,
      action: "device_control",
      message: null,
      device: { name: "purifier", command: "on" },
    };
    const reply = handleCreateRule(intent, "u1", db);
    expect(reply).toMatch(/don't know a device/i);
  });

  it("includes 'set mode to' in confirmation for setMode command on HA device", () => {
    seedHADevice("purifier", "fan.xiaomi_purifier");
    const intent: Intent = {
      ...BASE,
      trigger: "time",
      action: "device_control",
      message: null,
      time_spec: { datetime_iso: "2099-06-01T20:00:00+03:00" },
      device: { name: "purifier", command: "setMode", value: "Auto" },
    };
    const reply = handleCreateRule(intent, "u1", db);
    expect(reply).toMatch(/set mode to Auto on purifier/i);
  });
});

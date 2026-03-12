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
  device_room: null,
  ha_entity_ids: null,
  ha_domain_filter: null,
  condition_entity_id: null,
  condition_state: null,
  condition_operator: null,
  condition_threshold: null,
  duration_sec: null,
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
  it("shows the local time from the ISO string, not the UTC equivalent", async () => {
    // 22:00 Jerusalem (+02:00) — UTC equivalent would be 20:00 (8 PM); must show 22:00 (10 PM)
    const result = formatIsoLocal("2026-03-02T22:00:00+02:00");
    expect(result).toMatch(/22:00|10:00/); // 24h or 12h AM/PM format
    expect(result).not.toMatch(/20:00|8:00 PM/);
  });

  it("works for UTC offset (+00:00)", async () => {
    const result = formatIsoLocal("2026-03-02T08:00:00+00:00");
    expect(result).toMatch(/08:00|8:00/);
  });

  it("works for Z suffix", async () => {
    const result = formatIsoLocal("2026-03-02T08:00:00Z");
    expect(result).toMatch(/08:00|8:00/);
  });

  it("works for negative offset", async () => {
    // 15:00 New York (UTC-5) — UTC equivalent would be 20:00 (8 PM); must show 15:00 (3 PM)
    const result = formatIsoLocal("2026-03-02T15:00:00-05:00");
    expect(result).toMatch(/15:00|3:00/); // 24h or 12h AM/PM format
    expect(result).not.toMatch(/20:00|8:00 PM/);
  });
});

// ── create_rule ───────────────────────────────────────────────────────────────

describe("handleCreateRule — time", () => {
  it("creates a time rule and scheduled_job", async () => {
    const reply = await handleCreateRule(BASE, "u1", db);
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

  it("stores computed next_run_ts for cron trigger", async () => {
    const intent: Intent = {
      ...BASE,
      time_spec: { cron: "0 8 * * *" },
    };
    await handleCreateRule(intent, "u1", db);
    const job = db
      .prepare("SELECT next_run_ts FROM scheduled_jobs WHERE rule_id = 1")
      .get() as { next_run_ts: number | null };
    expect(job.next_run_ts).not.toBeNull();
    expect(job.next_run_ts).toBeGreaterThan(0);
  });

  it("returns error for invalid cron expression", async () => {
    const reply = await handleCreateRule(
      { ...BASE, time_spec: { cron: "/5 * * *" } },
      "u1",
      db
    );
    expect(reply).toMatch(/invalid cron/i);
    expect(reply).toMatch(/5 fields/i);
  });

  it("returns error when message is missing", async () => {
    const reply = await handleCreateRule({ ...BASE, message: null }, "u1", db);
    expect(reply).toMatch(/message/i);
  });

  it("returns error when time_spec is missing", async () => {
    const reply = await handleCreateRule({ ...BASE, time_spec: null }, "u1", db);
    expect(reply).toMatch(/when/i);
  });

  it("returns error for unparseable datetime_iso", async () => {
    const reply = await handleCreateRule(
      { ...BASE, time_spec: { datetime_iso: "not-a-date" } },
      "u1",
      db
    );
    expect(reply).toMatch(/could not parse/i);
  });
});

describe("handleCreateRule — arrival", () => {
  it("creates an arrival rule for a registered user", async () => {
    seedPerson("u1");
    const intent: Intent = {
      ...BASE,
      trigger: "arrival",
      time_spec: null,
      message: "welcome home",
    };
    const reply = await handleCreateRule(intent, "u1", db);
    expect(reply).toMatch(/rule created/i);
    expect(reply).toMatch(/arrive/i);

    const rule = db.prepare("SELECT trigger_type FROM rules WHERE id = 1").get() as {
      trigger_type: string;
    };
    expect(rule.trigger_type).toBe("arrival");
  });

  it("returns error when user is not registered", async () => {
    const intent: Intent = {
      ...BASE,
      trigger: "arrival",
      time_spec: null,
      message: "welcome home",
    };
    const reply = await handleCreateRule(intent, "unknown-user", db);
    expect(reply).toMatch(/register/i);
  });
});

// ── multi-person + presence-gated ─────────────────────────────────────────────

describe("handleCreateRule — multi-person + require_home", () => {
  it("stores target_person_id when person ref is name and person exists", async () => {
    const aliceId = seedPerson("u2", "Alice");
    const intent: Intent = {
      ...BASE,
      person: { ref: "name", name: "Alice" },
    };
    const reply = await handleCreateRule(intent, "u1", db);
    expect(reply).toMatch(/rule created/i);
    expect(reply).toMatch(/Alice/);

    const rule = db.prepare("SELECT action_json FROM rules WHERE id = 1").get() as {
      action_json: string;
    };
    const action = JSON.parse(rule.action_json);
    expect(action.target_person_id).toBe(aliceId);
  });

  it("returns error when named person is not registered", async () => {
    const reply = await handleCreateRule(
      { ...BASE, person: { ref: "name", name: "Bob" } },
      "u1",
      db
    );
    expect(reply).toMatch(/don't know who/i);
  });

  it("stores require_home in action_json when set", async () => {
    const reply = await handleCreateRule({ ...BASE, require_home: true }, "u1", db);
    expect(reply).toMatch(/rule created/i);
    expect(reply).toMatch(/only if/i);

    const rule = db.prepare("SELECT action_json FROM rules WHERE id = 1").get() as {
      action_json: string;
    };
    const action = JSON.parse(rule.action_json);
    expect(action.require_home).toBe(true);
  });

  it("omits require_home from action_json when false", async () => {
    await handleCreateRule(BASE, "u1", db);
    const rule = db.prepare("SELECT action_json FROM rules WHERE id = 1").get() as {
      action_json: string;
    };
    const action = JSON.parse(rule.action_json);
    expect(action.require_home).toBeUndefined();
  });
});

// ── list_rules ────────────────────────────────────────────────────────────────

describe("handleListRules", () => {
  it("returns 'No rules yet' when empty", async () => {
    expect(handleListRules(db)).toBe("No rules yet.");
  });

  it("lists created rules", async () => {
    await handleCreateRule(BASE, "u1", db);
    const reply = handleListRules(db);
    expect(reply).toMatch(/#1/);
    expect(reply).toMatch(/time/);
    expect(reply).toMatch(/take out the trash/);
  });

  it("lists multiple rules", async () => {
    await handleCreateRule(BASE, "u1", db);
    await handleCreateRule({ ...BASE, message: "pay bills" }, "u1", db);
    const lines = handleListRules(db).split("\n");
    expect(lines).toHaveLength(2);
  });
});

// ── delete_rule ───────────────────────────────────────────────────────────────

describe("handleDeleteRule", () => {
  it("deletes an existing rule", async () => {
    await handleCreateRule(BASE, "u1", db);
    const reply = handleDeleteRule(
      { ...BASE, intent: "delete_rule", message: "1" },
      db
    );
    expect(reply).toMatch(/deleted rule #1/i);
    expect(db.prepare("SELECT id FROM rules").all()).toHaveLength(0);
  });

  it("cascades delete to scheduled_jobs", async () => {
    await handleCreateRule(BASE, "u1", db);
    handleDeleteRule({ ...BASE, intent: "delete_rule", message: "1" }, db);
    expect(db.prepare("SELECT id FROM scheduled_jobs").all()).toHaveLength(0);
  });

  it("returns not found for unknown id", async () => {
    const reply = handleDeleteRule(
      { ...BASE, intent: "delete_rule", message: "99" },
      db
    );
    expect(reply).toMatch(/not found/i);
  });

  it("returns guidance when message is not a number", async () => {
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
    await handleCreateRule(BASE, "u1", db, "/fake/key.json");
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
    await handleCreateRule(intent, "u1", db, "/fake/key.json");
    await Promise.resolve();
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });

  it("does not call createCalendarEvent for cron rules", async () => {
    const intent: Intent = { ...BASE, time_spec: { cron: "0 8 * * *" } };
    await handleCreateRule(intent, "u1", db, "/fake/key.json");
    await Promise.resolve();
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });

  it("rule is created and reply returned even if GCal throws", async () => {
    seedPerson("u1");
    mockCreateCalendarEvent.mockRejectedValueOnce(new Error("GCal network error"));
    const reply = await handleCreateRule(BASE, "u1", db, "/fake/key.json");
    expect(reply).toMatch(/rule created/i);
    // Let the rejected promise flush — no unhandled rejection should propagate
    await Promise.resolve();
  });

  it("does not call createCalendarEvent when gcalKeyFile is absent", async () => {
    seedPerson("u1");
    await handleCreateRule(BASE, "u1", db);
    await Promise.resolve();
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });
});

// ── device_control rules ──────────────────────────────────────────────────────

describe("handleCreateRule — device_control time rule", () => {
  it("creates rule with action_type=device_control and UUID in action_json", async () => {
    seedDevice("tv", DEVICE_UUID);
    const intent: Intent = {
      ...BASE,
      action: "device_control",
      message: null,
      device: { name: "tv", command: "on" },
    };
    const reply = await handleCreateRule(intent, "u1", db);
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

  it("creates a scheduled_jobs row for time trigger", async () => {
    seedDevice("tv", DEVICE_UUID);
    const intent: Intent = {
      ...BASE,
      action: "device_control",
      message: null,
      device: { name: "tv", command: "on" },
    };
    await handleCreateRule(intent, "u1", db);
    const job = db
      .prepare("SELECT status, next_run_ts FROM scheduled_jobs WHERE rule_id = 1")
      .get() as { status: string; next_run_ts: number };
    expect(job.status).toBe("pending");
    expect(job.next_run_ts).toBeGreaterThan(0);
  });

  it("returns error when device is null", async () => {
    const intent: Intent = {
      ...BASE,
      action: "device_control",
      message: null,
      device: null,
    };
    const reply = await handleCreateRule(intent, "u1", db);
    expect(reply).toMatch(/which device/i);
  });

  it("returns error when device is not registered", async () => {
    const intent: Intent = {
      ...BASE,
      action: "device_control",
      message: null,
      device: { name: "lights", command: "on" },
    };
    const reply = await handleCreateRule(intent, "u1", db);
    expect(reply).toMatch(/don't know a device/i);
  });
});

describe("handleCreateRule — device_control arrival rule", () => {
  it("creates arrival rule with action_type=device_control", async () => {
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
    const reply = await handleCreateRule(intent, "u1", db);
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

  it("returns error when user is not registered", async () => {
    seedDevice("lights", DEVICE_UUID);
    const intent: Intent = {
      ...BASE,
      trigger: "arrival",
      action: "device_control",
      message: null,
      time_spec: null,
      device: { name: "lights", command: "on" },
    };
    const reply = await handleCreateRule(intent, "unknown-user", db);
    expect(reply).toMatch(/register/i);
  });
});

describe("handleCreateRule — device_control with value", () => {
  it("stores value in action_json for setVolume rule", async () => {
    seedDevice("tv", DEVICE_UUID);
    const intent: Intent = {
      ...BASE,
      action: "device_control",
      message: null,
      device: { name: "tv", command: "setVolume", value: 30 },
    };
    await handleCreateRule(intent, "u1", db);
    const rule = db.prepare("SELECT action_json FROM rules WHERE id = 1").get() as {
      action_json: string;
    };
    const action = JSON.parse(rule.action_json);
    expect(action.command).toBe("setVolume");
    expect(action.value).toBe(30);
  });

  it("omits value from action_json for on/off rules", async () => {
    seedDevice("tv", DEVICE_UUID);
    const intent: Intent = {
      ...BASE,
      action: "device_control",
      message: null,
      device: { name: "tv", command: "on" },
    };
    await handleCreateRule(intent, "u1", db);
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
  it("stores ha_entity_id in action_json for HA device", async () => {
    seedHADevice("ac", HA_ENTITY_ID);
    const intent: Intent = {
      ...BASE,
      action: "device_control",
      message: null,
      device: { name: "ac", command: "on" },
    };
    await handleCreateRule(intent, "u1", db);
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

  it("prefers SmartThings when device exists in both tables", async () => {
    seedDevice("ac", DEVICE_UUID);
    seedHADevice("ac", HA_ENTITY_ID);
    const intent: Intent = {
      ...BASE,
      action: "device_control",
      message: null,
      device: { name: "ac", command: "on" },
    };
    await handleCreateRule(intent, "u1", db);
    const rule = db.prepare("SELECT action_json FROM rules WHERE id = 1").get() as { action_json: string };
    const action = JSON.parse(rule.action_json);
    expect(action.smartthings_device_id).toBe(DEVICE_UUID);
    expect(action.ha_entity_id).toBeUndefined();
  });

  it("returns error when device is not in either table", async () => {
    const intent: Intent = {
      ...BASE,
      action: "device_control",
      message: null,
      device: { name: "purifier", command: "on" },
    };
    const reply = await handleCreateRule(intent, "u1", db);
    expect(reply).toMatch(/don't know a device/i);
  });

  it("includes 'set mode to' in confirmation for setMode command on HA device", async () => {
    seedHADevice("purifier", "fan.xiaomi_purifier");
    const intent: Intent = {
      ...BASE,
      trigger: "time",
      action: "device_control",
      message: null,
      time_spec: { datetime_iso: "2099-06-01T20:00:00+03:00" },
      device: { name: "purifier", command: "setMode", value: "Auto" },
    };
    const reply = await handleCreateRule(intent, "u1", db);
    expect(reply).toMatch(/set mode to Auto on purifier/i);
  });
});

describe("handleCreateRule — condition trigger", () => {
  beforeEach(() => {
    db = openDb(":memory:");
  });

  function seedHADevice(name: string, entityId: string): void {
    db.prepare("INSERT INTO ha_devices (name, entity_id) VALUES (?, ?)").run(name, entityId);
  }

  const CONDITION_BASE: Intent = {
    ...BASE,
    trigger: "condition",
    action: "notify",
    message: "TV has been on for 2 hours",
    time_spec: null,
    condition_entity_id: "media_player.samsung_tv",
    condition_state: "on",
    condition_operator: null,
    condition_threshold: null,
    duration_sec: 7200,
  };

  it("creates a condition+notify rule and returns confirmation", async () => {
    const reply = await handleCreateRule(CONDITION_BASE, "u1", db);
    expect(reply).toMatch(/rule created/i);
    expect(reply).toMatch(/#\d+/);
    const rule = db.prepare("SELECT * FROM rules").get() as { trigger_type: string; action_type: string };
    expect(rule.trigger_type).toBe("condition");
    expect(rule.action_type).toBe("notify");
  });

  it("stores condition fields in action_json", async () => {
    await handleCreateRule(CONDITION_BASE, "u1", db);
    const rule = db.prepare("SELECT action_json FROM rules").get() as { action_json: string };
    const action = JSON.parse(rule.action_json);
    expect(action.condition_entity_id).toBe("media_player.samsung_tv");
    expect(action.condition_state).toBe("on");
    expect(action.duration_sec).toBe(7200);
    expect(action.message).toBe("TV has been on for 2 hours");
  });

  it("creates a condition+device_control rule for HA device", async () => {
    seedHADevice("ac", "climate.ac");
    const intent: Intent = {
      ...CONDITION_BASE,
      action: "device_control",
      message: null,
      condition_entity_id: "climate.ac",
      condition_operator: ">",
      condition_threshold: 26,
      condition_state: null,
      duration_sec: 0,
      device: { name: "ac", command: "setTemperature", value: 24 },
    };
    const reply = await handleCreateRule(intent, "u1", db);
    expect(reply).toMatch(/rule created/i);
    const rule = db.prepare("SELECT action_json FROM rules").get() as { action_json: string };
    const action = JSON.parse(rule.action_json);
    expect(action.ha_entity_id).toBe("climate.ac");
    expect(action.command).toBe("setTemperature");
    expect(action.value).toBe(24);
    expect(action.condition_operator).toBe(">");
    expect(action.condition_threshold).toBe(26);
  });

  it("returns error when condition_entity_id is missing", async () => {
    const intent: Intent = { ...CONDITION_BASE, condition_entity_id: null };
    const reply = await handleCreateRule(intent, "u1", db);
    expect(reply).toMatch(/which device/i);
  });

  it("returns error when neither condition_state nor threshold is set", async () => {
    const intent: Intent = { ...CONDITION_BASE, condition_state: null, condition_operator: null, condition_threshold: null };
    const reply = await handleCreateRule(intent, "u1", db);
    expect(reply).toMatch(/condition/i);
  });

  it("shows condition rule in list_rules as 'on condition'", async () => {
    await handleCreateRule(CONDITION_BASE, "u1", db);
    const reply = handleListRules(db);
    expect(reply).toMatch(/condition/i);
  });
});

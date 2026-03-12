import { describe, it, expect, beforeEach, vi, type MockedFunction } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../storage/db.js";
import { Scheduler } from "./scheduler.js";

let db: Database.Database;

function seedTimeRule(
  message: string,
  nextRunTs: number,
  cronExpr?: string
): number {
  const triggerJson = cronExpr
    ? JSON.stringify({ cron: cronExpr })
    : JSON.stringify({ datetime_iso: new Date(nextRunTs * 1000).toISOString() });
  const actionJson = JSON.stringify({ message });

  const rule = db
    .prepare(
      `INSERT INTO rules (name, trigger_type, trigger_json, action_type, action_json)
       VALUES (?, 'time', ?, 'notify', ?)`
    )
    .run(`time: ${message}`, triggerJson, actionJson);

  const ruleId = rule.lastInsertRowid as number;
  db.prepare(
    `INSERT INTO scheduled_jobs (rule_id, next_run_ts, status) VALUES (?, ?, 'pending')`
  ).run(ruleId, nextRunTs);

  return ruleId;
}

beforeEach(() => {
  db = openDb(":memory:");
});

describe("Scheduler.tick", () => {
  it("does nothing when no jobs are due", async () => {
    const send = vi.fn();
    seedTimeRule("trash", 2000); // due at t=2000
    await new Scheduler(db, send).tick(1000); // check at t=1000
    expect(send).not.toHaveBeenCalled();
  });

  it("fires a due job and marks it done", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    seedTimeRule("trash", 1000);
    await new Scheduler(db, send).tick(1000);

    expect(send).toHaveBeenCalledWith("trash");
    const job = db
      .prepare("SELECT status, last_run_ts FROM scheduled_jobs")
      .get() as { status: string; last_run_ts: number };
    expect(job.status).toBe("done");
    expect(job.last_run_ts).toBe(1000);
  });

  it("fires jobs due in the past", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    seedTimeRule("overdue", 500); // was due at t=500
    await new Scheduler(db, send).tick(2000);
    expect(send).toHaveBeenCalledWith("overdue");
  });

  it("fires multiple due jobs", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    seedTimeRule("msg1", 1000);
    seedTimeRule("msg2", 1000);
    await new Scheduler(db, send).tick(1000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("skips disabled rules", async () => {
    const send = vi.fn();
    seedTimeRule("trash", 1000);
    db.prepare("UPDATE rules SET enabled = 0").run();
    await new Scheduler(db, send).tick(1000);
    expect(send).not.toHaveBeenCalled();
  });

  it("skips already-done jobs", async () => {
    const send = vi.fn();
    seedTimeRule("trash", 1000);
    db.prepare("UPDATE scheduled_jobs SET status = 'done'").run();
    await new Scheduler(db, send).tick(2000);
    expect(send).not.toHaveBeenCalled();
  });

  it("reschedules cron job and keeps status pending", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const ruleId = seedTimeRule("daily", 1000, "0 8 * * *");
    // Override next_run_ts to a known past time
    db.prepare("UPDATE scheduled_jobs SET next_run_ts = 1000 WHERE rule_id = ?").run(ruleId);

    await new Scheduler(db, send).tick(1000);

    const job = db
      .prepare("SELECT status, next_run_ts FROM scheduled_jobs WHERE rule_id = ?")
      .get(ruleId) as { status: string; next_run_ts: number };
    expect(job.status).toBe("pending");
    expect(job.next_run_ts).toBeGreaterThan(1000);
    expect(send).toHaveBeenCalledWith("daily");
  });

  it("marks job as failed and records error on sendToChannel throw", async () => {
    const send = vi.fn().mockRejectedValue(new Error("discord down"));
    seedTimeRule("trash", 1000);
    await new Scheduler(db, send).tick(1000);

    const job = db
      .prepare("SELECT status, last_error FROM scheduled_jobs")
      .get() as { status: string; last_error: string };
    expect(job.status).toBe("failed");
    expect(job.last_error).toMatch(/discord down/);
  });

  it("calls playSoundFn when action has a sound field", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const play = vi.fn().mockResolvedValue(undefined);

    // Seed a rule with both message and sound
    const actionJson = JSON.stringify({ message: "alarm", sound: "/data/sounds/alarm.mp3" });
    const triggerJson = JSON.stringify({ datetime_iso: new Date(1000 * 1000).toISOString() });
    const rule = db
      .prepare(
        `INSERT INTO rules (name, trigger_type, trigger_json, action_type, action_json)
         VALUES ('test', 'time', ?, 'notify', ?)`
      )
      .run(triggerJson, actionJson);
    db.prepare(
      `INSERT INTO scheduled_jobs (rule_id, next_run_ts, status) VALUES (?, 1000, 'pending')`
    ).run(rule.lastInsertRowid);

    await new Scheduler(db, send, 30, play).tick(1000);

    expect(send).toHaveBeenCalledWith("alarm");
    expect(play).toHaveBeenCalledWith("/data/sounds/alarm.mp3");
  });

  it("does not call playSoundFn when action has no sound field", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const play = vi.fn();
    seedTimeRule("no sound here", 1000);
    await new Scheduler(db, send, 30, play).tick(1000);
    expect(play).not.toHaveBeenCalled();
  });
});

describe("Scheduler — multi-person @mention", () => {
  function seedPersonWithRule(
    discordUserId: string,
    name: string,
    message: string,
    nextRunTs: number
  ): number {
    db.prepare("INSERT INTO people (discord_user_id, name) VALUES (?, ?)").run(
      discordUserId,
      name
    );
    const personId = (
      db
        .prepare("SELECT id FROM people WHERE discord_user_id = ?")
        .get(discordUserId) as { id: number }
    ).id;

    const actionJson = JSON.stringify({ message, target_person_id: personId });
    const triggerJson = JSON.stringify({
      datetime_iso: new Date(nextRunTs * 1000).toISOString(),
    });
    const rule = db
      .prepare(
        `INSERT INTO rules (name, trigger_type, trigger_json, action_type, action_json)
         VALUES ('test', 'time', ?, 'notify', ?)`
      )
      .run(triggerJson, actionJson);
    db.prepare(
      `INSERT INTO scheduled_jobs (rule_id, next_run_ts, status) VALUES (?, ?, 'pending')`
    ).run(rule.lastInsertRowid, nextRunTs);

    return personId;
  }

  it("prepends @mention when target_person_id is set", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    seedPersonWithRule("u-alice", "Alice", "take medicine", 1000);
    await new Scheduler(db, send).tick(1000);
    expect(send).toHaveBeenCalledWith("<@u-alice> take medicine");
  });

  it("sends plain message when target_person_id is absent", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    seedTimeRule("plain message", 1000);
    await new Scheduler(db, send).tick(1000);
    expect(send).toHaveBeenCalledWith("plain message");
  });
});

describe("Scheduler — presence-gated rules", () => {
  function seedRequireHomeRule(
    discordUserId: string,
    name: string,
    message: string,
    nextRunTs: number,
    cronExpr?: string
  ) {
    db.prepare("INSERT INTO people (discord_user_id, name) VALUES (?, ?)").run(
      discordUserId,
      name
    );
    const personId = (
      db
        .prepare("SELECT id FROM people WHERE discord_user_id = ?")
        .get(discordUserId) as { id: number }
    ).id;

    const triggerJson = cronExpr
      ? JSON.stringify({ cron: cronExpr })
      : JSON.stringify({ datetime_iso: new Date(nextRunTs * 1000).toISOString() });
    const actionJson = JSON.stringify({
      message,
      target_person_id: personId,
      require_home: true,
    });
    const rule = db
      .prepare(
        `INSERT INTO rules (name, trigger_type, trigger_json, action_type, action_json)
         VALUES ('test', 'time', ?, 'notify', ?)`
      )
      .run(triggerJson, actionJson);
    db.prepare(
      `INSERT INTO scheduled_jobs (rule_id, next_run_ts, status) VALUES (?, ?, 'pending')`
    ).run(rule.lastInsertRowid, nextRunTs);

    return personId;
  }

  it("skips notification when target is away", async () => {
    const send = vi.fn();
    const personId = seedRequireHomeRule("u1", "Alice", "take medicine", 1000);
    const getPresence = () => new Map([[personId, "away" as const]]);
    await new Scheduler(db, send, 30, undefined, getPresence).tick(1000);
    expect(send).not.toHaveBeenCalled();
    const job = db.prepare("SELECT status FROM scheduled_jobs").get() as { status: string };
    expect(job.status).toBe("pending");
  });

  it("fires notification when target is home", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const personId = seedRequireHomeRule("u1", "Alice", "take medicine", 1000);
    const getPresence = () => new Map([[personId, "home" as const]]);
    await new Scheduler(db, send, 30, undefined, getPresence).tick(1000);
    expect(send).toHaveBeenCalledWith("<@u1> take medicine");
    const job = db.prepare("SELECT status FROM scheduled_jobs").get() as { status: string };
    expect(job.status).toBe("done");
  });

  it("skips when presence state is unknown (not in map)", async () => {
    const send = vi.fn();
    seedRequireHomeRule("u1", "Alice", "take medicine", 1000);
    const getPresence = () => new Map<number, "home" | "away">();
    await new Scheduler(db, send, 30, undefined, getPresence).tick(1000);
    expect(send).not.toHaveBeenCalled();
    const job = db.prepare("SELECT status FROM scheduled_jobs").get() as { status: string };
    expect(job.status).toBe("pending");
  });

  it("advances cron next_run_ts when away and skips firing", async () => {
    const send = vi.fn();
    const personId = seedRequireHomeRule("u1", "Alice", "daily", 1000, "0 8 * * *");
    // Override next_run_ts
    db.prepare("UPDATE scheduled_jobs SET next_run_ts = 1000").run();
    const getPresence = () => new Map([[personId, "away" as const]]);
    await new Scheduler(db, send, 30, undefined, getPresence).tick(1000);
    expect(send).not.toHaveBeenCalled();
    const job = db
      .prepare("SELECT status, next_run_ts FROM scheduled_jobs")
      .get() as { status: string; next_run_ts: number };
    expect(job.status).toBe("pending");
    expect(job.next_run_ts).toBeGreaterThan(1000);
  });
});

describe("Scheduler — device_control rules", () => {
  const DEVICE_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  function seedDeviceRule(
    deviceId: string,
    command: "on" | "off",
    nextRunTs: number
  ): number {
    db.prepare(
      "INSERT INTO smart_devices (name, smartthings_device_id) VALUES (?, ?)"
    ).run("tv", deviceId);

    const actionJson = JSON.stringify({ smartthings_device_id: deviceId, command });
    const triggerJson = JSON.stringify({ datetime_iso: new Date(nextRunTs * 1000).toISOString() });
    const rule = db
      .prepare(
        `INSERT INTO rules (name, trigger_type, trigger_json, action_type, action_json)
         VALUES ('test', 'time', ?, 'device_control', ?)`
      )
      .run(triggerJson, actionJson);
    const ruleId = rule.lastInsertRowid as number;
    db.prepare(
      `INSERT INTO scheduled_jobs (rule_id, next_run_ts, status) VALUES (?, ?, 'pending')`
    ).run(ruleId, nextRunTs);
    return ruleId;
  }

  it("calls controlDeviceFn with correct UUID and command", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const control = vi.fn().mockResolvedValue(undefined);
    seedDeviceRule(DEVICE_UUID, "on", 1000);
    await new Scheduler(db, send, 30, undefined, undefined, control).tick(1000);
    expect(control).toHaveBeenCalledWith(DEVICE_UUID, "on", undefined);
  });

  it("does not call sendToChannel for device_control jobs", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const control = vi.fn().mockResolvedValue(undefined);
    seedDeviceRule(DEVICE_UUID, "on", 1000);
    await new Scheduler(db, send, 30, undefined, undefined, control).tick(1000);
    expect(send).not.toHaveBeenCalled();
  });

  it("marks job done on success", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const control = vi.fn().mockResolvedValue(undefined);
    seedDeviceRule(DEVICE_UUID, "on", 1000);
    await new Scheduler(db, send, 30, undefined, undefined, control).tick(1000);
    const job = db
      .prepare("SELECT status FROM scheduled_jobs")
      .get() as { status: string };
    expect(job.status).toBe("done");
  });

  it("marks job failed when controlDeviceFn throws", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const control = vi.fn().mockRejectedValue(new Error("network error"));
    seedDeviceRule(DEVICE_UUID, "on", 1000);
    await new Scheduler(db, send, 30, undefined, undefined, control).tick(1000);
    const job = db
      .prepare("SELECT status, last_error FROM scheduled_jobs")
      .get() as { status: string; last_error: string };
    expect(job.status).toBe("failed");
    expect(job.last_error).toMatch(/network error/);
  });

  it("marks job done (with log) when controlDeviceFn not configured", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    seedDeviceRule(DEVICE_UUID, "on", 1000);
    // No controlDeviceFn passed
    await new Scheduler(db, send).tick(1000);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("device_control rule fired but SmartThings not configured")
    );
    const job = db
      .prepare("SELECT status FROM scheduled_jobs")
      .get() as { status: string };
    expect(job.status).toBe("done");
    consoleSpy.mockRestore();
  });

  it("passes value through to controlDeviceFn for setVolume job", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const control = vi.fn().mockResolvedValue(undefined);

    const actionJson = JSON.stringify({
      smartthings_device_id: DEVICE_UUID,
      command: "setVolume",
      value: 25,
    });
    const triggerJson = JSON.stringify({ datetime_iso: new Date(1000 * 1000).toISOString() });
    const rule = db
      .prepare(
        `INSERT INTO rules (name, trigger_type, trigger_json, action_type, action_json)
         VALUES ('test', 'time', ?, 'device_control', ?)`
      )
      .run(triggerJson, actionJson);
    db.prepare(
      `INSERT INTO scheduled_jobs (rule_id, next_run_ts, status) VALUES (?, 1000, 'pending')`
    ).run(rule.lastInsertRowid);

    await new Scheduler(db, send, 30, undefined, undefined, control).tick(1000);
    expect(control).toHaveBeenCalledWith(DEVICE_UUID, "setVolume", 25);
  });

  it("calls controlHAFn for ha_entity_id job", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const controlHA = vi.fn().mockResolvedValue(undefined);

    const actionJson = JSON.stringify({ ha_entity_id: "climate.tadiran_ac", command: "on" });
    const triggerJson = JSON.stringify({ datetime_iso: new Date(1000 * 1000).toISOString() });
    const rule = db
      .prepare(
        `INSERT INTO rules (name, trigger_type, trigger_json, action_type, action_json)
         VALUES ('test', 'time', ?, 'device_control', ?)`
      )
      .run(triggerJson, actionJson);
    db.prepare(
      `INSERT INTO scheduled_jobs (rule_id, next_run_ts, status) VALUES (?, 1000, 'pending')`
    ).run(rule.lastInsertRowid);

    await new Scheduler(db, send, 30, undefined, undefined, undefined, controlHA).tick(1000);
    expect(controlHA).toHaveBeenCalledWith("climate.tadiran_ac", "on", undefined);
    expect(send).not.toHaveBeenCalled();
  });

  it("marks HA job done on success", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const controlHA = vi.fn().mockResolvedValue(undefined);

    const actionJson = JSON.stringify({ ha_entity_id: "climate.tadiran_ac", command: "off" });
    const triggerJson = JSON.stringify({ datetime_iso: new Date(1000 * 1000).toISOString() });
    const rule = db
      .prepare(
        `INSERT INTO rules (name, trigger_type, trigger_json, action_type, action_json)
         VALUES ('test', 'time', ?, 'device_control', ?)`
      )
      .run(triggerJson, actionJson);
    db.prepare(
      `INSERT INTO scheduled_jobs (rule_id, next_run_ts, status) VALUES (?, 1000, 'pending')`
    ).run(rule.lastInsertRowid);

    await new Scheduler(db, send, 30, undefined, undefined, undefined, controlHA).tick(1000);
    const job = db.prepare("SELECT status FROM scheduled_jobs").get() as { status: string };
    expect(job.status).toBe("done");
  });
});

describe("Scheduler — task execution logging", () => {
  it("logs task_executions entry after rule fires", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const ruleId = seedTimeRule("morning reminder", 1000);
    await new Scheduler(db, send).tick(1000);
    const rows = db.prepare("SELECT * FROM task_executions WHERE rule_id = ?").all(ruleId) as Array<{ source: string; hour_of_day: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("scheduler");
  });

  it("does not log task_executions when job fails", async () => {
    const send = vi.fn().mockRejectedValue(new Error("discord down"));
    seedTimeRule("fail", 1000);
    await new Scheduler(db, send).tick(1000);
    const rows = db.prepare("SELECT * FROM task_executions").all();
    expect(rows).toHaveLength(0);
  });
});

describe("Scheduler — proactive suggestions", () => {
  // Use a nowSec aligned to an exact hour boundary so hoursUntil is predictable
  const nowSec = Math.floor(Date.now() / 3_600_000) * 3_600;
  const currentHour = new Date(nowSec * 1000).getHours();
  const targetHour = (currentHour + 12) % 24; // exactly 12h from now

  function seedManualExecutions(deviceName: string, command: string, hourOfDay: number, count: number): void {
    for (let i = 0; i < count; i++) {
      db.prepare(
        "INSERT INTO task_executions (user_id, source, device_name, command, hour_of_day) VALUES (?, 'manual', ?, ?, ?)"
      ).run("user-1", deviceName, command, hourOfDay);
    }
  }

  it("sends proactive suggestion when pattern >= 3 and exactly 12h window", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    seedManualExecutions("purifier", "on", targetHour, 3);
    await new Scheduler(db, send).tick(nowSec);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatch(/purifier/i);
    expect(send.mock.calls[0][0]).toMatch(/schedule/i);
  });

  it("does not suggest when count is below 3", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    seedManualExecutions("purifier", "on", targetHour, 2);
    await new Scheduler(db, send).tick(nowSec);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not send duplicate suggestion within 24h", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    seedManualExecutions("purifier", "on", targetHour, 3);
    const patternKey = `manual:purifier:on:${targetHour}`;
    db.prepare("INSERT INTO proactive_suggestions (pattern_key, suggested_at) VALUES (?, ?)").run(patternKey, nowSec - 3600);
    await new Scheduler(db, send).tick(nowSec);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends suggestion again after 24h cooldown has passed", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    seedManualExecutions("purifier", "on", targetHour, 3);
    const patternKey = `manual:purifier:on:${targetHour}`;
    db.prepare("INSERT INTO proactive_suggestions (pattern_key, suggested_at) VALUES (?, ?)").run(patternKey, nowSec - 90_000);
    await new Scheduler(db, send).tick(nowSec);
    expect(send).toHaveBeenCalledOnce();
  });

  it("does not suggest when hour is not in 11-13h window", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const farHour = (currentHour + 6) % 24; // only 6h away → outside window
    seedManualExecutions("purifier", "on", farHour, 5);
    await new Scheduler(db, send).tick(nowSec);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("Scheduler — condition rules", () => {
  function seedConditionRule(opts: {
    conditionEntityId: string;
    conditionState?: string;
    conditionOperator?: string;
    conditionThreshold?: number;
    durationSec: number;
    actionType: "notify" | "device_control";
    actionExtras: Record<string, unknown>;
  }): number {
    const actionJson = JSON.stringify({
      condition_entity_id: opts.conditionEntityId,
      ...(opts.conditionState !== undefined ? { condition_state: opts.conditionState } : {}),
      ...(opts.conditionOperator !== undefined ? { condition_operator: opts.conditionOperator } : {}),
      ...(opts.conditionThreshold !== undefined ? { condition_threshold: opts.conditionThreshold } : {}),
      duration_sec: opts.durationSec,
      ...opts.actionExtras,
    });
    const result = db
      .prepare(
        `INSERT INTO rules (name, trigger_type, trigger_json, action_type, action_json)
         VALUES (?, 'condition', '{}', ?, ?)`
      )
      .run(`condition: test`, opts.actionType, actionJson);
    return result.lastInsertRowid as number;
  }

  it("does nothing when queryHAFn not provided", async () => {
    const send = vi.fn();
    seedConditionRule({ conditionEntityId: "media_player.tv", conditionState: "on", durationSec: 0, actionType: "notify", actionExtras: { message: "TV is on" } });
    await new Scheduler(db, send).tick(1000);
    expect(send).not.toHaveBeenCalled();
  });

  it("fires notify immediately when condition met and duration=0", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockResolvedValue({ state: "on", attributes: {} });
    seedConditionRule({ conditionEntityId: "media_player.tv", conditionState: "on", durationSec: 0, actionType: "notify", actionExtras: { message: "TV is on" } });

    await new Scheduler(db, send, 30, undefined, undefined, undefined, undefined, query).tick(1000);
    expect(send).toHaveBeenCalledWith("TV is on");
  });

  it("sets condition_onset_ts on first met tick (duration > 0)", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockResolvedValue({ state: "on", attributes: {} });
    const ruleId = seedConditionRule({ conditionEntityId: "media_player.tv", conditionState: "on", durationSec: 7200, actionType: "notify", actionExtras: { message: "TV has been on" } });

    await new Scheduler(db, send, 30, undefined, undefined, undefined, undefined, query).tick(1000);
    expect(send).not.toHaveBeenCalled();
    const rule = db.prepare("SELECT condition_onset_ts FROM rules WHERE id = ?").get(ruleId) as { condition_onset_ts: number };
    expect(rule.condition_onset_ts).toBe(1000);
  });

  it("fires after duration elapses and resets onset_ts", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockResolvedValue({ state: "on", attributes: {} });
    const ruleId = seedConditionRule({ conditionEntityId: "media_player.tv", conditionState: "on", durationSec: 7200, actionType: "notify", actionExtras: { message: "TV has been on for 2h" } });
    db.prepare("UPDATE rules SET condition_onset_ts = ? WHERE id = ?").run(1000, ruleId);

    await new Scheduler(db, send, 30, undefined, undefined, undefined, undefined, query).tick(1000 + 7200);
    expect(send).toHaveBeenCalledWith("TV has been on for 2h");
    const rule = db.prepare("SELECT condition_onset_ts FROM rules WHERE id = ?").get(ruleId) as { condition_onset_ts: number | null };
    expect(rule.condition_onset_ts).toBeNull();
  });

  it("does not fire if duration not yet elapsed", async () => {
    const send = vi.fn();
    const query = vi.fn().mockResolvedValue({ state: "on", attributes: {} });
    const ruleId = seedConditionRule({ conditionEntityId: "media_player.tv", conditionState: "on", durationSec: 7200, actionType: "notify", actionExtras: { message: "TV on" } });
    db.prepare("UPDATE rules SET condition_onset_ts = ? WHERE id = ?").run(1000, ruleId);

    await new Scheduler(db, send, 30, undefined, undefined, undefined, undefined, query).tick(1000 + 3600);
    expect(send).not.toHaveBeenCalled();
  });

  it("resets onset_ts when condition is no longer met", async () => {
    const send = vi.fn();
    const query = vi.fn().mockResolvedValue({ state: "off", attributes: {} });
    const ruleId = seedConditionRule({ conditionEntityId: "media_player.tv", conditionState: "on", durationSec: 7200, actionType: "notify", actionExtras: { message: "TV on" } });
    db.prepare("UPDATE rules SET condition_onset_ts = ? WHERE id = ?").run(1000, ruleId);

    await new Scheduler(db, send, 30, undefined, undefined, undefined, undefined, query).tick(2000);
    const rule = db.prepare("SELECT condition_onset_ts FROM rules WHERE id = ?").get(ruleId) as { condition_onset_ts: number | null };
    expect(rule.condition_onset_ts).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("fires device_control when threshold condition met", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const controlHA = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockResolvedValue({ state: "27", attributes: {} });
    seedConditionRule({
      conditionEntityId: "sensor.ac_temp",
      conditionOperator: ">",
      conditionThreshold: 26,
      durationSec: 0,
      actionType: "device_control",
      actionExtras: { ha_entity_id: "climate.ac", command: "setTemperature", value: 24 },
    });

    await new Scheduler(db, send, 30, undefined, undefined, undefined, controlHA, query).tick(1000);
    expect(controlHA).toHaveBeenCalledWith("climate.ac", "setTemperature", 24);
  });

  it("does not fire when threshold condition not met", async () => {
    const send = vi.fn();
    const controlHA = vi.fn();
    const query = vi.fn().mockResolvedValue({ state: "24", attributes: {} });
    seedConditionRule({
      conditionEntityId: "sensor.ac_temp",
      conditionOperator: ">",
      conditionThreshold: 26,
      durationSec: 0,
      actionType: "device_control",
      actionExtras: { ha_entity_id: "climate.ac", command: "setTemperature", value: 24 },
    });

    await new Scheduler(db, send, 30, undefined, undefined, undefined, controlHA, query).tick(1000);
    expect(controlHA).not.toHaveBeenCalled();
  });

  it("skips disabled condition rules", async () => {
    const send = vi.fn();
    const query = vi.fn().mockResolvedValue({ state: "on", attributes: {} });
    const ruleId = seedConditionRule({ conditionEntityId: "media_player.tv", conditionState: "on", durationSec: 0, actionType: "notify", actionExtras: { message: "TV on" } });
    db.prepare("UPDATE rules SET enabled = 0 WHERE id = ?").run(ruleId);

    await new Scheduler(db, send, 30, undefined, undefined, undefined, undefined, query).tick(1000);
    expect(send).not.toHaveBeenCalled();
  });
});

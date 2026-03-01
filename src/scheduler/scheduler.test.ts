import { describe, it, expect, beforeEach, vi } from "vitest";
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

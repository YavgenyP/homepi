import { describe, it, expect } from "vitest";
import { openDb } from "./db.js";

function tables(db: ReturnType<typeof openDb>): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
  ).map((r) => r.name);
}

describe("openDb / migrations", () => {
  it("creates all expected tables", () => {
    const db = openDb(":memory:");
    const t = tables(db);
    expect(t).toContain("people");
    expect(t).toContain("person_devices");
    expect(t).toContain("presence_events");
    expect(t).toContain("rules");
    expect(t).toContain("scheduled_jobs");
    expect(t).toContain("llm_message_log");
    expect(t).toContain("_migrations");
    db.close();
  });

  it("records the migration as applied", () => {
    const db = openDb(":memory:");
    const rows = db.prepare("SELECT name FROM _migrations").all() as { name: string }[];
    expect(rows.map((r) => r.name)).toContain("001_init.sql");
    db.close();
  });

  it("is idempotent — running migrations twice does not throw", () => {
    const db = openDb(":memory:");
    expect(() => openDb(":memory:")).not.toThrow();
    db.close();
  });

  it("enforces foreign keys", () => {
    const db = openDb(":memory:");
    expect(() =>
      db
        .prepare("INSERT INTO person_devices (person_id, kind, value) VALUES (999, 'ping_ip', '1.2.3.4')")
        .run()
    ).toThrow();
    db.close();
  });

  it("enforces kind check constraint", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO people (discord_user_id, name) VALUES ('u1', 'Alice')").run();
    expect(() =>
      db
        .prepare("INSERT INTO person_devices (person_id, kind, value) VALUES (1, 'wifi', '1.2.3.4')")
        .run()
    ).toThrow();
    db.close();
  });

  it("can insert and retrieve a person", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO people (discord_user_id, name) VALUES ('u1', 'Alice')").run();
    const row = db.prepare("SELECT name FROM people WHERE discord_user_id = 'u1'").get() as { name: string };
    expect(row.name).toBe("Alice");
    db.close();
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../storage/db.js";
import type { Intent } from "../intent.schema.js";

// We test the save/delete logic by calling processCommand's switch branches
// indirectly — easiest is to extract the DB logic and test it directly.
// Since the logic lives inline in message.handler.ts, we test via the DB state.

const BASE: Intent = {
  intent: "save_shortcut",
  trigger: "none",
  action: "none",
  message: null,
  time_spec: null,
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
  volume: null,
  shortcut_name: null,
  shortcut_url: null,
  confidence: 0.95,
  clarifying_question: null,
};

let db: Database.Database;

beforeEach(() => {
  db = openDb(":memory:");
});

// Helpers that replicate the handler logic
function saveShortcut(name: string, url: string): void {
  db.prepare(
    "INSERT INTO sound_shortcuts (name, url) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET url=excluded.url"
  ).run(name.toLowerCase(), url);
}

function deleteShortcut(name: string): number {
  return db.prepare("DELETE FROM sound_shortcuts WHERE name = ?").run(name.toLowerCase()).changes;
}

function listShortcuts(): Array<{ name: string; url: string }> {
  return db.prepare("SELECT name, url FROM sound_shortcuts ORDER BY name").all() as Array<{ name: string; url: string }>;
}

describe("sound_shortcuts DB operations", () => {
  it("saves a shortcut", () => {
    saveShortcut("lofi", "https://youtube.com/lofi");
    expect(listShortcuts()).toEqual([{ name: "lofi", url: "https://youtube.com/lofi" }]);
  });

  it("upserts existing shortcut", () => {
    saveShortcut("lofi", "https://old.url");
    saveShortcut("lofi", "https://new.url");
    expect(listShortcuts()).toHaveLength(1);
    expect(listShortcuts()[0].url).toBe("https://new.url");
  });

  it("lowercases name on save", () => {
    saveShortcut("LoFi Radio", "https://x.com");
    expect(listShortcuts()[0].name).toBe("lofi radio");
  });

  it("deletes a shortcut and returns 1", () => {
    saveShortcut("jazz", "https://jazz.url");
    const changes = deleteShortcut("jazz");
    expect(changes).toBe(1);
    expect(listShortcuts()).toHaveLength(0);
  });

  it("returns 0 when shortcut not found", () => {
    const changes = deleteShortcut("nonexistent");
    expect(changes).toBe(0);
  });

  it("saves multiple shortcuts", () => {
    saveShortcut("lofi", "https://lofi.url");
    saveShortcut("jazz", "https://jazz.url");
    saveShortcut("pop", "https://pop.url");
    expect(listShortcuts()).toHaveLength(3);
  });
});

// Ensure Intent shape is valid (compile-time check)
describe("Intent BASE shape", () => {
  it("has all required fields", () => {
    const intent: Intent = { ...BASE, intent: "save_shortcut", shortcut_name: "lofi", shortcut_url: "https://x.com" };
    expect(intent.shortcut_name).toBe("lofi");
    expect(intent.shortcut_url).toBe("https://x.com");
  });

  it("delete_shortcut intent shape is valid", () => {
    const intent: Intent = { ...BASE, intent: "delete_shortcut", shortcut_name: "lofi" };
    expect(intent.intent).toBe("delete_shortcut");
    expect(intent.shortcut_name).toBe("lofi");
  });
});

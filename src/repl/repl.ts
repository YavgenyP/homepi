#!/usr/bin/env tsx
/**
 * homepi REPL — run via:  docker exec -it homepi npm run repl
 *
 * Opens the same SQLite DB as the main app (read-write, WAL mode).
 * Provides commands to inspect and control live state without restarting.
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { openDb } from "../storage/db.js";

const dbPath = process.env.SQLITE_PATH ?? "./app.db";
const db = openDb(dbPath);

const rl = readline.createInterface({ input, output });

function fmtTs(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

const commands: Record<string, (args: string[]) => void> = {
  help() {
    console.log(`
Commands:
  status              Current presence state for all people
  people              All people and their registered devices
  rules               All rules
  jobs                Scheduled jobs
  enable  <rule_id>   Enable a rule
  disable <rule_id>   Disable a rule
  delete  <rule_id>   Delete a rule (and its jobs)
  help                Show this help
  exit                Quit
`);
  },

  status() {
    const rows = db
      .prepare(
        `SELECT p.name, pe.state, pe.ts
         FROM people p
         LEFT JOIN presence_events pe ON pe.id = (
           SELECT id FROM presence_events
           WHERE person_id = p.id
           ORDER BY ts DESC LIMIT 1
         )
         ORDER BY p.name`
      )
      .all() as { name: string; state: string | null; ts: number | null }[];

    if (rows.length === 0) {
      console.log("No people registered.");
      return;
    }
    for (const r of rows) {
      const state = r.state ?? "unknown";
      const since = r.ts ? ` (since ${fmtTs(r.ts)})` : "";
      console.log(`  ${r.name}: ${state}${since}`);
    }
  },

  people() {
    const people = db
      .prepare("SELECT id, name, discord_user_id FROM people ORDER BY name")
      .all() as { id: number; name: string; discord_user_id: string }[];

    if (people.length === 0) {
      console.log("No people registered.");
      return;
    }
    for (const p of people) {
      console.log(`  #${p.id} ${p.name} (discord: ${p.discord_user_id})`);
      const devices = db
        .prepare(
          "SELECT kind, value FROM person_devices WHERE person_id = ? ORDER BY kind"
        )
        .all(p.id) as { kind: string; value: string }[];
      for (const d of devices) {
        console.log(`    ${d.kind}: ${d.value}`);
      }
    }
  },

  rules() {
    const rows = db
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

    if (rows.length === 0) {
      console.log("No rules.");
      return;
    }
    for (const r of rows) {
      const status = r.enabled ? "enabled" : "disabled";
      const trigger = JSON.parse(r.trigger_json);
      const action = JSON.parse(r.action_json);
      const triggerDesc =
        trigger.datetime_iso ?? trigger.cron ?? "on arrival";
      console.log(
        `  #${r.id} [${r.trigger_type}] ${triggerDesc} — "${action.message}" [${status}]`
      );
    }
  },

  jobs() {
    const rows = db
      .prepare(
        `SELECT j.id, j.rule_id, j.next_run_ts, j.status, j.last_run_ts, j.last_error
         FROM scheduled_jobs j ORDER BY j.id`
      )
      .all() as {
      id: number;
      rule_id: number;
      next_run_ts: number | null;
      status: string;
      last_run_ts: number | null;
      last_error: string | null;
    }[];

    if (rows.length === 0) {
      console.log("No scheduled jobs.");
      return;
    }
    for (const j of rows) {
      const next = fmtTs(j.next_run_ts);
      const last = j.last_run_ts ? ` last=${fmtTs(j.last_run_ts)}` : "";
      const err = j.last_error ? ` ERR: ${j.last_error}` : "";
      console.log(
        `  job#${j.id} rule#${j.rule_id} [${j.status}] next=${next}${last}${err}`
      );
    }
  },

  enable([id]) {
    if (!id) { console.log("Usage: enable <rule_id>"); return; }
    const info = db.prepare("UPDATE rules SET enabled=1 WHERE id=?").run(Number(id));
    if (info.changes === 0) console.log(`Rule #${id} not found.`);
    else console.log(`Rule #${id} enabled.`);
  },

  disable([id]) {
    if (!id) { console.log("Usage: disable <rule_id>"); return; }
    const info = db.prepare("UPDATE rules SET enabled=0 WHERE id=?").run(Number(id));
    if (info.changes === 0) console.log(`Rule #${id} not found.`);
    else console.log(`Rule #${id} disabled.`);
  },

  delete([id]) {
    if (!id) { console.log("Usage: delete <rule_id>"); return; }
    const info = db.prepare("DELETE FROM rules WHERE id=?").run(Number(id));
    if (info.changes === 0) console.log(`Rule #${id} not found.`);
    else console.log(`Rule #${id} deleted.`);
  },
};

async function main() {
  console.log(`homepi REPL — db: ${dbPath}`);
  console.log(`Type "help" for available commands.\n`);

  while (true) {
    let line: string;
    try {
      line = await rl.question("homepi> ");
    } catch {
      // Ctrl+D
      break;
    }

    const parts = line.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    if (!cmd) continue;
    if (cmd === "exit" || cmd === "quit") break;

    const handler = commands[cmd];
    if (!handler) {
      console.log(`Unknown command: "${cmd}". Type "help" for available commands.`);
      continue;
    }

    try {
      handler(args);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
    }
  }

  rl.close();
  db.close();
  console.log("Bye.");
}

main();

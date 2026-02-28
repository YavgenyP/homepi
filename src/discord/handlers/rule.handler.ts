import type Database from "better-sqlite3";
import type { Intent } from "../intent.schema.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function ruleName(triggerType: string, message: string): string {
  const snippet = message.length > 40 ? message.slice(0, 37) + "..." : message;
  return `${triggerType}: ${snippet}`;
}

function isoToUnix(iso: string): number | null {
  const ms = new Date(iso).getTime();
  return isNaN(ms) ? null : Math.floor(ms / 1000);
}

// ── create ────────────────────────────────────────────────────────────────────

export function handleCreateRule(
  intent: Intent,
  discordUserId: string,
  db: Database.Database
): string {
  const { trigger, message, time_spec } = intent;

  if (!message) {
    return "What should the notification say? Please include a message.";
  }

  if (trigger === "time") {
    if (!time_spec || (!time_spec.datetime_iso && !time_spec.cron)) {
      return "When should this reminder fire? Please specify a time.";
    }

    const triggerJson = JSON.stringify(time_spec);
    const actionJson = JSON.stringify({ message });
    const name = ruleName("time", message);

    const ruleResult = db
      .prepare(
        `INSERT INTO rules (name, trigger_type, trigger_json, action_type, action_json)
         VALUES (?, 'time', ?, 'notify', ?)`
      )
      .run(name, triggerJson, actionJson);

    const ruleId = ruleResult.lastInsertRowid as number;

    let nextRunTs: number | null = null;
    if (time_spec.datetime_iso) {
      nextRunTs = isoToUnix(time_spec.datetime_iso);
      if (nextRunTs === null) {
        return `Could not parse the time "${time_spec.datetime_iso}". Please try again.`;
      }
    }

    db.prepare(
      `INSERT INTO scheduled_jobs (rule_id, next_run_ts, status) VALUES (?, ?, 'pending')`
    ).run(ruleId, nextRunTs);

    const when = time_spec.datetime_iso
      ? new Date(time_spec.datetime_iso).toLocaleString()
      : `cron: ${time_spec.cron}`;

    return `Rule created (#${ruleId}): I'll remind you "${message}" at ${when}.`;
  }

  if (trigger === "arrival") {
    const personRow = db
      .prepare("SELECT id FROM people WHERE discord_user_id = ?")
      .get(discordUserId) as { id: number } | undefined;

    if (!personRow) {
      return "You need to register your device first. Use `register my phone <ip>`.";
    }

    const triggerJson = JSON.stringify({ person_id: personRow.id });
    const actionJson = JSON.stringify({ message });
    const name = ruleName("arrival", message);

    const ruleResult = db
      .prepare(
        `INSERT INTO rules (name, trigger_type, trigger_json, action_type, action_json)
         VALUES (?, 'arrival', ?, 'notify', ?)`
      )
      .run(name, triggerJson, actionJson);

    const ruleId = ruleResult.lastInsertRowid as number;
    return `Rule created (#${ruleId}): I'll notify you "${message}" when you arrive home.`;
  }

  return "I don't know how to create that kind of rule yet.";
}

// ── list ──────────────────────────────────────────────────────────────────────

type RuleRow = {
  id: number;
  name: string;
  trigger_type: string;
  action_json: string;
  next_run_ts: number | null;
};

export function handleListRules(db: Database.Database): string {
  const rows = db
    .prepare(
      `SELECT r.id, r.name, r.trigger_type, r.action_json,
              sj.next_run_ts
       FROM rules r
       LEFT JOIN scheduled_jobs sj ON sj.rule_id = r.id
       WHERE r.enabled = 1
       ORDER BY r.id`
    )
    .all() as RuleRow[];

  if (rows.length === 0) return "No rules yet.";

  return rows
    .map((r) => {
      const action = JSON.parse(r.action_json) as { message: string };
      const when =
        r.trigger_type === "arrival"
          ? "on arrival"
          : r.next_run_ts
          ? new Date(r.next_run_ts * 1000).toLocaleString()
          : "scheduled";
      return `#${r.id} [${r.trigger_type}] ${when} — "${action.message}"`;
    })
    .join("\n");
}

// ── delete ────────────────────────────────────────────────────────────────────

export function handleDeleteRule(
  intent: Intent,
  db: Database.Database
): string {
  const id = intent.message ? parseInt(intent.message, 10) : NaN;

  if (isNaN(id)) {
    return "Please specify the rule number. Use `list my rules` to see them.";
  }

  const rule = db
    .prepare("SELECT id FROM rules WHERE id = ?")
    .get(id) as { id: number } | undefined;

  if (!rule) return `Rule #${id} not found.`;

  db.prepare("DELETE FROM rules WHERE id = ?").run(id);
  return `Deleted rule #${id}.`;
}

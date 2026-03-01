import { CronExpressionParser } from "cron-parser";
import type Database from "better-sqlite3";
import type { Intent } from "../intent.schema.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function ruleName(triggerType: string, message: string | null, sound: string | null): string {
  const label = message ?? sound ?? "rule";
  const snippet = label.length > 40 ? label.slice(0, 37) + "..." : label;
  return `${triggerType}: ${snippet}`;
}

function isoToUnix(iso: string): number | null {
  const ms = new Date(iso).getTime();
  return isNaN(ms) ? null : Math.floor(ms / 1000);
}

function cronNextTs(cronExpr: string): number | null {
  // Standard cron must have exactly 5 space-separated fields
  if (cronExpr.trim().split(/\s+/).length !== 5) return null;
  try {
    const interval = CronExpressionParser.parse(cronExpr, { currentDate: new Date() });
    return Math.floor(interval.next().toDate().getTime() / 1000);
  } catch {
    return null;
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

type PersonRow = { id: number; discord_user_id: string; name: string };

function resolveTargetPerson(
  intent: Intent,
  discordUserId: string,
  db: Database.Database
): { person: PersonRow; error: null } | { person: null; error: string } {
  if (!intent.person || intent.person.ref === "me") {
    const row = db
      .prepare("SELECT id, discord_user_id, name FROM people WHERE discord_user_id = ?")
      .get(discordUserId) as PersonRow | undefined;
    return row ? { person: row, error: null } : { person: null, error: null };
  }

  const name = intent.person.name;
  if (!name) return { person: null, error: null };

  const row = db
    .prepare("SELECT id, discord_user_id, name FROM people WHERE LOWER(name) = LOWER(?)")
    .get(name) as PersonRow | undefined;

  if (!row) {
    return {
      person: null,
      error: `I don't know who "${name}" is. They need to register their device first.`,
    };
  }
  return { person: row, error: null };
}

// ── create ────────────────────────────────────────────────────────────────────

export function handleCreateRule(
  intent: Intent,
  discordUserId: string,
  db: Database.Database
): string {
  const { trigger, message, time_spec, sound_source, require_home } = intent;

  if (!message && !sound_source) {
    return "What should the notification say or play? Please include a message or a sound source (file path or URL).";
  }

  const { person: targetPerson, error: personError } = resolveTargetPerson(
    intent,
    discordUserId,
    db
  );
  if (personError) return personError;

  const targetPersonId = targetPerson?.id;
  const targetName = targetPerson?.name;
  const isSelf = !intent.person || intent.person.ref === "me";

  function buildActionJson() {
    return JSON.stringify({
      message,
      sound: sound_source ?? undefined,
      ...(targetPersonId !== undefined ? { target_person_id: targetPersonId } : {}),
      ...(require_home ? { require_home: true } : {}),
    });
  }

  if (trigger === "time") {
    if (!time_spec || (!time_spec.datetime_iso && !time_spec.cron)) {
      return "When should this reminder fire? Please specify a time.";
    }

    const triggerJson = JSON.stringify(time_spec);
    const actionJson = buildActionJson();
    const name = ruleName("time", message, sound_source);

    const ruleResult = db
      .prepare(
        `INSERT INTO rules (name, trigger_type, trigger_json, action_type, action_json)
         VALUES (?, 'time', ?, 'notify', ?)`
      )
      .run(name, triggerJson, actionJson);

    const ruleId = ruleResult.lastInsertRowid as number;

    let nextRunTs: number | null = null;
    let when: string;
    if (time_spec.datetime_iso) {
      nextRunTs = isoToUnix(time_spec.datetime_iso);
      if (nextRunTs === null) {
        return `Could not parse the time "${time_spec.datetime_iso}". Please try again.`;
      }
      when = new Date(time_spec.datetime_iso).toLocaleString();
    } else {
      // cron rule: compute first occurrence now so the scheduler picks it up
      nextRunTs = cronNextTs(time_spec.cron!);
      if (nextRunTs === null) {
        return `Invalid cron expression "${time_spec.cron}". A valid cron has 5 fields: minute hour day month weekday (e.g. \`0 20 * * *\` for 8pm daily).`;
      }
      when = `cron: ${time_spec.cron}`;
    }

    db.prepare(
      `INSERT INTO scheduled_jobs (rule_id, next_run_ts, status) VALUES (?, ?, 'pending')`
    ).run(ruleId, nextRunTs);

    const what = message ? `"${message}"` : "your sound";
    const whom = isSelf ? "you" : targetName ?? "them";
    const homeClause = require_home ? ` (only if ${isSelf ? "you're" : "they're"} home)` : "";
    return `Rule created (#${ruleId}): I'll remind ${whom} ${what} at ${when}${homeClause}.`;
  }

  if (trigger === "arrival") {
    const creatorRow = db
      .prepare("SELECT id FROM people WHERE discord_user_id = ?")
      .get(discordUserId) as { id: number } | undefined;

    if (!creatorRow) {
      return "You need to register your device first. Use `register my phone <ip>`.";
    }

    const triggerJson = JSON.stringify({ person_id: creatorRow.id });
    const actionJson = buildActionJson();
    const name = ruleName("arrival", message, sound_source);

    const ruleResult = db
      .prepare(
        `INSERT INTO rules (name, trigger_type, trigger_json, action_type, action_json)
         VALUES (?, 'arrival', ?, 'notify', ?)`
      )
      .run(name, triggerJson, actionJson);

    const ruleId = ruleResult.lastInsertRowid as number;
    const what = message ? `"${message}"` : "your sound";
    const whom = isSelf ? "you" : targetName ?? "them";
    const homeClause = require_home ? ` (only if ${isSelf ? "you're" : "they're"} home)` : "";
    return `Rule created (#${ruleId}): I'll notify ${whom} ${what} when you arrive home${homeClause}.`;
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
  target_name: string | null;
};

export function handleListRules(db: Database.Database): string {
  const rows = db
    .prepare(
      `SELECT r.id, r.name, r.trigger_type, r.action_json,
              sj.next_run_ts,
              p.name as target_name
       FROM rules r
       LEFT JOIN scheduled_jobs sj ON sj.rule_id = r.id
       LEFT JOIN people p ON p.id = JSON_EXTRACT(r.action_json, '$.target_person_id')
       WHERE r.enabled = 1
       ORDER BY r.id`
    )
    .all() as RuleRow[];

  if (rows.length === 0) return "No rules yet.";

  return rows
    .map((r) => {
      const action = JSON.parse(r.action_json) as {
        message?: string;
        sound?: string;
        require_home?: boolean;
      };
      const when =
        r.trigger_type === "arrival"
          ? "on arrival"
          : r.next_run_ts
          ? new Date(r.next_run_ts * 1000).toLocaleString()
          : "scheduled";
      const label = action.message ? `"${action.message}"` : "";
      const soundTag = action.sound ? " [sound]" : "";
      const targetTag = r.target_name ? ` → ${r.target_name}` : "";
      const homeTag = action.require_home ? " [if home]" : "";
      return `#${r.id} [${r.trigger_type}] ${when} — ${label}${soundTag}${targetTag}${homeTag}`;
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

import { CronExpressionParser } from "cron-parser";
import type Database from "better-sqlite3";
import type OpenAI from "openai";
import type { Intent } from "../intent.schema.js";
import { createCalendarEvent } from "../../gcal/gcal.client.js";
import { findHADevice } from "./device.handler.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function ruleName(triggerType: string, label: string): string {
  const snippet = label.length > 40 ? label.slice(0, 37) + "..." : label;
  return `${triggerType}: ${snippet}`;
}

function isoToUnix(iso: string): number | null {
  const ms = new Date(iso).getTime();
  return isNaN(ms) ? null : Math.floor(ms / 1000);
}

// Display the local time the LLM intended, without converting to the container's timezone.
// The LLM embeds the user's local time in the ISO string (e.g. "2026-03-02T22:00:00+02:00").
// Stripping the offset and treating the bare datetime as UTC preserves the local digits.
export function formatIsoLocal(iso: string): string {
  const bare = iso.replace(/([+-]\d{2}:\d{2}|Z)$/, "");
  return new Date(bare + "Z").toLocaleString(undefined, { timeZone: "UTC" });
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

function deviceActionLabel(command: string, deviceName: string, value?: string | number): string {
  if (command === "on" || command === "off") return `turn ${command} ${deviceName}`;
  if (command === "setVolume") return `set volume to ${value} on ${deviceName}`;
  if (command === "volumeUp") return `turn up volume on ${deviceName}`;
  if (command === "volumeDown") return `turn down volume on ${deviceName}`;
  if (command === "mute") return `mute ${deviceName}`;
  if (command === "unmute") return `unmute ${deviceName}`;
  if (command === "setTvChannel") return `set channel to ${value} on ${deviceName}`;
  if (command === "setInputSource") return `switch ${deviceName} to ${value}`;
  if (command === "play") return `play ${deviceName}`;
  if (command === "pause") return `pause ${deviceName}`;
  if (command === "stop") return `stop ${deviceName}`;
  if (command === "startActivity") return `launch ${value} on ${deviceName}`;
  if (command === "setMode") return `set mode to ${value} on ${deviceName}`;
  return `${command} ${deviceName}`;
}

type PersonRow = { id: number; discord_user_id: string; name: string };

function resolveTargetPerson(
  intent: Intent,
  discordUserId: string,
  db: Database.Database
): { person: PersonRow | null; error: null } | { person: null; error: string } {
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

export async function handleCreateRule(
  intent: Intent,
  discordUserId: string,
  db: Database.Database,
  gcalKeyFile?: string,
  openai?: OpenAI
): Promise<string> {
  const { trigger, action, message, time_spec, sound_source, require_home, device } = intent;

  // ── device_control branch ────────────────────────────────────────────────
  if (action === "device_control") {
    if (!device) {
      return "Which device do you want to control, and should it be on or off?";
    }

    const stRow = db
      .prepare("SELECT smartthings_device_id FROM smart_devices WHERE LOWER(name) = LOWER(?)")
      .get(device.name) as { smartthings_device_id: string } | undefined;
    const haRow = !stRow && openai
      ? await findHADevice(device.name, db, openai)
      : !stRow
      ? (db
          .prepare("SELECT entity_id FROM ha_devices WHERE LOWER(name) = LOWER(?)")
          .get(device.name) as { entity_id: string } | undefined)
      : null;

    if (!stRow && !haRow) {
      return `I don't know a device called "${device.name}". Register it in the REPL first.`;
    }

    const actionJson = JSON.stringify(
      stRow
        ? {
            smartthings_device_id: stRow.smartthings_device_id,
            command: device.command,
            ...(device.value !== undefined ? { value: device.value } : {}),
          }
        : {
            ha_entity_id: haRow!.entity_id,
            command: device.command,
            ...(device.value !== undefined ? { value: device.value } : {}),
          }
    );

    if (trigger === "time") {
      if (!time_spec || (!time_spec.datetime_iso && !time_spec.cron)) {
        return "When should this rule fire? Please specify a time.";
      }

      const triggerJson = JSON.stringify(time_spec);
      const name = ruleName("time", `${device.command} ${device.name}`);

      const ruleResult = db
        .prepare(
          `INSERT INTO rules (name, trigger_type, trigger_json, action_type, action_json)
           VALUES (?, 'time', ?, 'device_control', ?)`
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
        when = formatIsoLocal(time_spec.datetime_iso);
      } else {
        nextRunTs = cronNextTs(time_spec.cron!);
        if (nextRunTs === null) {
          return `Invalid cron expression "${time_spec.cron}". A valid cron has 5 fields: minute hour day month weekday (e.g. \`0 20 * * *\` for 8pm daily).`;
        }
        when = `cron: ${time_spec.cron}`;
      }

      db.prepare(
        `INSERT INTO scheduled_jobs (rule_id, next_run_ts, status) VALUES (?, ?, 'pending')`
      ).run(ruleId, nextRunTs);

      return `Rule created (#${ruleId}): I'll ${deviceActionLabel(device.command, device.name, device.value)} at ${when}.`;
    }

    if (trigger === "arrival") {
      const creatorRow = db
        .prepare("SELECT id FROM people WHERE discord_user_id = ?")
        .get(discordUserId) as { id: number } | undefined;

      if (!creatorRow) {
        return "You need to register your device first. Use `register my phone <ip>`.";
      }

      const triggerJson = JSON.stringify({ person_id: creatorRow.id });
      const name = ruleName("arrival", `${device.command} ${device.name}`);

      const ruleResult = db
        .prepare(
          `INSERT INTO rules (name, trigger_type, trigger_json, action_type, action_json)
           VALUES (?, 'arrival', ?, 'device_control', ?)`
        )
        .run(name, triggerJson, actionJson);

      const ruleId = ruleResult.lastInsertRowid as number;
      return `Rule created (#${ruleId}): I'll ${deviceActionLabel(device.command, device.name, device.value)} when you arrive home.`;
    }

    return "I don't know how to create that kind of device rule yet.";
  }

  // ── notify branch ────────────────────────────────────────────────────────
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
    const name = ruleName("time", message ?? sound_source ?? "rule");

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

    if (gcalKeyFile && targetPersonId !== undefined && time_spec.datetime_iso) {
      createCalendarEvent(targetPersonId, db, gcalKeyFile, {
        summary: message ?? sound_source ?? "Reminder",
        startIso: time_spec.datetime_iso,
      }).catch((err) => console.error("GCal:", err));
    }

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
    const name = ruleName("arrival", message ?? sound_source ?? "rule");

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

import { CronExpressionParser } from "cron-parser";
import type Database from "better-sqlite3";
import type { DeviceCommand, SmartThingsCommandFn } from "../samsung/smartthings.client.js";
import type { HACommandFn, HAQueryFn } from "../homeassistant/ha.client.js";

type JobRow = {
  id: number;
  rule_id: number;
  next_run_ts: number;
  action_type: string;
  action_json: string;
  trigger_json: string;
};

type ActionJson = {
  message?: string;
  sound?: string;
  target_person_id?: number;
  require_home?: boolean;
};

function nextCronTs(cronExpr: string, afterSec: number): number {
  const interval = CronExpressionParser.parse(cronExpr, {
    currentDate: new Date(afterSec * 1000),
  });
  return Math.floor(interval.next().toDate().getTime() / 1000);
}

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: Database.Database,
    private readonly sendToChannel: (text: string) => Promise<void>,
    private readonly intervalSec: number = 30,
    private readonly playSoundFn?: (source: string) => Promise<void>,
    private readonly getPresenceStates?: () => Map<number, "home" | "away">,
    private readonly controlDeviceFn?: SmartThingsCommandFn,
    private readonly controlHAFn?: HACommandFn,
    private readonly queryHAFn?: HAQueryFn
  ) {}

  start(): void {
    // Run immediately on start to catch any jobs pending before restart
    this.tick().catch(console.error);
    this.timer = setInterval(
      () => this.tick().catch(console.error),
      this.intervalSec * 1000
    );
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private logTaskExecution(ruleId: number, hourOfDay: number): void {
    try {
      this.db
        .prepare(
          "INSERT INTO task_executions (source, rule_id, hour_of_day) VALUES (?, ?, ?)"
        )
        .run("scheduler", ruleId, hourOfDay);
    } catch {
      // Non-critical
    }
  }

  private checkProactiveSuggestions(nowSec: number): void {
    try {
      // Find manual command patterns with >= 3 occurrences
      type PatternRow = { device_name: string; command: string; hour_of_day: number; cnt: number };
      const patterns = this.db
        .prepare(
          `SELECT device_name, command, hour_of_day, COUNT(*) as cnt
           FROM task_executions
           WHERE source = 'manual' AND device_name IS NOT NULL AND command IS NOT NULL
           GROUP BY device_name, command, hour_of_day
           HAVING cnt >= 3`
        )
        .all() as PatternRow[];

      const nowDate = new Date(nowSec * 1000);
      const currentHour = nowDate.getHours();

      for (const p of patterns) {
        // Compute next occurrence of this hour
        const nextDate = new Date(nowDate);
        nextDate.setMinutes(0, 0, 0);
        nextDate.setHours(p.hour_of_day);
        if (nextDate.getTime() <= nowDate.getTime()) {
          nextDate.setDate(nextDate.getDate() + 1);
        }
        const hoursUntil = (nextDate.getTime() - nowDate.getTime()) / 3_600_000;

        if (hoursUntil < 11 || hoursUntil > 13) continue;

        const patternKey = `manual:${p.device_name}:${p.command}:${p.hour_of_day}`;
        const yesterday = nowSec - 86_400;
        const alreadySent = this.db
          .prepare(
            "SELECT id FROM proactive_suggestions WHERE pattern_key = ? AND suggested_at > ?"
          )
          .get(patternKey, yesterday);
        if (alreadySent) continue;

        this.db
          .prepare("INSERT INTO proactive_suggestions (pattern_key) VALUES (?)")
          .run(patternKey);

        const hour12 = p.hour_of_day % 12 || 12;
        const ampm = p.hour_of_day < 12 ? "am" : "pm";
        const suggestion =
          `You usually ${p.command} the ${p.device_name} around ${hour12}${ampm}. ` +
          `Want to schedule it? Reply with: "create rule: ${p.command} ${p.device_name} at ${hour12}${ampm} every day"`;

        this.sendToChannel(suggestion).catch(console.error);
      }

      // Find scheduler rule patterns with >= 3 firings
      type RulePatternRow = { rule_id: number; hour_of_day: number; cnt: number };
      const rulePatterns = this.db
        .prepare(
          `SELECT rule_id, hour_of_day, COUNT(*) as cnt
           FROM task_executions
           WHERE source = 'scheduler' AND rule_id IS NOT NULL
           GROUP BY rule_id, hour_of_day
           HAVING cnt >= 3`
        )
        .all() as RulePatternRow[];

      for (const p of rulePatterns) {
        const rule = this.db
          .prepare("SELECT name, trigger_json FROM rules WHERE id = ? AND enabled = 1")
          .get(p.rule_id) as { name: string; trigger_json: string } | undefined;
        if (!rule) continue;

        const trigger = JSON.parse(rule.trigger_json) as { cron?: string; datetime_iso?: string };
        // Only suggest for one-time rules (cron rules are already recurring)
        if (trigger.cron) continue;

        const nextDate = new Date(nowSec * 1000);
        nextDate.setMinutes(0, 0, 0);
        nextDate.setHours(p.hour_of_day);
        if (nextDate.getTime() <= nowSec * 1000) {
          nextDate.setDate(nextDate.getDate() + 1);
        }
        const hoursUntil = (nextDate.getTime() - nowSec * 1000) / 3_600_000;
        if (hoursUntil < 11 || hoursUntil > 13) continue;

        const patternKey = `scheduler:${p.rule_id}:${p.hour_of_day}`;
        const yesterday = nowSec - 86_400;
        const alreadySent = this.db
          .prepare(
            "SELECT id FROM proactive_suggestions WHERE pattern_key = ? AND suggested_at > ?"
          )
          .get(patternKey, yesterday);
        if (alreadySent) continue;

        this.db
          .prepare("INSERT INTO proactive_suggestions (pattern_key) VALUES (?)")
          .run(patternKey);

        const hour12 = p.hour_of_day % 12 || 12;
        const ampm = p.hour_of_day < 12 ? "am" : "pm";
        const suggestion =
          `The rule "${rule.name}" has run ${p.cnt} times around ${hour12}${ampm}. ` +
          `Want to make it recurring? Reply with: "create rule: ${rule.name} every day at ${hour12}${ampm}"`;

        this.sendToChannel(suggestion).catch(console.error);
      }
    } catch (err) {
      console.error("Scheduler: proactive suggestion check failed:", err);
    }
  }

  private evaluateOperator(value: number, op: string, threshold: number): boolean {
    if (op === ">")  return value > threshold;
    if (op === "<")  return value < threshold;
    if (op === ">=") return value >= threshold;
    if (op === "<=") return value <= threshold;
    return false;
  }

  private async fireConditionAction(
    ruleId: number,
    actionType: string,
    action: Record<string, unknown>,
    nowSec: number
  ): Promise<void> {
    if (actionType === "device_control") {
      const haEntityId = action.ha_entity_id as string | undefined;
      const stDeviceId = action.smartthings_device_id as string | undefined;
      const command = action.command as DeviceCommand;
      const value = action.value as string | number | undefined;

      if (haEntityId && this.controlHAFn) {
        await this.controlHAFn(haEntityId, command, value);
      } else if (stDeviceId && this.controlDeviceFn) {
        await this.controlDeviceFn(stDeviceId, command, value);
      }
    } else {
      const message = action.message as string | undefined;
      const targetPersonId = action.target_person_id as number | undefined;
      let notifyText = message;
      if (targetPersonId !== undefined && message) {
        const personRow = this.db
          .prepare("SELECT discord_user_id FROM people WHERE id = ?")
          .get(targetPersonId) as { discord_user_id: string } | undefined;
        if (personRow?.discord_user_id) {
          notifyText = `<@${personRow.discord_user_id}> ${message}`;
        }
      }
      if (notifyText) await this.sendToChannel(notifyText);
    }
    this.logTaskExecution(ruleId, new Date(nowSec * 1000).getHours());
  }

  private async tickConditionRules(nowSec: number): Promise<void> {
    if (!this.queryHAFn) return;

    type ConditionRuleRow = {
      id: number;
      action_type: string;
      action_json: string;
      condition_onset_ts: number | null;
    };

    const rules = this.db
      .prepare(
        `SELECT id, action_type, action_json, condition_onset_ts
         FROM rules WHERE trigger_type = 'condition' AND enabled = 1`
      )
      .all() as ConditionRuleRow[];

    for (const rule of rules) {
      const action = JSON.parse(rule.action_json) as Record<string, unknown>;
      const conditionEntityId = action.condition_entity_id as string;
      const conditionState = action.condition_state as string | undefined;
      const conditionOperator = action.condition_operator as string | undefined;
      const conditionThreshold = action.condition_threshold as number | undefined;
      const durationSec = (action.duration_sec as number | undefined) ?? 0;

      let conditionMet = false;
      try {
        const { state, attributes } = await this.queryHAFn(conditionEntityId);
        if (conditionState !== undefined) {
          conditionMet = state === conditionState;
        } else if (conditionOperator !== undefined && conditionThreshold !== undefined) {
          const numeric = parseFloat(state);
          if (!isNaN(numeric)) {
            conditionMet = this.evaluateOperator(numeric, conditionOperator, conditionThreshold);
          } else {
            // Try attributes.unit_of_measurement or numeric attribute
            const attrNumeric = parseFloat(String(attributes.value ?? attributes.state ?? ""));
            if (!isNaN(attrNumeric)) {
              conditionMet = this.evaluateOperator(attrNumeric, conditionOperator, conditionThreshold);
            }
          }
        }
      } catch (err) {
        console.error(`Scheduler: condition check failed for rule #${rule.id}:`, err);
        continue;
      }

      if (conditionMet) {
        if (rule.condition_onset_ts === null) {
          // First tick condition is met — record onset
          this.db
            .prepare("UPDATE rules SET condition_onset_ts = ? WHERE id = ?")
            .run(nowSec, rule.id);

          if (durationSec === 0) {
            // Fire immediately
            try {
              await this.fireConditionAction(rule.id, rule.action_type, action, nowSec);
            } catch (err) {
              console.error(`Scheduler: condition rule #${rule.id} fire failed:`, err);
            }
          }
        } else if (durationSec > 0 && nowSec - rule.condition_onset_ts >= durationSec) {
          // Duration elapsed — fire and reset so it can trigger again next time
          try {
            await this.fireConditionAction(rule.id, rule.action_type, action, nowSec);
          } catch (err) {
            console.error(`Scheduler: condition rule #${rule.id} fire failed:`, err);
          }
          this.db
            .prepare("UPDATE rules SET condition_onset_ts = NULL WHERE id = ?")
            .run(rule.id);
        }
        // else: durationSec > 0, still waiting — do nothing
      } else if (rule.condition_onset_ts !== null) {
        // Condition no longer met — reset onset
        this.db
          .prepare("UPDATE rules SET condition_onset_ts = NULL WHERE id = ?")
          .run(rule.id);
      }
    }
  }

  async tick(nowSec: number = Math.floor(Date.now() / 1000)): Promise<void> {
    const jobs = this.db
      .prepare(
        `SELECT sj.id, sj.rule_id, sj.next_run_ts, r.action_type, r.action_json, r.trigger_json
         FROM scheduled_jobs sj
         JOIN rules r ON r.id = sj.rule_id
         WHERE sj.status = 'pending'
           AND sj.next_run_ts IS NOT NULL
           AND sj.next_run_ts <= ?
           AND r.enabled = 1`
      )
      .all(nowSec) as JobRow[];

    for (const job of jobs) {
      const action = JSON.parse(job.action_json) as ActionJson;
      const trigger = JSON.parse(job.trigger_json) as {
        cron?: string;
        datetime_iso?: string;
      };

      // Presence gate: skip if target must be home but is away
      if (action.require_home && action.target_person_id !== undefined) {
        const states = this.getPresenceStates?.();
        const state = states?.get(action.target_person_id);
        if (state !== "home") {
          if (trigger.cron) {
            // Advance to next cron occurrence and stay pending
            const nextTs = nextCronTs(trigger.cron, nowSec);
            this.db
              .prepare("UPDATE scheduled_jobs SET next_run_ts = ? WHERE id = ?")
              .run(nextTs, job.id);
          }
          // One-time: leave as pending; scheduler will retry on next tick
          continue;
        }
      }

      try {
        this.db
          .prepare("UPDATE scheduled_jobs SET status = 'running' WHERE id = ?")
          .run(job.id);

        if (job.action_type === "device_control") {
          const deviceAction = JSON.parse(job.action_json) as {
            smartthings_device_id?: string;
            ha_entity_id?: string;
            command: string;
            value?: string | number;
          };
          if (deviceAction.ha_entity_id && this.controlHAFn) {
            await this.controlHAFn(
              deviceAction.ha_entity_id,
              deviceAction.command as DeviceCommand,
              deviceAction.value
            );
          } else if (deviceAction.smartthings_device_id && this.controlDeviceFn) {
            await this.controlDeviceFn(
              deviceAction.smartthings_device_id,
              deviceAction.command as DeviceCommand,
              deviceAction.value
            );
          } else {
            console.error(
              "Scheduler: device_control rule fired but SmartThings not configured"
            );
          }
        } else {
          // Build notification text, prepending @mention when target is set
          let notifyText = action.message;
          if (action.target_person_id !== undefined && action.message) {
            const personRow = this.db
              .prepare("SELECT discord_user_id FROM people WHERE id = ?")
              .get(action.target_person_id) as { discord_user_id: string } | undefined;
            if (personRow?.discord_user_id) {
              notifyText = `<@${personRow.discord_user_id}> ${action.message}`;
            }
          }

          if (notifyText) await this.sendToChannel(notifyText);
          if (action.sound && this.playSoundFn) {
            await this.playSoundFn(action.sound).catch((err) =>
              console.error("Sound playback error:", err)
            );
          }
        }

        const hourOfDay = new Date(nowSec * 1000).getHours();
        this.logTaskExecution(job.rule_id, hourOfDay);

        if (trigger.cron) {
          const nextTs = nextCronTs(trigger.cron, nowSec);
          this.db
            .prepare(
              `UPDATE scheduled_jobs
               SET status = 'pending', last_run_ts = ?, next_run_ts = ?
               WHERE id = ?`
            )
            .run(nowSec, nextTs, job.id);
        } else {
          this.db
            .prepare(
              `UPDATE scheduled_jobs
               SET status = 'done', last_run_ts = ?
               WHERE id = ?`
            )
            .run(nowSec, job.id);
        }
      } catch (e) {
        this.db
          .prepare(
            `UPDATE scheduled_jobs
             SET status = 'failed', last_error = ?, last_run_ts = ?
             WHERE id = ?`
          )
          .run(String(e), nowSec, job.id);
      }
    }

    this.checkProactiveSuggestions(nowSec);
    await this.tickConditionRules(nowSec);
  }
}

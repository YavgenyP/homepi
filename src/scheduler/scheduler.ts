import { CronExpressionParser } from "cron-parser";
import type Database from "better-sqlite3";

type JobRow = {
  id: number;
  rule_id: number;
  next_run_ts: number;
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
    private readonly getPresenceStates?: () => Map<number, "home" | "away">
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

  async tick(nowSec: number = Math.floor(Date.now() / 1000)): Promise<void> {
    const jobs = this.db
      .prepare(
        `SELECT sj.id, sj.rule_id, sj.next_run_ts, r.action_json, r.trigger_json
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
  }
}

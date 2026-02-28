import { CronExpressionParser } from "cron-parser";
import type Database from "better-sqlite3";

type JobRow = {
  id: number;
  rule_id: number;
  next_run_ts: number;
  action_json: string;
  trigger_json: string;
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
    private readonly intervalSec: number = 30
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
      try {
        this.db
          .prepare("UPDATE scheduled_jobs SET status = 'running' WHERE id = ?")
          .run(job.id);

        const action = JSON.parse(job.action_json) as { message: string };
        await this.sendToChannel(action.message);

        const trigger = JSON.parse(job.trigger_json) as {
          cron?: string;
          datetime_iso?: string;
        };

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

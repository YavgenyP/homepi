import type Database from "better-sqlite3";
import type { PresenceProvider } from "./provider.interface.js";

type State = "home" | "away";

type PersonEntry = {
  state: State;
  lastSeenAt: number;
  pendingState: State | null;
  pendingSince: number | null;
};

export type PresenceConfig = {
  intervalSec: number;
  debounceSec: number;
  homeTtlSec: number;
};

export type NotifyFn = (personName: string) => Promise<void>;

type PersonRow = { id: number; name: string };

export class PresenceStateMachine {
  private readonly entries = new Map<number, PersonEntry>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly providers: PresenceProvider[],
    private readonly db: Database.Database,
    private readonly notify: NotifyFn,
    private readonly config: PresenceConfig
  ) {
    this.loadInitialState();
  }

  private loadInitialState(): void {
    const people = this.db
      .prepare("SELECT id FROM people")
      .all() as { id: number }[];

    for (const p of people) {
      const last = this.db
        .prepare(
          "SELECT state FROM presence_events WHERE person_id = ? ORDER BY ts DESC LIMIT 1"
        )
        .get(p.id) as { state: State } | undefined;

      this.entries.set(p.id, {
        state: last?.state ?? "away",
        lastSeenAt: 0,
        pendingState: null,
        pendingSince: null,
      });
    }
  }

  start(): void {
    this.timer = setInterval(() => {
      this.tick().catch(console.error);
    }, this.config.intervalSec * 1000);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(nowSec: number = Math.floor(Date.now() / 1000)): Promise<void> {
    const people = this.db
      .prepare("SELECT id, name FROM people")
      .all() as PersonRow[];

    // Register any newly paired people since last tick
    for (const p of people) {
      if (!this.entries.has(p.id)) {
        this.entries.set(p.id, {
          state: "away",
          lastSeenAt: 0,
          pendingState: null,
          pendingSince: null,
        });
      }
    }

    // Poll all providers
    const sightings = (
      await Promise.all(this.providers.map((p) => p.poll()))
    ).flat();

    // Update lastSeenAt
    for (const s of sightings) {
      const entry = this.entries.get(s.personId);
      if (entry) entry.lastSeenAt = Math.max(entry.lastSeenAt, s.seenAt);
    }

    // Evaluate and debounce per person
    for (const person of people) {
      const entry = this.entries.get(person.id)!;
      const withinTtl = nowSec - entry.lastSeenAt <= this.config.homeTtlSec;
      const candidateState: State = withinTtl ? "home" : "away";

      if (candidateState === entry.state) {
        entry.pendingState = null;
        entry.pendingSince = null;
        continue;
      }

      if (entry.pendingState !== candidateState) {
        entry.pendingState = candidateState;
        entry.pendingSince = nowSec;
      }

      if (
        entry.pendingSince !== null &&
        nowSec - entry.pendingSince >= this.config.debounceSec
      ) {
        const prevState = entry.state;
        entry.state = candidateState;
        entry.pendingState = null;
        entry.pendingSince = null;

        this.db
          .prepare(
            "INSERT INTO presence_events (person_id, state, ts) VALUES (?, ?, ?)"
          )
          .run(person.id, candidateState, nowSec);

        if (prevState === "away" && candidateState === "home") {
          await this.notify(person.name);
        }
      }
    }
  }

  getCurrentStates(): Map<number, State> {
    return new Map(
      Array.from(this.entries.entries()).map(([id, e]) => [id, e.state])
    );
  }
}

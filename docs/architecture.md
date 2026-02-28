# Architecture (Ping + BLE + LLM parsing + eval)

## Modules

```
src/
  health.ts                        GET /health (Docker healthcheck)
  index.ts                         Entry point — wires everything together
  discord/
    discord.client.ts              Discord Client, exposes sendToChannel
    intent.parser.ts               Calls OpenAI (json_object mode), validates via Zod
    intent.schema.ts               Zod schema + Intent type
    message.handler.ts             Routes intents, logs to llm_message_log
    handlers/
      pair.handler.ts              pair_phone intent
      who_home.handler.ts          who_home intent
      rule.handler.ts              create_rule / list_rules / delete_rule
  presence/
    provider.interface.ts          PresenceProvider interface + PresenceSighting type
    ping.provider.ts               Pings registered IPs via system ping
    ble.provider.ts                BLE scan via bluetoothctl (Pi only, feature-flagged)
    presence.state.ts              Polls providers, debounces transitions, fires rules
  rules/
    arrival.evaluator.ts           Evaluates arrival rules on home transition
  scheduler/
    scheduler.ts                   Polls scheduled_jobs, fires due notify actions
  storage/
    db.ts                          openDb() — WAL mode, FK ON, runs migrations
    migrate.ts                     Ordered migration runner
    migrations/
      001_init.sql                 All tables
  evals/
    dataset/intents.jsonl          Golden messages + expected fields + fixtures
    runner/runner.ts               npm run eval (fixture or live mode)
    runner/score.ts                Partial deep-match correctness checker
```

## LLM Intent Parsing (v0)

OpenAI API called with `response_format: { type: "json_object" }`.
Response validated against Zod schema before use.

Intent shape:
- intent: pair_phone | create_rule | list_rules | delete_rule | who_home | help | unknown
- trigger: time | arrival | none
- action: notify | none
- message: string | null
- time_spec: { datetime_iso?: string, cron?: string } | null
- person: { ref: "me" | "name", name?: string } | null
- phone: { ip?: string, ble_mac?: string } | null
- confidence: number (0..1)
- clarifying_question: string | null

Rules:
- If `clarifying_question` is set OR confidence < threshold → reply with question; no side effects.
- If OpenAI call fails → send Discord error; no side effects.
- A fraction of intents (LLM_EVAL_SAMPLING_RATE) are logged to llm_message_log.

## Pairing / Identity mapping (v0)

- `pair_phone` intent stores identifiers in `person_devices` (kind=ping_ip or ble_mac).
- Presence providers only check registered identifiers.

## Presence

- `PingProvider`: pings all `ping_ip` devices in parallel; one sighting per person.
- `BleProvider`: scans via `bluetoothctl` for `PRESENCE_BLE_SCAN_INTERVAL_SEC` seconds.
  Enabled only when `PRESENCE_BLE_ENABLED=true`. See docker-compose.yml for Pi flags.
- `PresenceStateMachine`: polls providers every `PRESENCE_PING_INTERVAL_SEC` seconds.
  Person is HOME if any provider reports seen within `PRESENCE_HOME_TTL_SEC`.
  Transitions debounced by `PRESENCE_DEBOUNCE_SEC`. On away→home: evaluates arrival rules.

## Scheduler

Polls `scheduled_jobs` every `SCHEDULER_INTERVAL_SEC` seconds.
One-time jobs (datetime_iso): fired once, marked `done`.
Cron jobs: fired, next_run_ts recomputed via cron-parser, stays `pending`.
Runs `tick()` immediately on start to catch jobs pending before restart.

## Timezone

All scheduling uses the Pi's local timezone (set via `timedatectl` on the host).

## Storage (SQLite)

Tables:
- people(id, discord_user_id, name, created_at)
- person_devices(id, person_id, kind, value, created_at)  — kind=ping_ip|ble_mac
- presence_events(id, person_id, state, ts, raw_json)
- rules(id, name, trigger_type, trigger_json, action_type, action_json, enabled, created_at)
- scheduled_jobs(id, rule_id, next_run_ts, status, last_run_ts, last_error)
- llm_message_log(id, ts, user_id, channel_id, message_text, intent_json, confidence, was_clarified, raw_response_json)

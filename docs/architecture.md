# Architecture

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
      device.handler.ts            control_device intent (immediate, no rule stored)
  presence/
    provider.interface.ts          PresenceProvider interface + PresenceSighting type
    ping.provider.ts               Pings registered IPs via system ping
    ble.provider.ts                BLE scan via bluetoothctl (Pi only, feature-flagged)
    presence.state.ts              Polls providers, debounces transitions, fires rules
  rules/
    arrival.evaluator.ts           Evaluates arrival rules on home transition
  scheduler/
    scheduler.ts                   Polls scheduled_jobs, fires due notify/device actions
  storage/
    db.ts                          openDb() — WAL mode, FK ON, runs migrations
    migrate.ts                     Ordered migration runner
    migrations/
      001_init.sql                 Core tables
      002_gcal.sql                 gcal_calendar_id column on people
      003_smart_devices.sql        smart_devices table
      004_smartthings_oauth.sql    smartthings_oauth table
      005_ha_devices.sql           ha_devices table
  samsung/
    smartthings.client.ts          sendDeviceCommand(); DeviceCommand type + COMMAND_MAP
    smartthings.auth.ts            OAuth token management (getValidToken, refresh)
    smartthings.setup.ts           One-time OAuth setup script (npm run smartthings-setup)
  homeassistant/
    ha.client.ts                   sendHACommand(); maps DeviceCommand → HA service calls
  gcal/
    gcal.client.ts                 createCalendarEvent() via service account
  tts/
    tts.ts                         speak() via OpenAI TTS API + ffplay
  sound/
    sound.player.ts                playSound() — local file or YouTube URL (yt-dlp + ffplay)
  repl/
    repl.ts                        SSH-accessible REPL (npm run repl)
  evals/
    dataset/intents.jsonl          Golden messages + expected fields + fixtures
    runner/runner.ts               npm run eval (fixture or live mode)
    runner/score.ts                Partial deep-match correctness checker
```

## LLM Intent Parsing

OpenAI API called with `response_format: { type: "json_object" }`.
Response validated against Zod schema before use.

Intent shape:
- `intent`: `pair_phone | create_rule | list_rules | delete_rule | who_home | control_device | unknown`
- `trigger`: `time | arrival | none`
- `action`: `notify | device_control | none`
- `message`: `string | null`
- `time_spec`: `{ datetime_iso?: string, cron?: string } | null`
- `person`: `{ ref: "me" | "name", name?: string } | null`
- `phone`: `{ ip?: string, ble_mac?: string } | null`
- `sound_source`: `string | null` — local file path or URL
- `require_home`: `boolean` — gate rule/scheduler on presence
- `device`: `{ name: string, command: DeviceCommand, value?: string | number } | null`
- `confidence`: `number (0..1)`
- `clarifying_question`: `string | null`

Rules:
- If `clarifying_question` is set OR confidence < threshold → reply with question; no side effects.
- If OpenAI call fails → send Discord error; no side effects.
- A fraction of intents (LLM_EVAL_SAMPLING_RATE) are logged to `llm_message_log`.

## Pairing / Identity mapping

- `pair_phone` intent stores identifiers in `person_devices` (`kind=ping_ip` or `ble_mac`).
- Presence providers only check registered identifiers.

## Presence

- `PingProvider`: pings all `ping_ip` devices in parallel; one sighting per person.
- `BleProvider`: scans via `bluetoothctl` for `PRESENCE_BLE_SCAN_INTERVAL_SEC` seconds.
  Enabled only when `PRESENCE_BLE_ENABLED=true`.
- `PresenceStateMachine`: polls providers every `PRESENCE_PING_INTERVAL_SEC` seconds.
  Person is HOME if any provider reports seen within `PRESENCE_HOME_TTL_SEC`.
  Transitions debounced by `PRESENCE_DEBOUNCE_SEC`. On away→home: evaluates arrival rules.

## Scheduler

Polls `scheduled_jobs` every `SCHEDULER_INTERVAL_SEC` seconds.
One-time jobs (`datetime_iso`): fired once, marked `done`.
Cron jobs: fired, `next_run_ts` recomputed via cron-parser, stays `pending`.
Runs `tick()` immediately on start to catch jobs pending before restart.
Supports `require_home`: skips if target person is away (cron advances; one-time stays pending).

## Device control

Two backends, dispatched by which table the device name is registered in:

| Table | Backend | Key column |
|---|---|---|
| `smart_devices` | Samsung SmartThings REST API | `smartthings_device_id` (UUID) |
| `ha_devices` | Home Assistant REST API | `entity_id` (e.g. `climate.tadiran_ac`) |

Dispatch priority: SmartThings is checked first; HA is checked if no ST match.

`action_json` for `device_control` rules:
```json
// SmartThings:
{ "smartthings_device_id": "uuid", "command": "on" }

// Home Assistant:
{ "ha_entity_id": "climate.tadiran_ac", "command": "on", "value": 22 }
```

SmartThings auth uses OAuth 2.0 with automatic token refresh (tokens in `smartthings_oauth`).
HA auth uses a static long-lived Bearer token (`HOMEASSISTANT_TOKEN` env var).

## Timezone

All scheduling uses the Pi's local timezone (set via `timedatectl` on the host).

## Storage (SQLite)

Tables:
- `people(id, discord_user_id, name, gcal_calendar_id, created_at)`
- `person_devices(id, person_id, kind, value, created_at)` — `kind=ping_ip|ble_mac`
- `presence_events(id, person_id, state, ts, raw_json)`
- `rules(id, name, trigger_type, trigger_json, action_type, action_json, enabled, created_at)`
- `scheduled_jobs(id, rule_id, next_run_ts, status, last_run_ts, last_error)`
- `llm_message_log(id, ts, user_id, channel_id, message_text, intent_json, confidence, was_clarified, raw_response_json)`
- `smart_devices(name, smartthings_device_id)` — SmartThings device registry
- `ha_devices(name, entity_id)` — Home Assistant device registry
- `smartthings_oauth(id, access_token, refresh_token, expires_at)` — singleton OAuth token row

## action_json shapes (rules table)

```json
// action_type = "notify":
{ "message": "text", "sound": "path/or/url", "target_person_id": 2, "require_home": true }

// action_type = "device_control" (SmartThings):
{ "smartthings_device_id": "uuid", "command": "on" }

// action_type = "device_control" (Home Assistant):
{ "ha_entity_id": "climate.tadiran_ac", "command": "setTemperature", "value": 22 }
```

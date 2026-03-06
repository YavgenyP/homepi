# homepi — Architecture

homepi is a local-first home automation control plane.
Discord is the only user interface. You speak (or type) to the bot; it controls your home.

---

## Design principles

- **Discord-only UX.** No dashboard, no web app, no mobile app.
- **LLM for intent parsing only.** The model returns strict JSON. No business logic runs inside the prompt.
- **Local-first.** SQLite is the single source of truth. The system is fully recoverable from the database alone.
- **Optional everything.** SmartThings, Home Assistant, Google Calendar, TTS, BLE, and voice input are all opt-in via env vars.
- **No speculative abstractions.** Every module exists because it's needed now.

---

## How a message becomes an action

```
User speaks or types in Discord
        │
        ▼
  Discord bot receives message / voice audio
        │
        │  (voice path: Whisper transcribes audio → text)
        │
        ▼
  OpenAI GPT-4o parses natural language → strict JSON intent
        │
        ▼
  Zod schema validation
        │
        ├─ confidence < threshold → ask clarifying question, stop
        ├─ OpenAI error           → post error to Discord, stop
        │
        ▼
  Intent dispatcher (message.handler.ts)
        │
        ├─ pair_phone       → register IP / BLE MAC for presence
        ├─ who_home         → query presence state machine
        ├─ create_rule      → insert into rules + scheduled_jobs
        ├─ list_rules       → read rules table
        ├─ delete_rule      → remove rule + jobs
        ├─ control_device   → SmartThings or Home Assistant API (immediate)
        ├─ query_device     → Home Assistant state query
        ├─ list_devices     → list registered devices
        ├─ sync_ha_devices  → pull all HA entities into ha_devices
        ├─ browse_ha_devices→ show unregistered HA entities grouped by domain
        ├─ add_ha_devices   → register selected HA entities
        └─ alias_device     → add a short alias for an HA device
```

Conversation history (last 5 exchanges, up to 2 hours) is injected into every OpenAI call so follow-up messages have context.

---

## Module map

```
src/
  index.ts                     Entry point — reads env vars, wires all modules
  health.ts                    GET /health (Docker healthcheck endpoint)

  discord/
    discord.client.ts          Discord Client; joins voice channel if configured
    intent.parser.ts           Calls OpenAI (json_object mode), validates via Zod
    intent.schema.ts           Zod schema defining the full Intent type
    message.handler.ts         Routes intents; loads/saves conversation history;
                               injects device context into LLM system prompt
    handlers/
      pair.handler.ts          pair_phone intent
      who_home.handler.ts      who_home intent
      rule.handler.ts          create_rule / list_rules / delete_rule
      device.handler.ts        control_device, query_device, list_devices,
                               sync/browse/add HA devices, alias_device;
                               3-tier device lookup (exact → alias → embedding)

  voice/
    whisper.client.ts          transcribeAudio() — wraps OpenAI Whisper API
    wav.ts                     encodeWav() — raw PCM → RIFF WAV (no deps)
    discord.voice.ts           DiscordVoiceListener — joins VC, decodes Opus
                               per-user audio via prism-media, sends to Whisper
    mic.provider.ts            MicProvider — arecord loop for Pi microphone input

  presence/
    provider.interface.ts      PresenceProvider interface
    ping.provider.ts           Pings registered IPs; one sighting per person
    ble.provider.ts            BLE scan via bluetoothctl (Pi only, feature-flagged)
    presence.state.ts          Polls providers, debounces transitions, fires arrival rules

  rules/
    arrival.evaluator.ts       Evaluates arrival rules on home→away transition

  scheduler/
    scheduler.ts               Polls scheduled_jobs; fires notify/device actions;
                               detects usage patterns and sends proactive suggestions

  storage/
    db.ts                      openDb() — WAL mode, FK ON, runs migrations on start
    migrate.ts                 Ordered migration runner (skips already-applied)
    migrations/
      001_init.sql             people, person_devices, presence_events, rules,
                               scheduled_jobs, llm_message_log
      002_gcal.sql             gcal_calendar_id on people
      003_smart_devices.sql    smart_devices table
      004_smartthings_oauth.sql smartthings_oauth singleton token table
      005_ha_devices.sql       ha_devices table (name, entity_id)
      006_llm_improvements.sql aliases + embedding on ha_devices;
                               conversation_history, task_executions,
                               proactive_suggestions tables

  samsung/
    smartthings.client.ts      sendDeviceCommand(); DeviceCommand type + COMMAND_MAP
    smartthings.auth.ts        OAuth 2.0 token management (getValidToken, refresh)
    smartthings.setup.ts       One-time OAuth setup script (npm run smartthings-setup)

  homeassistant/
    ha.client.ts               sendHACommand(); HA_COMMAND_MAP maps DeviceCommand
                               to HA REST service calls

  gcal/
    gcal.client.ts             createCalendarEvent() via service account JSON key

  tts/
    tts.ts                     speak() via OpenAI TTS + ffplay

  sound/
    sound.player.ts            playSound() — local file or YouTube URL (yt-dlp + ffplay)

  repl/
    repl.ts                    SSH-accessible live REPL (npm run repl)

  evals/
    dataset/intents.jsonl      Golden messages + expected intent fields + fixtures
    runner/runner.ts           npm run eval — fixture or live OpenAI mode
    runner/score.ts            Partial deep-match correctness checker
```

---

## LLM intent parsing

OpenAI is called with `response_format: { type: "json_object" }` so the response is always valid JSON. The output is validated against a Zod schema before any side effect runs.

**System prompt includes:**
- Role and rules (strict JSON only, no guessing, ask when uncertain)
- Current date/time and conversation history (last 5 exchanges within 2 hours)
- All registered devices and their aliases

**Intent fields:**

| Field | Type | Purpose |
|---|---|---|
| `intent` | enum | What the user wants to do |
| `trigger` | `time \| arrival \| none` | When a rule fires |
| `action` | `notify \| device_control \| none` | What a rule does |
| `message` | `string \| null` | Notification text |
| `time_spec` | `{ datetime_iso?, cron? } \| null` | When to run |
| `person` | `{ ref, name? } \| null` | Target person |
| `device` | `{ name, command, value? } \| null` | Device to control |
| `device_alias` | `string \| null` | Alias to add |
| `ha_entity_ids` | `string[] \| null` | HA entities to register |
| `ha_domain_filter` | `string \| null` | Domain to browse |
| `sound_source` | `string \| null` | File path or URL |
| `require_home` | `boolean` | Gate on presence |
| `confidence` | `0..1` | Model self-assessment |
| `clarifying_question` | `string \| null` | Ask user instead of acting |

If `confidence < threshold` or `clarifying_question` is set → the bot asks a question and does nothing else. If OpenAI fails → Discord error, no side effects.

---

## Device control

Two backends. Dispatch is based on which table the device is registered in — SmartThings checked first, then Home Assistant.

| Table | Backend | Identifier |
|---|---|---|
| `smart_devices` | Samsung SmartThings REST API | UUID (`smartthings_device_id`) |
| `ha_devices` | Home Assistant REST API | Entity ID (`climate.tadiran_ac`) |

**Device lookup is 3-tier (HA only):**
1. Exact name match — `"ac"` matches `name = "ac"`
2. Alias match — `"ac"` matches a device with `aliases` containing `"ac"`
3. Embedding similarity — query text is compared via `text-embedding-3-small` cosine similarity against all stored embeddings; closest match above 0.75 threshold wins

**Supported commands (DeviceCommand):**

| Command | HA service | Typical use |
|---|---|---|
| `on` / `off` | `homeassistant/turn_on\|off` | Any device |
| `setTemperature` | `climate/set_temperature` | AC |
| `setHvacMode` | `climate/set_hvac_mode` | AC mode (cool/heat/dry/auto) |
| `setFanMode` | `climate/set_fan_mode` | AC fan speed |
| `setMode` | `fan/set_preset_mode` | Purifier mode |
| `setVolume` | `media_player/volume_set` | TV/speaker |
| `volumeUp/Down` | `media_player/volume_up\|down` | TV/speaker |
| `mute` / `unmute` | `media_player/volume_mute` | TV/speaker |
| `setTvChannel` | `media_player/play_media` (channel) | TV |
| `setInputSource` | `media_player/select_source` | TV HDMI input |
| `play/pause/stop` | `media_player/media_play\|pause\|stop` | Media player |
| `startActivity` | `media_player/select_source` | SmartThings apps |
| `launchApp` | `media_player/play_media` (app) | Android TV app by package name |
| `sendKey` | `remote/send_command` | Android TV Remote key (HOME, BACK, …) |

**Climate entity queries** return a rich summary rather than just the raw state:
```
ac: heat, current 22.5°, target 24°, fan: auto
```

---

## Presence

- **PingProvider** — pings all registered `ping_ip` devices in parallel every `PRESENCE_PING_INTERVAL_SEC` seconds.
- **BleProvider** — scans via `bluetoothctl` for `PRESENCE_BLE_SCAN_INTERVAL_SEC` seconds. Feature-flagged (`PRESENCE_BLE_ENABLED=true`). Requires prior Bluetooth pairing to resolve Android's randomized MAC addresses.
- **PresenceStateMachine** — a person is HOME if any provider reported them within `PRESENCE_HOME_TTL_SEC` seconds. Transitions are debounced by `PRESENCE_DEBOUNCE_SEC`. On away→home: evaluates and fires arrival rules.

---

## Scheduler

Polls `scheduled_jobs` every `SCHEDULER_INTERVAL_SEC` seconds.

- **One-time jobs** (`datetime_iso`): fired once, marked `done`.
- **Cron jobs**: fired, `next_run_ts` advanced via cron-parser, stays `pending`.
- **`require_home`**: if the target person is away, cron jobs advance to next occurrence; one-time jobs stay pending.
- **Proactive suggestions**: tracks manual device commands by hour (`task_executions`). If the same device is used at the same hour 3+ times, the scheduler sends a Discord suggestion ~12 hours in advance, deduped over 24 hours.

---

## Voice input

Two modes — both feed the same `parseIntent → handler` pipeline as text messages.

**Discord voice channel** — `DiscordVoiceListener` auto-joins a configured VC on startup. Per-user audio streams are decoded from Opus (via `prism-media`) and collected until 1 second of silence. The PCM buffer is encoded to WAV and sent to OpenAI Whisper. The transcript is dispatched as a normal command.

**Pi microphone** — `MicProvider` loops `arecord` in 5-second chunks (WAV output). Each chunk is sent to Whisper. Transcripts of more than 3 characters are dispatched as commands attributed to `VOICE_MIC_USERNAME`.

---

## Conversation memory

Every user message and bot reply is saved to `conversation_history` (keyed by Discord user ID). The last 5 exchanges within 2 hours are injected into the OpenAI messages array for every call. Entries older than 2 hours are pruned.

---

## Storage (SQLite)

All state lives in a single SQLite file. WAL mode is enabled. Migrations run automatically on startup in filename order; already-applied migrations are skipped.

**Tables:**

| Table | Purpose |
|---|---|
| `people` | Registered users (Discord ID, name, optional GCal calendar ID) |
| `person_devices` | Presence identifiers per person (`ping_ip` or `ble_mac`) |
| `presence_events` | Raw presence sighting log |
| `rules` | All rules (trigger type/JSON, action type/JSON, enabled flag) |
| `scheduled_jobs` | Job queue (rule_id, next_run_ts, status, last error) |
| `llm_message_log` | Sampled intent log for offline eval review |
| `smart_devices` | SmartThings device registry (name → UUID) |
| `ha_devices` | HA device registry (name, entity_id, aliases, embedding) |
| `smartthings_oauth` | Singleton OAuth 2.0 token row (access + refresh + expiry) |
| `conversation_history` | Per-user chat history for LLM context injection |
| `task_executions` | Manual + scheduled device command log (for pattern detection) |
| `proactive_suggestions` | Dedup log for proactive scheduling suggestions |

**`rules.action_json` shapes:**

```json
// action_type = "notify":
{ "message": "text", "sound": "path/or/url", "target_person_id": 2, "require_home": true }

// action_type = "device_control" (SmartThings):
{ "smartthings_device_id": "uuid", "command": "on" }

// action_type = "device_control" (Home Assistant):
{ "ha_entity_id": "climate.tadiran_ac", "command": "setTemperature", "value": 22 }
```

---

## Auth

| Integration | Method |
|---|---|
| SmartThings | OAuth 2.0 — one-time setup, tokens auto-refreshed 5 min before expiry |
| Home Assistant | Static long-lived Bearer token (`HOMEASSISTANT_TOKEN`) |
| OpenAI | API key (`OPENAI_API_KEY`) |
| Google Calendar | Service account JSON key (`GCAL_KEY_FILE`) |
| Discord | Bot token (`DISCORD_TOKEN`) |

---

## CI / Docker

Every push to `main`:
1. Runs all tests (`npm test`)
2. Builds a multi-platform Docker image (`linux/amd64` + `linux/arm64`)
3. Pushes to `ghcr.io/yavgenyp/homepi:latest` and `ghcr.io/yavgenyp/homepi:sha-<commit>`

The Pi pulls the prebuilt ARM64 image — no compilation on device.

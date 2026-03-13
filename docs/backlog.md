# Backlog (v0)

1) ✅ Repo scaffolding + Docker + /health
2) ✅ Discord bot skeleton + health reporting
3) ✅ LLM intent parser (strict JSON) + schema validation
4) ✅ Evals harness: golden dataset + runner + score summary
5) ✅ SQLite + migrations (people, person_devices, rules, jobs, llm_message_log)
6) ✅ Pairing flow via Discord (register IP / BLE MAC)
7) ✅ Presence framework + Ping provider using registered IPs
8) ✅ Presence state machine + arrival greeting (Discord)
9) ✅ Rule CRUD via Discord (through intents)
10) ✅ Time scheduler + notification action
11) ✅ Arrival trigger rule evaluation
12) ✅ BLE provider (feature-flagged, Pi only)
13) ✅ Docs polish + demo verification
14) ✅ REPL — SSH-accessible local CLI to inspect and control the running app
14b) ✅ CI — GitHub Actions: test on PR, build + push multi-platform Docker image to GHCR on main
15) ✅ TTS — OpenAI TTS API; Pi speaks responses and notifications aloud via speakers
16) ✅ Sound playback on triggers — play local audio files or YouTube URLs on Pi (yt-dlp + ffmpeg)
17) [skipped] Log rotation to AWS S3 — ship Docker container logs to S3 for long-term storage
18) ✅ Multi-person reminders — rules can target another registered person by name ("remind Alice to take medicine"); LLM extracts the target person; notification is sent to their Discord DM or tagged in channel
19) ✅ Presence-gated rules — any rule (time or arrival) can require the target person to be home at fire time; if they're away the rule is skipped (or rescheduled); applies to self and others
20) ✅ Google Calendar integration — create a rule via Discord that also adds a Google Calendar event ("remind me to call the dentist on Friday at 10am" → calendar event + notification); service account auth; per-person opt-in via gcal_calendar_id in DB
21) ✅ Samsung SmartThings integration — control smart appliances (TV, lights, etc.) via Discord; three modes: immediate command ("turn on the TV"), time rule ("turn on the TV at 8pm"), arrival rule ("when I get home, turn on the lights"); devices registered in smart_devices table via REPL; enabled via SMARTTHINGS_TOKEN env var
22) ✅ Extended SmartThings commands — go beyond on/off; support volume (set/up/down/mute), channel switching, input source (HDMI1/2), media playback (play/pause); requires expanding sendDeviceCommand to accept arbitrary capability+command, updating intent schema, and updating LLM prompt; check TV's actual supported capabilities first via `smartthings devices:capabilities <id>`
22b) ✅ README: Xiaomi air purifier → SmartThings bridge guide — document how to connect a Xiaomi air purifier to SmartThings using mi_connector (https://github.com/fison67/mi_connector) so it can be controlled via homepi; note the Groovy/DTH deprecation issue and alternative paths
22c) [skipped] README: Tadiran AC → SmartThings via Tuya Edge Driver
22d) [skipped] AC commands in COMMAND_MAP (SmartThings AC via Tuya Edge Driver)
23) LLM integration tests in CI — run the eval suite against a real LLM on every PR so regressions in intent parsing are caught automatically; open question: use OpenAI (costs money, needs secret in CI) vs. a local model via Ollama (free, slower, needs self-hosted runner or Docker-in-Docker); pass threshold TBD (e.g. ≥ 90%)
24) ✅ Home Assistant integration — control devices that can't connect to SmartThings (Tadiran AC via Tuya, Xiaomi purifier via Mi Home) through HA's REST API; parallel backend alongside SmartThings; dispatch on which table a device is registered in (smart_devices → ST, ha_devices → HA); no OAuth dance — static long-lived Bearer token; new env vars: HOMEASSISTANT_URL, HOMEASSISTANT_TOKEN
25) ✅ Generic HA commands + sensor queries — setMode (fan/set_preset_mode), query_device intent (GET /api/states/{id}); lock/unlock via existing on/off on a registered switch entity; HAQueryFn wired through the full stack
26) ✅ HA device auto-discovery — Discord command "sync HA devices" that GETs /api/states from HA, lists all entity IDs grouped by domain (fan, climate, sensor, switch, light, cover, media_player, …), and inserts missing ones into ha_devices using a sanitised version of the entity's friendly_name as the name (e.g. "fan.xiaomi_cpa4_811c" → "xiaomi cpa4 811c fan"); duplicate names are skipped; bot replies with a summary of what was added vs already known; no removal of existing records
27) ✅ LLM improvements — conversation history (SQLite-persisted, last 5 exchanges within 2h injected into OpenAI calls); device context injection (registered names+aliases in system prompt); device aliases (ha_devices.aliases, alias_device intent); embedding fuzzy search (3-tier lookup: exact → alias → text-embedding-3-small cosine similarity); task execution tracking + proactive suggestions (patterns >= 3 at same hour → Discord suggestion 12h before next expected run)
28) ✅ AC commands — setTemperature, setHvacMode, setFanMode for HA climate entities; intent schema + LLM prompt + HA_COMMAND_MAP updated
29) ✅ Browse & selectively connect HA devices — browse_ha_devices (show unregistered entities grouped by domain, optional domain filter); add_ha_devices (register chosen entities by entity_id); LLM resolves numbers/names from conversation history to entity IDs; SKIP_DOMAINS env var to exclude noisy domains
30) ✅ Voice control — two input paths feeding the same parseIntent → handler pipeline: (1) Discord voice channel: bot auto-joins VC, per-user Opus audio decoded → WAV → Whisper → text; (2) Pi microphone: arecord 5-second chunks → Whisper → text; both paths reply in the configured Discord channel and optionally speak via TTS
31) ✅ Android TV Remote — launchApp (media_player/play_media, type=app), sendKey (remote/send_command), listApps (reads app_list attribute from HA state); intent schema + LLM prompt + HA_COMMAND_MAP updated
32) Room labels for devices — add a `room` column to ha_devices (and smart_devices); Discord command "set room of <device> to <room>" to label existing devices; room included when registering new devices via add_ha_devices; room injected into the LLM device context so the model can disambiguate ("turn off the ac in the bedroom" when multiple ACs exist); alias_device intent extended or a new set_device_room intent added
33) ✅ Help command — "what can you do?" / "help" / "list commands" → bot replies with a formatted list of all supported intents with one-line descriptions and example phrases for each; no OpenAI call needed; plain static response generated from a known-good list
34) ✅ Conditional device rules — rules that fire based on device state rather than time or arrival; two sub-cases: (a) duration condition: "if the TV is on for 2 hours, turn it off" — scheduler polls the device's HA state at a configurable interval, starts a countdown when the condition is first met, fires the action once the duration elapses; (b) threshold condition: "if the AC temperature is above 26°, set it to 24°" — same polling approach, fires when the numeric state crosses the threshold; new trigger type `condition` added to intent schema + rules table; condition stored in action_json as `{ "condition_entity_id": "media_player.tv", "condition_state": "on", "duration_sec": 7200, ... }`; scheduler polls every SCHEDULER_INTERVAL_SEC, tracks condition_onset_ts in rules table; no new HA integration needed (uses existing queryHAFn); action type can be `device_control` or `notify`

---

## Touchscreen + Speakers (v1 UX expansion)

> Speakers (TTS + YouTube) are already implemented in items 15–16. The items below add a local touchscreen UI and fill speaker gaps.

35) Touchscreen foundation — kiosk web app + WebSocket command bridge — serve a static web app on :8080 from the existing Node.js process (Express/Fastify static handler); add a WebSocket endpoint that (a) pushes all Discord bot-channel messages to connected clients and (b) accepts command strings from clients and processes them through the same `processCommand` pipeline as Discord messages, using a fixed "local" userId/username; home screen shows: clock, date, who's home (polled via existing `/health` or a new `/state` REST endpoint); Chromium kiosk launch via `chromium-browser --kiosk --noerrdialogs http://localhost:8080` in a Pi systemd unit or docker-compose `command`; new env var: `TOUCHSCREEN_ENABLED=true` to opt in

36) Touchscreen — chat panel — scrollable message history showing all bot-channel messages received via WS; input bar at bottom for typed commands; sends via WS → same intent pipeline as Discord; no new backend logic needed (depends on #35)

37) Touchscreen — weather widget — fetch current conditions + 3-day forecast from OpenWeatherMap free API; new `src/weather/weather.client.ts`; 1-hour in-memory cache; REST endpoint GET `/weather` on the existing server; widget on the home screen showing temp, icon, humidity, wind; new env vars: `WEATHER_API_KEY`, `WEATHER_LAT`, `WEATHER_LON`

38) Touchscreen — photo slideshow — reads JPEG/PNG files from `/data/photos` (Docker volume); auto-advances every `PHOTO_INTERVAL_SEC` (default 30); full-screen toggle via tap; served as static files under `/photos/*`; no new backend needed beyond the static server from #35

39) Touchscreen — device shortcut tiles — GET `/devices` endpoint returns all registered devices with room labels and most-used command (from task_executions); touch tile sends on/off (or most-used command) via WS bridge → existing HA/ST pipeline; tiles grouped by room; dynamically generated from DB

40) Touchscreen — media controls panel — displays active HA `media_player` entity state (polled from existing `queryHAFn`); play/pause/stop/volume slider → sends commands via WS bridge; "Play YouTube" input → plays via existing yt-dlp/ffplay pipeline; saved quick-play shortcuts in new `sound_shortcuts` table (name + URL, managed via Discord "save shortcut" command)

41) Speaker volume control — set Pi system audio volume via Discord or touchscreen; uses `amixer sset Master <n>%` (ALSA) or `pactl set-sink-volume` (PulseAudio); new intent `set_volume` with a `volume` field (0–100); wired to both Discord and the WS bridge; stops current playback via `killall ffplay yt-dlp` on a "stop" command

## Acceptance
- Pairing works
- Time notifications fire at expected Pi-local time
- Arrival notifications fire on away→home transition
- OpenAI failure → Discord error + no side effects
- Evals run and print a summary
- REPL connects over SSH and can query/modify live app state
- TTS plays spoken output through Pi speakers on arrival and notifications
- Sound playback fires on rule triggers (file path or YouTube URL)
- SmartThings device commands fire on immediate request, scheduled time, and arrival

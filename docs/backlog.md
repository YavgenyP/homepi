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
33) Help command — "what can you do?" / "help" / "list commands" → bot replies with a formatted list of all supported intents with one-line descriptions and example phrases for each; no OpenAI call needed; plain static response generated from a known-good list
34) Conditional device rules — rules that fire based on device state rather than time or arrival; two sub-cases: (a) duration condition: "if the TV is on for 2 hours, turn it off" — scheduler polls the device's HA state at a configurable interval, starts a countdown when the condition is first met, fires the action once the duration elapses; (b) threshold condition: "if the AC temperature is above 26°, set it to 24°" — same polling approach, fires when the numeric state crosses the threshold; new trigger type `condition` added to intent schema + rules table; condition stored in action_json as `{ "condition_entity_id": "media_player.tv", "condition_state": "on", "duration_sec": 7200, "action": {...} }`; scheduler polls every SCHEDULER_INTERVAL_SEC, tracks condition-onset timestamp in scheduled_jobs; no new HA integration needed (uses existing queryHAFn)

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

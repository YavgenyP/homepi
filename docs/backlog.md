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

**UI design principles (6–7" display, ~800×480):**
- Minimum touch target: 72×72px
- Bottom navigation bar (thumb zone), 5 tabs: Home · Devices · Media · Weather · Chat
- Dark theme throughout (always-on, low eye strain)
- No interaction required for passive screens (weather, photos)
- Voice/mic button always reachable on Chat screen; typing is secondary
- Idle after 5 min → full-screen photo slideshow; any tap returns to Home

35) Touchscreen foundation — kiosk web app + WebSocket command bridge — serve a static web app on :8080 from the existing Node.js process; add a WebSocket endpoint that (a) pushes all bot-channel messages to connected clients and (b) accepts command strings from clients and runs them through the same `processCommand` pipeline using a fixed "local" userId; REST endpoint GET `/ui-state` returns `{ presenceStates, devices, now }`; bottom nav bar with 5 large tabs; Home screen shows: large clock + date top-left, who's home top-right (colored dot per person), 4 large quick-action tiles (most-used from task_executions); Chromium kiosk: `chromium-browser --kiosk --noerrdialogs --disable-infobars http://localhost:8080`; new env var: `TOUCHSCREEN_ENABLED=true`

36) Touchscreen — Devices screen — room tabs across top (scrollable if many rooms); 2-column grid of device tiles below (each ~180×100px); tile shows device name, current state (on/off/temp), and large toggle button; room tab + tile data from GET `/ui-state`; tap tile → sends command via WS bridge → existing HA/ST pipeline; depends on #35

37) Touchscreen — Weather screen — full-screen layout: large current temp + condition icon + city name top half; 3-day forecast tiles (day / icon / high / low) bottom half; GET `/weather` endpoint backed by OpenWeatherMap free API, 1-hour cache; auto-refreshes every 10 min on the screen; new env vars: `WEATHER_API_KEY`, `WEATHER_LAT`, `WEATHER_LON`; no touch interaction needed

38) Touchscreen — Photo slideshow (idle screen) — reads JPEG/PNG from `/data/photos` Docker volume, served under `/photos/*`; after `SCREEN_IDLE_SEC` (default 300) of no touch, transitions to full-screen slideshow with crossfade; tap anywhere returns to Home; manual photo advance on the Photos tab; no backend beyond static file server from #35

39) Touchscreen — Media screen — top: now-playing info (title/artist from HA media_player state, polled every 5s via `/ui-state`); center: large play/pause (100px), prev/next, stop buttons; full-width volume slider; bottom: 2-row scrollable grid of saved YouTube shortcut tiles (name + thumbnail color); tap shortcut → plays via existing yt-dlp/ffplay; shortcuts stored in new `sound_shortcuts` table (name TEXT, url TEXT); managed via Discord "save shortcut <name> <url>" / "delete shortcut <name>"

40) Touchscreen — Chat screen — message list (bot channel history, newest at bottom); floating mic button bottom-right (80px circle, always visible); tap mic → records via Pi mic / Web Audio API and sends via WS; text input bar only appears when user taps keyboard icon; messages rendered with sender name + timestamp; depends on #35

41) Speaker volume control — `set_volume` intent with `volume` field (0–100); backend uses `amixer sset Master <n>%` (ALSA) or `pactl` (PulseAudio), detected at startup; also a "stop" command that kills current ffplay/yt-dlp process; wired to Discord intent pipeline and WS bridge (touchscreen volume slider); new env var: `AUDIO_BACKEND=alsa|pulse|auto`

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

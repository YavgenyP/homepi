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

**Architecture: Node.js (Docker) serves the web app on :8080. Chromium runs on the Pi host in kiosk mode pointing to http://localhost:8080 — it is a dumb browser, completely decoupled from Docker. No build pipeline on the frontend: plain HTML/CSS/JS + Alpine.js (14KB CDN) for reactivity.**

**Pi host Chromium setup (one-time):**
```
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  --touch-events=enabled --enable-features=OverlayScrollbar \
  http://localhost:8080
```
Autostarted via `/etc/xdg/autostart/homepi-kiosk.desktop` or a systemd user unit.

**UI design principles (Official Display v2, 800×480):**
- Minimum touch target: 72×72px; prefer 80–100px for primary actions
- Bottom navigation bar (thumb zone), 5 tabs: Home · Devices · Media · Weather · Chat
- Dark theme throughout (always-on, low eye strain)
- Passive screens (weather, photos) require zero interaction
- Voice/mic button always reachable; on-screen keyboard is last resort
- Idle after 5 min → full-screen photo slideshow; any tap returns to Home

**Build order (each item is independently useful, dependencies noted):**

35) Touchscreen foundation — WS bridge + Home screen — serve static files from `src/ui/` on :8080 (new Fastify route); WebSocket endpoint `/ws`: pushes all bot-channel messages to clients, receives command strings and runs them through `processCommand` using a fixed `LOCAL_USER_ID`/`LOCAL_USERNAME` env vars; REST GET `/ui-state` returns `{ people: [{name, state}], devices: [{name, room, entity_id}], topCommands: [{device, command, count}] }`; Home screen HTML: large clock + date (top-left), who's home dots (top-right), 4 quick-action tiles (80×80px min, populated from topCommands); bottom nav bar 60px; new env var: `TOUCHSCREEN_ENABLED=true` (gates the :8080 server)

41) Speaker volume control — do this early since it's also useful from Discord — `set_volume` intent (volume 0–100) + `stop_sound` intent; backend: `src/sound/volume.ts` tries `pactl` then falls back to `amixer`; kills active ffplay/yt-dlp on stop; wired into Discord intent pipeline; volume slider on Media screen uses this endpoint; new env var: `AUDIO_BACKEND=alsa|pulse|auto`

36) Touchscreen — Devices screen + domain-aware widgets — `/ui-state` enriched with live HA state per device (entity_id → `{ state, attributes }`); UI extracts domain from entity_id and renders the matching widget template:
- `climate.*` → temp readout, target temp ±1° tap buttons, mode chips (cool/heat/auto/off)
- `media_player.*` → on/off toggle, volume −/+ buttons, play/pause
- `fan.*` → on/off toggle, mode selector row (auto/low/medium/high/sleep)
- `light.*` → on/off toggle, brightness slider
- `switch.*` → single large on/off toggle
- `sensor.*` → read-only value + unit badge (no controls)
- SmartThings (no entity_id) → on/off toggle; add `device_type` column to `smart_devices` (migration 010) for future refinement
Room tabs row (scrollable, 60px); tile grid 2-column below; state refreshes every 3s; tap action → POST `/command`; depends on #35

39) Touchscreen — Media screen — now-playing bar top (title from HA media_player, polled 5s); center: play/pause (100px circle), stop, prev/next; volume slider full-width; saved shortcuts grid bottom (2 rows, scrollable); shortcuts in new `sound_shortcuts` table (name TEXT, url TEXT); Discord: "save shortcut <name> <url>" / "delete shortcut <name>"; depends on #35, #41

37) Touchscreen — Weather screen — GET `/weather` backed by OpenWeatherMap free API, 1h cache, `src/weather/weather.client.ts`; full-screen: large temp + icon + city top half, 3-day forecast tiles bottom half; auto-refresh 10 min; new env vars: `WEATHER_API_KEY`, `WEATHER_LAT`, `WEATHER_LON`; depends on #35

38) Touchscreen — Photo slideshow (idle) — syncs photos from a Google Drive folder using the existing service account (same key file as GCal); new `src/photos/gdrive.client.ts` polls Drive folder every `PHOTO_SYNC_INTERVAL_MIN` (default 60) and downloads JPEG/PNG into `/data/photos`; photos served under `/photos/*`; CSS crossfade transition on the UI; idle timeout `SCREEN_IDLE_SEC` (default 300) triggers full-screen slideshow overlay; tap anywhere dismisses; Photos tab allows manual advance; new env var: `GDRIVE_PHOTOS_FOLDER_ID` (the Drive folder ID to sync from); setup: share the folder with the service account email, paste the folder ID from the Drive URL

40) Touchscreen — Chat screen — message list (history from WS, newest at bottom, auto-scroll); floating mic button 80px bottom-right (uses Pi mic pipeline from item 30 via WS); text input bar hidden until keyboard icon tapped (minimises accidental keyboard pop-up); message bubbles: bot messages left, local/user messages right; depends on #35

43) Presence fix — ping-based detection not working reliably; investigate and repair arrival/departure detection

44) ✅ Touchscreen home widgets — Hebrew news ticker (RSS feed via NEWS_RSS_URL env var, 15-min cache, cycles headlines every 7s with RTL rendering); upcoming reminders strip (query pending notify rules + scheduled_jobs, show time + message as pills); GET /news endpoint; reminders included in GET /ui-state response

45) ✅ Touchscreen media controls — mpv IPC socket (--input-ipc-server=/tmp/mpv-socket); POST /media/pause-toggle (cycle pause + track piPaused state); POST /media/seek (seek delta seconds, relative); GET /now-playing now includes paused field; media tab player card replaces basic now-playing bar: title, seek −30/−10, play/pause toggle, seek +10/+30, stop

46) Discord YouTube search — say "play lofi" → yt-dlp ytsearch5 → 5 numbered results in Discord → reply with number to play on Pi + update touchscreen now-playing; search_and_play intent + search_query field; pendingSearches Map; numeric reply intercept in handleMessage before LLM

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

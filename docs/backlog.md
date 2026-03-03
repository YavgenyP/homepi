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
22b) README: Xiaomi air purifier → SmartThings bridge guide — document how to connect a Xiaomi air purifier to SmartThings using mi_connector (https://github.com/fison67/mi_connector) so it can be controlled via homepi; note the Groovy/DTH deprecation issue and alternative paths
23) LLM integration tests in CI — run the eval suite against a real LLM on every PR so regressions in intent parsing are caught automatically; open question: use OpenAI (costs money, needs secret in CI) vs. a local model via Ollama (free, slower, needs self-hosted runner or Docker-in-Docker); pass threshold TBD (e.g. ≥ 90%)

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

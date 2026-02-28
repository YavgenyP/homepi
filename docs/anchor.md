# Project Anchor: Pi Home Assistant (Node.js, Docker, Discord)

## Goal (v0)
Node.js service running in Docker on Raspberry Pi:
- Presence detection via **Ping + BLE**
- Discord chat control with **LLM-based intent parsing from day 1**
- Arrival greeting (Discord first, TTS later)
- Automations:
  - Triggers: time, arrival
  - Action: notification (Discord v0)
- Evaluation built-in:
  - Offline evals in tests (golden set)
  - Online logging + sampling for real messages

## Constraints
- Must run in Docker on Pi
- Windows dev environment (no WSL unless absolutely required)
- BLE must be feature-flagged and optional
- LLM parsing must return **strict structured JSON** (no brittle string parsing)
- If OpenAI fails → **post an error to Discord** and do nothing else
- If blocked or missing info → ASK USER
- No scope drift

## UX rules
- Messages can be Hebrew or English; respond in the user’s language if obvious, otherwise English.
- Everyone can use the bot (no admin gate in v0).
- Timezone is derived from the **Pi’s local timezone**.
- Discord is the only UX surface in v0 (no dashboards).

## Presence Strategy (v0)
Providers:
- Ping (fully supported in Windows dev)
- BLE (Pi integration only, feature-flagged)

Home state rule:
- Person is HOME if any provider reports seen within TTL window.
- Debounced transitions only.

## Pairing strategy (v0)
Simplest pairing: **explicit registration** via Discord:
- “register my phone 192.168.1.23” (ping)
- “register my ble aa:bb:cc:dd:ee:ff” (optional)
Bot stores mapping:
- Discord user → person record → identifiers

No router integration, no mobile app required.

## Definition of done (v0)
- User can register phone identifiers (IP and/or BLE MAC) via Discord
- Create time-based notify rule via natural language in Discord
- Create arrival-based notify rule via natural language in Discord
- Bot asks clarifying questions when needed
- If OpenAI fails, bot returns an error message to Discord and does not create/modify rules
- Evals run in tests and produce a summary
- Events fire / notifications are delivered as scheduled

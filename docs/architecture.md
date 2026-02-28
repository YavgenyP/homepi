# Architecture (Ping + BLE + LLM parsing + eval)

## Modules
- presence/
  - provider.interface.ts
  - ping.provider.ts
  - ble.provider.ts (feature-flagged)
  - presence.state.ts (debounce + TTL)
- discord/
  - discord.client.ts
  - intent.parser.ts (OpenAI Structured Outputs / strict JSON)
  - handlers/ (pair/register, who_home, create_rule, list_rules, delete_rule, help)
- scheduler/
- rules/
- notify/
- storage/ (SQLite)
- evals/
  - dataset/ (golden messages)
  - runner/ (score + schema checks)
- observability/

## LLM Intent Parsing (v0)
Use OpenAI API to produce **strict JSON** matching a schema.

Suggested intent shape:
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
- If `clarifying_question` is set OR confidence < threshold → ask user; no side effects.
- If OpenAI call fails → send Discord error; no side effects.

## Pairing / Identity mapping (v0)
- `pair_phone` intent stores identifiers in `person_devices`.
- Presence providers only check registered identifiers.

## Timezone
All scheduling uses the Pi local timezone.

## Storage (SQLite)
Tables:
- people(id, discord_user_id, name, created_at)
- person_devices(id, person_id, kind, value, created_at)  # kind=ping_ip | ble_mac
- presence_events(id, person_id, state, ts, raw_json)
- rules(id, name, trigger_type, trigger_json, action_type, action_json, enabled, created_at)
- scheduled_jobs(id, rule_id, next_run_ts, status, last_run_ts, last_error)
- llm_message_log(id, ts, user_id, channel_id, message_text, intent_json, confidence, was_clarified, raw_response_json)

## Docker note for BLE (Pi only)
BLE scanning may need host networking and access to BlueZ/DBus. Document compose flags when implementing BLE.

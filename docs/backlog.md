# Backlog (v0)

1) ✅ Repo scaffolding + Docker + /health
2) ✅ Discord bot skeleton + health reporting
3) ✅ LLM intent parser (strict JSON) + schema validation
4) ✅ Evals harness: golden dataset + runner + score summary
5) ✅ SQLite + migrations (people, person_devices, rules, jobs, llm_message_log)
6) Pairing flow via Discord (register IP / BLE MAC)
7) Presence framework + Ping provider using registered IPs
8) Presence state machine + arrival greeting (Discord)
9) Rule CRUD via Discord (through intents)
10) Time scheduler + notification action
11) Arrival trigger rule evaluation
12) BLE provider (feature-flagged, Pi only)
13) Docs polish + demo verification

## Acceptance
- Pairing works
- Time notifications fire at expected Pi-local time
- Arrival notifications fire on away→home transition
- OpenAI failure → Discord error + no side effects
- Evals run and print a summary

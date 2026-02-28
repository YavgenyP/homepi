# CLAUDE.md — Repo Contract (Read First)

Authority order:
1) CLAUDE.md
2) docs/anchor.md
3) docs/backlog.md
4) docs/demo.md
5) docs/long-term-vision.md

---

## Non-Negotiables

- Discord is the only UX. Do NOT add dashboards or extra UIs.
- LLM is used for intent parsing only, returning strict JSON.
- Always validate LLM schema output.
- If confidence is low → ask a clarifying question. No guessing.
- If OpenAI fails → post an error to Discord and do nothing else.
- Presence is ping-first; BLE is optional and Pi-only.
- Scheduling must survive restarts.
- System state must be recoverable from SQLite alone.
- No speculative abstractions or “future-proofing” code.

---

## Workflow

- One backlog item per branch.
- For each item:
  1) Implement minimal change
  2) Add tests
  3) Run tests + evals
  4) Update docs if needed
  5) Commit

- If blocked or ambiguous: STOP and ask the user.

---

## Design Philosophy

Keep the system:

Small.
Predictable.
Composable.
Local-first.

Prefer simple over clever.
Prefer explicit over magical.

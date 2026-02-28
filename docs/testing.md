# Testing + Evaluation

## Unit tests
- Intent schema validation
- Pairing parsing (IP/MAC)
- Rule validation
- Scheduler next-run calculation
- Presence state transitions

## Offline evals (required)
- `evals/dataset/intents.jsonl`: golden messages + expected structured intent (or key fields)
- Eval runner:
  - calls OpenAI (or uses recorded fixtures mode)
  - scores schema validity + correctness
  - prints summary + examples of failures

## Online logging
- Store each message + parsed intent + confidence + clarification outcome in SQLite.
- Sample messages based on `LLM_EVAL_SAMPLING_RATE` for later review.

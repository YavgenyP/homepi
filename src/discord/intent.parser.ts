import OpenAI from "openai";
import { IntentSchema, type Intent } from "./intent.schema.js";

const SYSTEM_PROMPT_BASE = `You are a home automation assistant. Parse the user's message into a strict JSON object.

Your JSON must match this shape exactly:
{
  "intent": "pair_phone" | "create_rule" | "list_rules" | "delete_rule" | "who_home" | "help" | "unknown",
  "trigger": "time" | "arrival" | "none",
  "action": "notify" | "none",
  "message": string | null,
  "time_spec": { "datetime_iso"?: string, "cron"?: string } | null,  // cron must have exactly 5 fields: minute hour day month weekday
  "person": { "ref": "me" | "name", "name"?: string } | null,
  "phone": { "ip"?: string, "ble_mac"?: string } | null,
  "sound_source": string | null,
  "require_home": boolean,
  "confidence": number between 0 and 1,
  "clarifying_question": string | null
}

- person: for create_rule, who should receive the notification. null or ref="me" means the user themselves; ref="name" with a name targets another registered person.
- sound_source: a file path (e.g. /data/sounds/alarm.mp3) or a URL (e.g. a YouTube link) to play when the rule fires. null if no sound requested.
- require_home: true if the user says the rule should only fire when the target person is home (e.g. "only if she's home", "but only when Alice is home"). Default false.

Rules:
- If the message is ambiguous or missing required info, set clarifying_question to your question and confidence below 0.75.
- If you are confident, set clarifying_question to null and confidence >= 0.75.
- respond only in valid JSON. No extra text.
- Respond in the same language as the user.`;

function buildSystemPrompt(): string {
  const now = new Date();
  return `${SYSTEM_PROMPT_BASE}\n\nCurrent date and time: ${now.toISOString()} (use this to resolve relative times like "in 2 minutes", "tomorrow at 8pm", "every weekday").`;
}

export async function parseIntent(
  userText: string,
  client: OpenAI,
  model: string
): Promise<Intent> {
  const completion = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: userText },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  const parsed = JSON.parse(raw);
  return IntentSchema.parse(parsed);
}

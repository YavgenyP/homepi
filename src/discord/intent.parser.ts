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

function localIsoWithOffset(now: Date): string {
  const offsetMin = -now.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  const offset = `${sign}${hh}:${mm}`;
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `T${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}${offset}`
  );
}

function buildSystemPrompt(): string {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localIso = localIsoWithOffset(now);
  return (
    `${SYSTEM_PROMPT_BASE}\n\n` +
    `Current local date and time: ${localIso} (timezone: ${tz}). ` +
    `Use this to resolve relative times like "in 2 minutes", "tomorrow at 8pm", "every weekday". ` +
    `Always include the timezone offset in datetime_iso (e.g. "2026-03-01T20:00:00+03:00").`
  );
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

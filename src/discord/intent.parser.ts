import OpenAI from "openai";
import { IntentSchema, type Intent } from "./intent.schema.js";

const SYSTEM_PROMPT = `You are a home automation assistant. Parse the user's message into a strict JSON object.

Your JSON must match this shape exactly:
{
  "intent": "pair_phone" | "create_rule" | "list_rules" | "delete_rule" | "who_home" | "help" | "unknown",
  "trigger": "time" | "arrival" | "none",
  "action": "notify" | "none",
  "message": string | null,
  "time_spec": { "datetime_iso"?: string, "cron"?: string } | null,
  "person": { "ref": "me" | "name", "name"?: string } | null,
  "phone": { "ip"?: string, "ble_mac"?: string } | null,
  "confidence": number between 0 and 1,
  "clarifying_question": string | null
}

Rules:
- If the message is ambiguous or missing required info, set clarifying_question to your question and confidence below 0.75.
- If you are confident, set clarifying_question to null and confidence >= 0.75.
- respond only in valid JSON. No extra text.
- Respond in the same language as the user.`;

export async function parseIntent(
  userText: string,
  client: OpenAI,
  model: string
): Promise<Intent> {
  const completion = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userText },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  const parsed = JSON.parse(raw);
  return IntentSchema.parse(parsed);
}

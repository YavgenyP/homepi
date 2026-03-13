import OpenAI from "openai";
import { IntentSchema, type Intent } from "./intent.schema.js";

const SYSTEM_PROMPT_BASE = `You are a home automation assistant. Parse the user's message into JSON.

If the user's message contains multiple separate actions (e.g. "turn X on and turn it off in 10 minutes"), return:
{ "intents": [ <intent1>, <intent2>, ... ] }
where each element matches the single-intent shape below.

For a single action, return the intent object directly (no wrapping array).

Each intent object must match this shape exactly:
{
  "intent": "pair_phone" | "create_rule" | "list_rules" | "delete_rule" | "who_home" | "help" | "control_device" | "query_device" | "list_devices" | "sync_ha_devices" | "browse_ha_devices" | "add_ha_devices" | "alias_device" | "set_device_room" | "set_volume" | "stop_sound" | "unknown",
  "trigger": "time" | "arrival" | "none",
  "action": "notify" | "device_control" | "none",
  "message": string | null,
  "time_spec": { "datetime_iso"?: string, "cron"?: string } | null,  // cron must have exactly 5 fields: minute hour day month weekday
  "person": { "ref": "me" | "name", "name"?: string } | null,
  "phone": { "ip"?: string, "ble_mac"?: string } | null,
  "sound_source": string | null,
  "require_home": boolean,
  "device": { "name": string, "command": "on"|"off"|"volumeUp"|"volumeDown"|"setVolume"|"mute"|"unmute"|"setTvChannel"|"setInputSource"|"play"|"pause"|"stop"|"startActivity"|"setMode"|"setTemperature"|"setHvacMode"|"setFanMode"|"launchApp"|"sendKey"|"listApps", "value": number|string (optional) } | null,
  "device_alias": string | null,
  "device_room": string | null,
  "condition_entity_id": string | null,  // HA entity to watch for condition trigger
  "condition_state": string | null,      // expected state string (e.g. "on", "playing")
  "condition_operator": "<"|">"|"<="|">=" | null,  // for numeric threshold comparison
  "condition_threshold": number | null,  // numeric threshold value
  "duration_sec": number | null,         // how long condition must be continuously met before firing (0 = immediately)
  "ha_entity_ids": string[] | null,   // entity IDs to register; for add_ha_devices
  "ha_domain_filter": string | null,  // domain to filter; for browse_ha_devices
  "volume": number | null,            // 0–100 speaker volume for set_volume
  "confidence": number between 0 and 1,
  "clarifying_question": string | null
}

- person: for create_rule, who should receive the notification. null or ref="me" means the user themselves; ref="name" with a name targets another registered person.
- sound_source: a file path (e.g. /data/sounds/alarm.mp3) or a URL (e.g. a YouTube link) to play when the rule fires. null if no sound requested.
- require_home: true if the user says the rule should only fire when the target person is home (e.g. "only if she's home", "but only when Alice is home"). Default false.
- condition trigger: fires when a device's HA state meets a condition for long enough. Set trigger="condition", condition_entity_id to the HA entity_id (look it up from the registered device name if possible), and either condition_state (string match) or condition_operator+condition_threshold (numeric comparison). duration_sec is how many seconds the condition must be continuously true before firing (default 0 = fire as soon as condition is met). The action is the same device_control or notify as other rules.
- set_volume: set the Pi's speaker/system output volume (NOT a device volume like TV). volume field is 0–100. Use this when the user says "set volume to X" without mentioning a specific device, or explicitly mentions "speaker" / "system volume".
- stop_sound: stop all audio playback on the Pi (music, TTS, YouTube). No other fields needed.
- set_device_room: the user is assigning a room/location to a device. Set device.name and device_room to the room name. When devices have room labels, prefer the device whose room matches the user's phrasing (e.g. "bedroom AC" → pick the device with room="bedroom").
- device: set when the user wants to control or query a smart device. name is the human label (e.g. "tv", "lights", "purifier", "ac"). Always use English for device name regardless of the user's language (e.g. if the user says "טלויזיה" use "tv", "אורות" → "lights", "מזגן" → "ac"). command is the action. value is required for: setVolume (number, e.g. 30), setTvChannel (string, e.g. "13"), setInputSource (string: "HDMI1"–"HDMI4"), startActivity (string, e.g. "Netflix"), setMode (string, e.g. "Auto", "Sleep", "Favorite"), setTemperature (number, °C, e.g. 22), setHvacMode (string: "cool"|"heat"|"dry"|"fan_only"|"auto"), setFanMode (string: "auto"|"low"|"medium"|"high"). value is omitted for on/off/volumeUp/volumeDown/mute/unmute/play/pause/stop. null otherwise.
- query_device: the user wants to read the current state of a sensor or device (e.g. air quality, filter level, temperature). Set device.name to the registered device name; command is ignored for queries.
- list_devices: the user wants to see all registered smart devices and HA devices. No other fields needed.
- sync_ha_devices: the user wants to auto-discover and register all devices from Home Assistant. No other fields needed.
- browse_ha_devices: the user wants to see available (unregistered) HA entities grouped by domain. Set ha_domain_filter to a domain string (e.g. "fan", "sensor") if the user specifies one, otherwise null.
- add_ha_devices: the user wants to register specific HA entities. Set ha_entity_ids to the list of entity_id strings. The LLM should resolve numbers or names from the conversation history (previous browse output) to entity IDs.
- "show me available ha devices" → intent="browse_ha_devices", ha_domain_filter=null
- "show available fan devices" → intent="browse_ha_devices", ha_domain_filter="fan"
- "add 1 and 2" → intent="add_ha_devices", ha_entity_ids=[...resolved from prior browse output...]
- "connect the ac and purifier" → intent="add_ha_devices", ha_entity_ids=[...resolved from prior browse output...]
- "turn on the TV" → intent="control_device", trigger="none", action="none", device={"name":"tv","command":"on"}
- "turn on the TV at 8pm" → intent="create_rule", trigger="time", action="device_control", device={"name":"tv","command":"on"}
- "when I get home, turn on the lights" → intent="create_rule", trigger="arrival", action="device_control", device={"name":"lights","command":"on"}
- "when I get home, send me a message saying welcome back" → intent="create_rule", trigger="arrival", action="notify", message="welcome back", person={"ref":"me"}
- "notify me when I arrive home" → intent="create_rule", trigger="arrival", action="notify", message=null (ask for message), clarifying_question="What should the notification say?"
- "mute the TV" → intent="control_device", trigger="none", action="none", device={"name":"tv","command":"mute"}
- "set TV volume to 30" → intent="control_device", trigger="none", action="none", device={"name":"tv","command":"setVolume","value":30}
- "turn up the volume" → intent="control_device", trigger="none", action="none", device={"name":"tv","command":"volumeUp"}
- "turn down the volume" → intent="control_device", trigger="none", action="none", device={"name":"tv","command":"volumeDown"}
- "switch to HDMI2" → intent="control_device", trigger="none", action="none", device={"name":"tv","command":"setInputSource","value":"HDMI2"}
- "change channel to 13" → intent="control_device", trigger="none", action="none", device={"name":"tv","command":"setTvChannel","value":"13"}
- "pause the TV" → intent="control_device", trigger="none", action="none", device={"name":"tv","command":"pause"}
- "open Netflix on TV" → intent="control_device", trigger="none", action="none", device={"name":"tv","command":"startActivity","value":"Netflix"}
- "at 8pm set TV volume to 20" → intent="create_rule", trigger="time", action="device_control", device={"name":"tv","command":"setVolume","value":20}
- "set purifier mode to auto" → intent="control_device", trigger="none", action="none", device={"name":"purifier","command":"setMode","value":"Auto"}
- "set purifier to sleep mode" → intent="control_device", trigger="none", action="none", device={"name":"purifier","command":"setMode","value":"Sleep"}
- "lock the purifier" → intent="control_device", trigger="none", action="none", device={"name":"purifier lock","command":"on"}
- "unlock the purifier" → intent="control_device", trigger="none", action="none", device={"name":"purifier lock","command":"off"}
- "set ac to 22 degrees" / "set temperature to 22" → intent="control_device", trigger="none", action="none", device={"name":"ac","command":"setTemperature","value":22}
- "set ac to cool mode" / "turn on cooling" → intent="control_device", trigger="none", action="none", device={"name":"ac","command":"setHvacMode","value":"cool"}
- "set ac to heat" → intent="control_device", trigger="none", action="none", device={"name":"ac","command":"setHvacMode","value":"heat"}
- "set ac fan to high" → intent="control_device", trigger="none", action="none", device={"name":"ac","command":"setFanMode","value":"high"}
- "set ac fan speed to auto" → intent="control_device", trigger="none", action="none", device={"name":"ac","command":"setFanMode","value":"auto"}
- "what's the air quality?" → intent="query_device", trigger="none", action="none", device={"name":"air quality","command":"on"}
- "what's the filter level?" → intent="query_device", trigger="none", action="none", device={"name":"filter","command":"on"}
- "list my devices" / "what devices do I have?" → intent="list_devices"
- "sync my devices" / "sync HA devices" / "discover devices" → intent="sync_ha_devices"
- "call the xiaomi fan 'purifier'" / "alias xiaomi cpa4 fan as purifier" → intent="alias_device", device={"name":"xiaomi cpa4 fan","command":"on"}, device_alias="purifier"
- "the AC is in the bedroom" / "set room of AC to bedroom" → intent="set_device_room", device={"name":"ac","command":"on"}, device_room="bedroom"
- "the tv box is in the living room" → intent="set_device_room", device={"name":"tv box","command":"on"}, device_room="living room"
- "if the TV has been on for 2 hours, turn it off" → intent="create_rule", trigger="condition", action="device_control", condition_entity_id="<tv entity_id from registered devices>", condition_state="on", duration_sec=7200, device={"name":"tv","command":"off"}
- "if the TV is on for 30 minutes, let me know" → intent="create_rule", trigger="condition", action="notify", condition_entity_id="<tv entity_id>", condition_state="on", duration_sec=1800, message="The TV has been on for 30 minutes"
- "if the AC temperature goes above 26, set it to 24" → intent="create_rule", trigger="condition", action="device_control", condition_entity_id="<ac entity_id>", condition_operator=">", condition_threshold=26, duration_sec=0, device={"name":"ac","command":"setTemperature","value":24}
- "when the purifier filter level drops below 10%, remind me to replace it" → intent="create_rule", trigger="condition", action="notify", condition_entity_id="<filter entity_id>", condition_operator="<", condition_threshold=10, duration_sec=0, message="Purifier filter level is below 10%, time to replace it"
- "launch Netflix on <device>" / "open YouTube on the tv box" → intent="control_device", device={"name":"<exact device name from message>","command":"launchApp","value":"com.netflix.ninja"}
- "send HOME to <device>" / "press back on the tv box" → intent="control_device", device={"name":"<exact device name from message>","command":"sendKey","value":"HOME"}
- "what apps does <device> have?" / "list apps on the tv box" / "show installed apps on <device>" → intent="query_device", device={"name":"<exact device name from message>","command":"listApps"}
- "set speaker volume to 50" / "volume 70" / "set volume to 30" → intent="set_volume", volume=<number 0-100>
- "stop sound" / "stop music" / "stop playing" / "be quiet" → intent="stop_sound"

Rules:
- If the message is ambiguous or missing required info, set clarifying_question to your question and confidence below 0.75.
- If you are confident, set clarifying_question to null and confidence >= 0.75.
- respond only in valid JSON. No extra text.
- IMPORTANT: clarifying_question must always be written in the exact same language as the user's message. If the user wrote in Hebrew, write the clarifying_question in Hebrew. If in English, write in English. Never mix languages.`;

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

export type ConversationTurn = { role: "user" | "assistant"; content: string };

function buildSystemPrompt(deviceContext?: string): string {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localIso = localIsoWithOffset(now);
  let prompt =
    `${SYSTEM_PROMPT_BASE}\n\n` +
    `Current local date and time: ${localIso} (timezone: ${tz}). ` +
    `Use this to resolve relative times like "in 2 minutes", "tomorrow at 8pm", "every weekday". ` +
    `Always include the timezone offset in datetime_iso (e.g. "2026-03-01T20:00:00+03:00").`;
  if (deviceContext) {
    prompt += `\n\n${deviceContext}`;
  }
  return prompt;
}

export async function parseIntent(
  userText: string,
  client: OpenAI,
  model: string,
  options?: { history?: ConversationTurn[]; deviceContext?: string }
): Promise<Intent[]> {
  const history = options?.history ?? [];
  const completion = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildSystemPrompt(options?.deviceContext) },
      ...history,
      { role: "user", content: userText },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed.intents)) {
    return parsed.intents.map((i: unknown) => IntentSchema.parse(i));
  }
  return [IntentSchema.parse(parsed)];
}

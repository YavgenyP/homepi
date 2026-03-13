import type { Message } from "discord.js";
import type OpenAI from "openai";
import type Database from "better-sqlite3";
import { parseIntent, type ConversationTurn } from "./intent.parser.js";
import { handlePair } from "./handlers/pair.handler.js";
import { handleWhoHome } from "./handlers/who_home.handler.js";
import {
  handleCreateRule,
  handleListRules,
  handleDeleteRule,
} from "./handlers/rule.handler.js";
import { handleControlDevice, handleQueryDevice, handleListDevices, handleSyncHADevices, handleBrowseHADevices, handleAddHADevices, handleAliasDevice, handleSetDeviceRoom } from "./handlers/device.handler.js";
import type { Intent } from "./intent.schema.js";
import type { SmartThingsCommandFn } from "../samsung/smartthings.client.js";
import type { HACommandFn, HAQueryFn, HASyncFn } from "../homeassistant/ha.client.js";
import { setVolume, stopPlayback } from "../sound/volume.js";

export type HandlerContext = {
  channelId: string;
  openai: OpenAI;
  model: string;
  confidenceThreshold: number;
  evalSamplingRate: number;
  db: Database.Database;
  getPresenceStates: () => Map<number, "home" | "away">;
  gcalKeyFile?: string;
  controlDeviceFn?: SmartThingsCommandFn;
  controlHAFn?: HACommandFn;
  queryHAFn?: HAQueryFn;
  syncHAFn?: HASyncFn;
};

// ── Conversation history ──────────────────────────────────────────────────────

const HISTORY_LIMIT = 5; // pairs (user+assistant)
const HISTORY_TTL_SEC = 2 * 60 * 60; // 2 hours

function loadHistory(userId: string, db: Database.Database): ConversationTurn[] {
  const since = Math.floor(Date.now() / 1000) - HISTORY_TTL_SEC;
  const rows = db
    .prepare(
      `SELECT role, content FROM conversation_history
       WHERE user_id = ? AND ts >= ?
       ORDER BY ts DESC, id DESC
       LIMIT ?`
    )
    .all(userId, since, HISTORY_LIMIT * 2) as Array<{ role: string; content: string }>;
  // rows are newest-first; reverse to chronological order
  return rows.reverse() as ConversationTurn[];
}

function saveHistory(
  userId: string,
  channelId: string,
  userMsg: string,
  botReply: string,
  db: Database.Database
): void {
  const insert = db.prepare(
    "INSERT INTO conversation_history (user_id, channel_id, role, content) VALUES (?, ?, ?, ?)"
  );
  const insertBoth = db.transaction(() => {
    insert.run(userId, channelId, "user", userMsg);
    insert.run(userId, channelId, "assistant", botReply);
  });
  insertBoth();
}

function pruneHistory(userId: string, db: Database.Database): void {
  const cutoff = Math.floor(Date.now() / 1000) - HISTORY_TTL_SEC;
  db.prepare("DELETE FROM conversation_history WHERE user_id = ? AND ts < ?").run(userId, cutoff);
}

// ── Device context for LLM prompt ────────────────────────────────────────────

export function buildDeviceContext(db: Database.Database): string {
  const stRows = db
    .prepare("SELECT name, room FROM smart_devices ORDER BY name")
    .all() as Array<{ name: string; room: string }>;
  const haRows = db
    .prepare("SELECT name, entity_id, aliases, room FROM ha_devices ORDER BY name")
    .all() as Array<{ name: string; entity_id: string; aliases: string; room: string }>;

  if (stRows.length === 0 && haRows.length === 0) return "";

  const lines: string[] = ["Registered devices (use these exact names; room labels in [brackets] help disambiguate):"];
  for (const r of stRows) {
    const loc = r.room ? ` [${r.room}]` : "";
    lines.push(`- "${r.name}"${loc} (SmartThings)`);
  }
  for (const r of haRows) {
    const loc = r.room ? ` [${r.room}]` : "";
    const aliases = r.aliases ? ` (aliases: ${r.aliases})` : "";
    lines.push(`- "${r.name}"${loc}${aliases} → ${r.entity_id}`);
  }
  return lines.join("\n");
}

// ── Intent logging ────────────────────────────────────────────────────────────

function logIntent(
  userId: string,
  channelId: string,
  messageText: string,
  intent: Intent,
  wasClarified: boolean,
  db: Database.Database,
  samplingRate: number
): void {
  if (Math.random() >= samplingRate) return;
  try {
    db.prepare(
      `INSERT INTO llm_message_log
         (user_id, channel_id, message_text, intent_json, confidence, was_clarified)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      channelId,
      messageText,
      JSON.stringify(intent),
      intent.confidence,
      wasClarified ? 1 : 0
    );
  } catch {
    // Logging must never crash the main flow
  }
}

// ── Task execution logging ────────────────────────────────────────────────────

function logTaskExecution(
  userId: string,
  deviceName: string,
  command: string,
  db: Database.Database
): void {
  try {
    db.prepare(
      "INSERT INTO task_executions (user_id, source, device_name, command, hour_of_day) VALUES (?, ?, ?, ?, ?)"
    ).run(userId, "manual", deviceName, command, new Date().getHours());
  } catch {
    // Non-critical
  }
}

// ── Help text ─────────────────────────────────────────────────────────────────

const HELP_TEXT = `**homepi — what I can do:**

**Devices**
• \`turn on/off the TV\` — control any registered device immediately
• \`set AC to 22 degrees\` / \`set AC to cool mode\` / \`set AC fan to high\`
• \`set volume to 30\` / \`mute the TV\` / \`pause the TV\`
• \`switch to HDMI2\` / \`change channel to 13\`
• \`set purifier to sleep mode\` / \`lock the purifier\`
• \`launch Netflix on <device>\` / \`send HOME to <device>\`
• \`what apps does <device> have?\`
• \`what's the air quality?\` / \`what's the filter level?\` — query sensor state
• \`list my devices\` — show all registered devices

**Rules**
• \`turn on the TV at 8pm\` — one-time scheduled command
• \`turn on the lights every weekday at 7am\` — recurring (cron)
• \`when I get home, turn on the lights\` — arrival trigger
• \`remind me to take medicine at 9pm\` — notification rule
• \`remind Alice to call the dentist on Friday at 10am\` — notify another person
• \`list my rules\` / \`delete rule 3\`

**Home Assistant devices**
• \`show available HA devices\` / \`show available fan devices\` — browse unregistered entities
• \`add 1 and 2\` — register entities from last browse
• \`sync HA devices\` — auto-import all HA entities
• \`call the xiaomi fan "purifier"\` — add an alias for easier reference

**Speaker (Pi)**
• \`set volume to 50\` — set Pi speaker volume (0–100)
• \`stop sound\` / \`stop music\` — stop all audio playback
• \`save shortcut lofi <url>\` — save a named play shortcut
• \`delete shortcut lofi\` — remove a shortcut

**Presence**
• \`who's home?\`
• \`pair my phone — IP 192.168.1.50\` — register a device for presence detection

**Other**
• \`help\` / \`what can you do?\` — show this message`;

// ── Shared command processor ──────────────────────────────────────────────────

export async function processCommand(
  userId: string,
  username: string,
  content: string,
  channelId: string,
  ctx: HandlerContext
): Promise<string | null> {
  const history = loadHistory(userId, ctx.db);
  const deviceContext = buildDeviceContext(ctx.db);

  let intents;
  try {
    intents = await parseIntent(content, ctx.openai, ctx.model, { history, deviceContext: deviceContext || undefined });
  } catch (err) {
    console.error("OpenAI error:", err);
    return "Error: could not reach the AI service. Please try again later.";
  }

  const primary = intents[0];

  const wasClarified =
    !!primary.clarifying_question ||
    primary.confidence < ctx.confidenceThreshold;

  logIntent(userId, channelId, content, primary, wasClarified, ctx.db, ctx.evalSamplingRate);

  if (wasClarified) {
    const reply = primary.clarifying_question ?? "Could you clarify what you mean?";
    saveHistory(userId, channelId, content, reply, ctx.db);
    pruneHistory(userId, ctx.db);
    return reply;
  }

  const replies: string[] = [];

  for (const intent of intents) {
    let reply: string | null = null;

    switch (intent.intent) {
      case "pair_phone":
        reply = handlePair(intent, userId, username, ctx.db);
        break;
      case "who_home":
        reply = handleWhoHome(ctx.getPresenceStates(), ctx.db);
        break;
      case "create_rule":
        reply = await handleCreateRule(intent, userId, ctx.db, ctx.gcalKeyFile, ctx.openai);
        break;
      case "list_rules":
        reply = handleListRules(ctx.db);
        break;
      case "delete_rule":
        reply = handleDeleteRule(intent, ctx.db);
        break;
      case "control_device":
        if (!ctx.controlDeviceFn && !ctx.controlHAFn) {
          reply = "No device backend is configured. Set SMARTTHINGS_CLIENT_ID/SECRET or HOMEASSISTANT_URL/TOKEN to enable device control.";
          break;
        }
        reply = await handleControlDevice(intent, ctx.db, ctx.openai, ctx.controlDeviceFn, ctx.controlHAFn);
        if (intent.device && reply && !reply.toLowerCase().startsWith("failed") && !reply.toLowerCase().startsWith("i don't")) {
          logTaskExecution(userId, intent.device.name, intent.device.command, ctx.db);
        }
        break;
      case "query_device":
        reply = await handleQueryDevice(intent, ctx.db, ctx.openai, ctx.queryHAFn);
        break;
      case "list_devices":
        reply = handleListDevices(ctx.db);
        break;
      case "sync_ha_devices":
        reply = await handleSyncHADevices(ctx.db, ctx.openai, ctx.syncHAFn);
        break;
      case "browse_ha_devices":
        reply = await handleBrowseHADevices(intent, ctx.db, ctx.syncHAFn);
        break;
      case "add_ha_devices":
        reply = await handleAddHADevices(intent, ctx.db, ctx.openai, ctx.syncHAFn);
        break;
      case "alias_device":
        reply = await handleAliasDevice(intent, ctx.db, ctx.openai);
        break;
      case "set_device_room":
        reply = await handleSetDeviceRoom(intent, ctx.db, ctx.openai);
        break;
      case "set_volume": {
        const level = intent.volume;
        if (level === null || level === undefined) {
          reply = "What volume level? (0–100)";
          break;
        }
        try {
          const backend = process.env.AUDIO_BACKEND ?? "auto";
          await setVolume(level, backend);
          reply = `Volume set to ${level}.`;
        } catch (err) {
          reply = `Failed to set volume: ${err instanceof Error ? err.message : String(err)}`;
        }
        break;
      }
      case "stop_sound":
        await stopPlayback();
        reply = "Stopped.";
        break;
      case "save_shortcut": {
        const { shortcut_name, shortcut_url } = intent;
        if (!shortcut_name || !shortcut_url) {
          reply = "Please provide both a name and a URL. E.g. save shortcut lofi https://...";
          break;
        }
        ctx.db.prepare(
          "INSERT INTO sound_shortcuts (name, url) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET url=excluded.url"
        ).run(shortcut_name.toLowerCase(), shortcut_url);
        reply = `Shortcut "${shortcut_name}" saved.`;
        break;
      }
      case "delete_shortcut": {
        const { shortcut_name } = intent;
        if (!shortcut_name) {
          reply = "Which shortcut should I delete?";
          break;
        }
        const changes = (ctx.db.prepare("DELETE FROM sound_shortcuts WHERE name = ?").run(shortcut_name.toLowerCase())).changes;
        reply = changes > 0 ? `Shortcut "${shortcut_name}" deleted.` : `No shortcut named "${shortcut_name}".`;
        break;
      }
      case "help":
        reply = HELP_TEXT;
        break;
      default:
        break;
    }

    if (reply) replies.push(reply);
  }

  if (replies.length === 0) return null;

  const combined = replies.join("\n");
  saveHistory(userId, channelId, content, combined, ctx.db);
  pruneHistory(userId, ctx.db);
  return combined;
}

// ── Text message handler ──────────────────────────────────────────────────────

export async function handleMessage(
  msg: Message,
  ctx: HandlerContext
): Promise<string | null> {
  if (msg.author.bot) return null;
  if (msg.channelId !== ctx.channelId) return null;
  return processCommand(msg.author.id, msg.author.username, msg.content, msg.channelId, ctx);
}

// ── Voice command handler (called by Discord voice + Pi mic paths) ────────────

export async function handleVoiceCommand(
  userId: string,
  username: string,
  text: string,
  ctx: HandlerContext
): Promise<string | null> {
  return processCommand(userId, username, text, ctx.channelId, ctx);
}

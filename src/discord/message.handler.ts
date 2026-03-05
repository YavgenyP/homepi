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
import { handleControlDevice, handleQueryDevice, handleListDevices, handleSyncHADevices, handleBrowseHADevices, handleAddHADevices, handleAliasDevice } from "./handlers/device.handler.js";
import type { Intent } from "./intent.schema.js";
import type { SmartThingsCommandFn } from "../samsung/smartthings.client.js";
import type { HACommandFn, HAQueryFn, HASyncFn } from "../homeassistant/ha.client.js";

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
    .prepare("SELECT name FROM smart_devices ORDER BY name")
    .all() as Array<{ name: string }>;
  const haRows = db
    .prepare("SELECT name, entity_id, aliases FROM ha_devices ORDER BY name")
    .all() as Array<{ name: string; entity_id: string; aliases: string }>;

  if (stRows.length === 0 && haRows.length === 0) return "";

  const lines: string[] = ["Registered devices (use these exact names when resolving device references):"];
  for (const r of stRows) {
    lines.push(`- "${r.name}" (SmartThings)`);
  }
  for (const r of haRows) {
    const aliases = r.aliases ? ` (aliases: ${r.aliases})` : "";
    lines.push(`- "${r.name}"${aliases} → ${r.entity_id}`);
  }
  return lines.join("\n");
}

// ── Intent logging ────────────────────────────────────────────────────────────

function logIntent(
  msg: Message,
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
      msg.author.id,
      msg.channelId,
      msg.content,
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

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleMessage(
  msg: Message,
  ctx: HandlerContext
): Promise<string | null> {
  if (msg.author.bot) return null;
  if (msg.channelId !== ctx.channelId) return null;

  const history = loadHistory(msg.author.id, ctx.db);
  const deviceContext = buildDeviceContext(ctx.db);

  let intent;
  try {
    intent = await parseIntent(msg.content, ctx.openai, ctx.model, { history, deviceContext: deviceContext || undefined });
  } catch (err) {
    console.error("OpenAI error:", err);
    return "Error: could not reach the AI service. Please try again later.";
  }

  const wasClarified =
    !!intent.clarifying_question ||
    intent.confidence < ctx.confidenceThreshold;

  logIntent(msg, intent, wasClarified, ctx.db, ctx.evalSamplingRate);

  if (wasClarified) {
    const reply = intent.clarifying_question ?? "Could you clarify what you mean?";
    saveHistory(msg.author.id, msg.channelId, msg.content, reply, ctx.db);
    pruneHistory(msg.author.id, ctx.db);
    return reply;
  }

  let reply: string | null = null;

  switch (intent.intent) {
    case "pair_phone":
      reply = handlePair(intent, msg.author.id, msg.author.username, ctx.db);
      break;
    case "who_home":
      reply = handleWhoHome(ctx.getPresenceStates(), ctx.db);
      break;
    case "create_rule":
      reply = await handleCreateRule(intent, msg.author.id, ctx.db, ctx.gcalKeyFile);
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
        logTaskExecution(msg.author.id, intent.device.name, intent.device.command, ctx.db);
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
    default:
      return null;
  }

  if (reply) {
    saveHistory(msg.author.id, msg.channelId, msg.content, reply, ctx.db);
    pruneHistory(msg.author.id, ctx.db);
  }

  return reply;
}

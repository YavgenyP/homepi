import type { Message } from "discord.js";
import type OpenAI from "openai";
import type Database from "better-sqlite3";
import { parseIntent } from "./intent.parser.js";
import { handlePair } from "./handlers/pair.handler.js";
import { handleWhoHome } from "./handlers/who_home.handler.js";
import {
  handleCreateRule,
  handleListRules,
  handleDeleteRule,
} from "./handlers/rule.handler.js";
import type { Intent } from "./intent.schema.js";

export type HandlerContext = {
  channelId: string;
  openai: OpenAI;
  model: string;
  confidenceThreshold: number;
  evalSamplingRate: number;
  db: Database.Database;
  getPresenceStates: () => Map<number, "home" | "away">;
};

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

export async function handleMessage(
  msg: Message,
  ctx: HandlerContext
): Promise<string | null> {
  if (msg.author.bot) return null;
  if (msg.channelId !== ctx.channelId) return null;

  let intent;
  try {
    intent = await parseIntent(msg.content, ctx.openai, ctx.model);
  } catch {
    return "Error: could not reach the AI service. Please try again later.";
  }

  const wasClarified =
    !!intent.clarifying_question ||
    intent.confidence < ctx.confidenceThreshold;

  logIntent(msg, intent, wasClarified, ctx.db, ctx.evalSamplingRate);

  if (wasClarified) {
    return intent.clarifying_question ?? "Could you clarify what you mean?";
  }

  switch (intent.intent) {
    case "pair_phone":
      return handlePair(intent, msg.author.id, msg.author.username, ctx.db);
    case "who_home":
      return handleWhoHome(ctx.getPresenceStates(), ctx.db);
    case "create_rule":
      return handleCreateRule(intent, msg.author.id, ctx.db);
    case "list_rules":
      return handleListRules(ctx.db);
    case "delete_rule":
      return handleDeleteRule(intent, ctx.db);
    default:
      return null;
  }
}

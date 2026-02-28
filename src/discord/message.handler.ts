import type { Message } from "discord.js";
import type OpenAI from "openai";
import type Database from "better-sqlite3";
import { parseIntent } from "./intent.parser.js";
import { handlePair } from "./handlers/pair.handler.js";
import { handleWhoHome } from "./handlers/who_home.handler.js";

export type HandlerContext = {
  channelId: string;
  openai: OpenAI;
  model: string;
  confidenceThreshold: number;
  db: Database.Database;
  getPresenceStates: () => Map<number, "home" | "away">;
};

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

  if (
    intent.clarifying_question ||
    intent.confidence < ctx.confidenceThreshold
  ) {
    return intent.clarifying_question ?? "Could you clarify what you mean?";
  }

  switch (intent.intent) {
    case "pair_phone":
      return handlePair(intent, msg.author.id, msg.author.username, ctx.db);
    case "who_home":
      return handleWhoHome(ctx.getPresenceStates(), ctx.db);
    default:
      return null;
  }
}

import type { Message } from "discord.js";
import type OpenAI from "openai";
import { parseIntent } from "./intent.parser.js";

export type HandlerContext = {
  channelId: string;
  openai: OpenAI;
  model: string;
  confidenceThreshold: number;
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

  // Intent dispatch — handlers wired in subsequent backlog items.
  return null;
}

import type { Message } from "discord.js";

export type HandlerContext = {
  channelId: string;
};

// Returns a reply string or null if the message should be ignored.
// Will be wired to the intent parser in the next backlog item.
export async function handleMessage(
  msg: Message,
  ctx: HandlerContext
): Promise<string | null> {
  if (msg.author.bot) return null;
  if (msg.channelId !== ctx.channelId) return null;

  // Placeholder — replaced by LLM intent dispatch in item 3.
  return null;
}

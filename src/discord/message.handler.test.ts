import { describe, it, expect } from "vitest";
import type { Message } from "discord.js";
import { handleMessage } from "./message.handler.js";

function makeMsg(overrides: Partial<Message>): Message {
  return {
    author: { bot: false },
    channelId: "chan-1",
    reply: async () => {},
    ...overrides,
  } as unknown as Message;
}

const ctx = { channelId: "chan-1" };

describe("handleMessage", () => {
  it("ignores bot messages", async () => {
    const msg = makeMsg({ author: { bot: true } as Message["author"] });
    expect(await handleMessage(msg, ctx)).toBeNull();
  });

  it("ignores messages from other channels", async () => {
    const msg = makeMsg({ channelId: "other-chan" });
    expect(await handleMessage(msg, ctx)).toBeNull();
  });

  it("returns null for normal messages (intent parser not yet wired)", async () => {
    const msg = makeMsg({});
    expect(await handleMessage(msg, ctx)).toBeNull();
  });
});

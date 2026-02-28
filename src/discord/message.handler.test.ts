import { describe, it, expect, vi } from "vitest";
import type { Message } from "discord.js";
import type OpenAI from "openai";
import { openDb } from "../storage/db.js";
import { handleMessage } from "./message.handler.js";

const noop = vi.fn();

function makeCtx(overrides: { parseIntentResult?: object; parseIntentError?: Error } = {}) {
  return {
    channelId: "chan-1",
    model: "gpt-4o",
    confidenceThreshold: 0.75,
    db: openDb(":memory:"),
    getPresenceStates: () => new Map<number, "home" | "away">(),
    openai: {
      chat: {
        completions: {
          create: overrides.parseIntentError
            ? vi.fn().mockRejectedValue(overrides.parseIntentError)
            : vi.fn().mockResolvedValue({
                choices: [
                  {
                    message: {
                      content: JSON.stringify(
                        overrides.parseIntentResult ?? {
                          intent: "help",
                          trigger: "none",
                          action: "none",
                          message: null,
                          time_spec: null,
                          person: null,
                          phone: null,
                          confidence: 0.95,
                          clarifying_question: null,
                        }
                      ),
                    },
                  },
                ],
              }),
        },
      },
    } as unknown as OpenAI,
  };
}

function makeMsg(overrides: Partial<Message>): Message {
  return {
    author: { bot: false },
    channelId: "chan-1",
    content: "who's home?",
    reply: noop,
    ...overrides,
  } as unknown as Message;
}

describe("handleMessage", () => {
  it("ignores bot messages", async () => {
    const result = await handleMessage(
      makeMsg({ author: { bot: true } as Message["author"] }),
      makeCtx()
    );
    expect(result).toBeNull();
  });

  it("ignores messages from other channels", async () => {
    const result = await handleMessage(
      makeMsg({ channelId: "other" }),
      makeCtx()
    );
    expect(result).toBeNull();
  });

  it("returns error string when OpenAI fails", async () => {
    const result = await handleMessage(
      makeMsg({}),
      makeCtx({ parseIntentError: new Error("network error") })
    );
    expect(result).toMatch(/error/i);
  });

  it("returns clarifying question when confidence is low", async () => {
    const result = await handleMessage(
      makeMsg({}),
      makeCtx({
        parseIntentResult: {
          intent: "create_rule",
          trigger: "time",
          action: "notify",
          message: null,
          time_spec: null,
          person: null,
          phone: null,
          confidence: 0.5,
          clarifying_question: "What time should I remind you?",
        },
      })
    );
    expect(result).toBe("What time should I remind you?");
  });

  it("returns null when intent is confident and no clarification needed", async () => {
    const result = await handleMessage(makeMsg({}), makeCtx());
    expect(result).toBeNull();
  });
});

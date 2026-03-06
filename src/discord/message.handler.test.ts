import { describe, it, expect, vi } from "vitest";
import type { Message } from "discord.js";
import type OpenAI from "openai";
import { openDb } from "../storage/db.js";
import { handleMessage, buildDeviceContext } from "./message.handler.js";

const noop = vi.fn();

function makeIntentPayload(overrides: object = {}) {
  return {
    intent: "help",
    trigger: "none",
    action: "none",
    message: null,
    time_spec: null,
    person: null,
    phone: null,
    sound_source: null,
    require_home: false,
    device: null,
    device_alias: null,
    confidence: 0.95,
    clarifying_question: null,
    ...overrides,
  };
}

function makeCtx(overrides: { parseIntentResult?: object; parseIntentError?: Error; db?: ReturnType<typeof openDb> } = {}) {
  const completionCreate = overrides.parseIntentError
    ? vi.fn().mockRejectedValue(overrides.parseIntentError)
    : vi.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(overrides.parseIntentResult ?? makeIntentPayload()) } }],
      });

  return {
    channelId: "chan-1",
    model: "gpt-4o",
    confidenceThreshold: 0.75,
    db: overrides.db ?? openDb(":memory:"),
    evalSamplingRate: 0,
    getPresenceStates: () => new Map<number, "home" | "away">(),
    openai: {
      chat: { completions: { create: completionCreate } },
      embeddings: { create: vi.fn().mockResolvedValue({ data: [{ embedding: [] }] }) },
    } as unknown as OpenAI,
    _completionCreate: completionCreate,
  };
}

function makeMsg(overrides: Record<string, unknown> = {}): Message {
  return {
    author: { bot: false, id: "user-123", username: "testuser" },
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
        parseIntentResult: makeIntentPayload({
          intent: "create_rule",
          trigger: "time",
          action: "notify",
          confidence: 0.5,
          clarifying_question: "What time should I remind you?",
        }),
      })
    );
    expect(result).toBe("What time should I remind you?");
  });

  it("returns help text when intent is 'help'", async () => {
    const result = await handleMessage(makeMsg({}), makeCtx());
    expect(result).toContain("homepi — what I can do");
  });

  it("returns null for unknown intent", async () => {
    const result = await handleMessage(
      makeMsg({}),
      makeCtx({ parseIntentResult: makeIntentPayload({ intent: "unknown" }) })
    );
    expect(result).toBeNull();
  });
});

describe("handleMessage — LLM logging", () => {
  it("logs message when sampling rate is 1", async () => {
    const db = openDb(":memory:");
    const ctx = { ...makeCtx({ db }), evalSamplingRate: 1 };
    await handleMessage(makeMsg({}), ctx);
    const rows = db.prepare("SELECT * FROM llm_message_log").all();
    expect(rows).toHaveLength(1);
  });

  it("does not log when sampling rate is 0", async () => {
    const db = openDb(":memory:");
    const ctx = { ...makeCtx({ db }), evalSamplingRate: 0 };
    await handleMessage(makeMsg({}), ctx);
    expect(db.prepare("SELECT * FROM llm_message_log").all()).toHaveLength(0);
  });

  it("sets was_clarified=1 when clarifying question returned", async () => {
    const db = openDb(":memory:");
    const ctx = {
      ...makeCtx({
        db,
        parseIntentResult: makeIntentPayload({
          intent: "create_rule",
          confidence: 0.4,
          clarifying_question: "What time?",
        }),
      }),
      evalSamplingRate: 1,
    };
    await handleMessage(makeMsg({}), ctx);
    const row = db.prepare("SELECT was_clarified FROM llm_message_log").get() as {
      was_clarified: number;
    };
    expect(row.was_clarified).toBe(1);
  });
});

describe("handleMessage — conversation history", () => {
  it("saves user message and bot reply to conversation_history", async () => {
    const db = openDb(":memory:");
    const ctx = makeCtx({
      db,
      parseIntentResult: makeIntentPayload({ confidence: 0.5, clarifying_question: "What do you mean?" }),
    });
    await handleMessage(makeMsg({ content: "purifier?" }), ctx);
    const rows = db.prepare("SELECT role, content FROM conversation_history ORDER BY id").all() as Array<{ role: string; content: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ role: "user", content: "purifier?" });
    expect(rows[1]).toMatchObject({ role: "assistant", content: "What do you mean?" });
  });

  it("passes prior history to OpenAI on second message", async () => {
    const db = openDb(":memory:");
    // Seed existing conversation history
    db.prepare("INSERT INTO conversation_history (user_id, channel_id, role, content, ts) VALUES (?, ?, ?, ?, ?)").run("user-123", "chan-1", "user", "is the purifier on?", Math.floor(Date.now() / 1000) - 60);
    db.prepare("INSERT INTO conversation_history (user_id, channel_id, role, content, ts) VALUES (?, ?, ?, ?, ?)").run("user-123", "chan-1", "assistant", "Which purifier do you mean?", Math.floor(Date.now() / 1000) - 59);

    const ctx = makeCtx({ db });
    await handleMessage(makeMsg({ content: "the one in the bedroom" }), ctx);

    const createCall = (ctx as ReturnType<typeof makeCtx>)._completionCreate.mock.calls[0][0];
    const messages = createCall.messages as Array<{ role: string; content: string }>;
    // Should include system, prior user, prior assistant, and current user
    expect(messages.length).toBeGreaterThanOrEqual(4);
    expect(messages.some((m) => m.role === "user" && m.content === "is the purifier on?")).toBe(true);
    expect(messages.some((m) => m.role === "assistant" && m.content === "Which purifier do you mean?")).toBe(true);
  });

  it("does not include history older than 2 hours", async () => {
    const db = openDb(":memory:");
    const threeHoursAgo = Math.floor(Date.now() / 1000) - 3 * 3600;
    db.prepare("INSERT INTO conversation_history (user_id, channel_id, role, content, ts) VALUES (?, ?, ?, ?, ?)").run("user-123", "chan-1", "user", "old message", threeHoursAgo);
    db.prepare("INSERT INTO conversation_history (user_id, channel_id, role, content, ts) VALUES (?, ?, ?, ?, ?)").run("user-123", "chan-1", "assistant", "old reply", threeHoursAgo);

    const ctx = makeCtx({ db });
    await handleMessage(makeMsg({}), ctx);

    const createCall = (ctx as ReturnType<typeof makeCtx>)._completionCreate.mock.calls[0][0];
    const messages = createCall.messages as Array<{ role: string; content: string }>;
    expect(messages.every((m) => m.content !== "old message")).toBe(true);
  });
});

describe("buildDeviceContext", () => {
  it("returns empty string when no devices registered", () => {
    const db = openDb(":memory:");
    expect(buildDeviceContext(db)).toBe("");
  });

  it("includes ST and HA devices", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO smart_devices (name, smartthings_device_id) VALUES (?, ?)").run("tv", "uuid-123");
    db.prepare("INSERT INTO ha_devices (name, entity_id, aliases, embedding) VALUES (?, ?, ?, ?)").run("purifier", "fan.xiaomi", "air purifier", "");
    const ctx = buildDeviceContext(db);
    expect(ctx).toContain('"tv"');
    expect(ctx).toContain('"purifier"');
    expect(ctx).toContain("air purifier");
    expect(ctx).toContain("fan.xiaomi");
  });
});

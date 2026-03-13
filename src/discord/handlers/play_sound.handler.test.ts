import { describe, it, expect, vi, beforeEach } from "vitest";
import { processCommand } from "../message.handler.js";
import { openDb } from "../../storage/db.js";
import type Database from "better-sqlite3";
import type { HandlerContext } from "../message.handler.js";

// Mock OpenAI to return a play_sound intent
vi.mock("openai", () => {
  return {
    default: class {
      chat = {
        completions: {
          create: vi.fn(),
        },
      };
    },
  };
});

vi.mock("../../sound/sound.player.js", () => ({
  playSound: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../sound/volume.js", () => ({
  setVolume: vi.fn().mockResolvedValue(undefined),
  stopPlayback: vi.fn().mockResolvedValue(undefined),
}));

import OpenAI from "openai";
import { playSound } from "../../sound/sound.player.js";

function makeIntent(overrides: Record<string, unknown>) {
  return JSON.stringify({
    intent: "play_sound",
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
    device_room: null,
    ha_entity_ids: null,
    ha_domain_filter: null,
    condition_entity_id: null,
    condition_state: null,
    condition_operator: null,
    condition_threshold: null,
    duration_sec: null,
    volume: null,
    shortcut_name: null,
    shortcut_url: null,
    confidence: 0.95,
    clarifying_question: null,
    ...overrides,
  });
}

let db: Database.Database;
let ctx: HandlerContext;
let mockCreate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  db = openDb(":memory:");
  const openai = new OpenAI();
  mockCreate = openai.chat.completions.create as ReturnType<typeof vi.fn>;
  ctx = {
    channelId: "ch1",
    openai,
    model: "gpt-4o-mini",
    confidenceThreshold: 0.75,
    evalSamplingRate: 0,
    db,
    getPresenceStates: () => new Map(),
  };
  vi.clearAllMocks();
});

describe("play_sound intent", () => {
  it("calls playSound with sound_source and replies Playing", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: makeIntent({ sound_source: "https://youtube.com/watch?v=abc" }) } }],
    });

    const reply = await processCommand("u1", "user", "play https://youtube.com/watch?v=abc", "ch1", ctx);

    expect(playSound).toHaveBeenCalledWith("https://youtube.com/watch?v=abc");
    expect(reply).toBe("Playing https://youtube.com/watch?v=abc");
  });

  it("asks for a source when sound_source is null", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: makeIntent({ sound_source: null }) } }],
    });

    const reply = await processCommand("u1", "user", "play something", "ch1", ctx);

    expect(playSound).not.toHaveBeenCalled();
    expect(reply).toContain("What should I play");
  });
});

import { describe, it, expect, vi } from "vitest";
import type OpenAI from "openai";
import { parseIntent } from "./intent.parser.js";

function makeClient(responseJson: object): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: JSON.stringify(responseJson) } }],
        }),
      },
    },
  } as unknown as OpenAI;
}

const validIntent = {
  intent: "who_home",
  trigger: "none",
  action: "none",
  message: null,
  time_spec: null,
  person: null,
  phone: null,
  confidence: 0.95,
  clarifying_question: null,
};

describe("parseIntent", () => {
  it("returns a validated intent on success", async () => {
    const client = makeClient(validIntent);
    const result = await parseIntent("who's home?", client, "gpt-4o");
    expect(result.intent).toBe("who_home");
    expect(result.confidence).toBe(0.95);
  });

  it("throws if the LLM returns invalid JSON", async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "not json" } }],
          }),
        },
      },
    } as unknown as OpenAI;
    await expect(parseIntent("hey", client, "gpt-4o")).rejects.toThrow();
  });

  it("throws if the JSON does not match the schema", async () => {
    const client = makeClient({ intent: "fly_rocket" });
    await expect(parseIntent("hey", client, "gpt-4o")).rejects.toThrow();
  });

  it("throws if the OpenAI call itself rejects", async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error("network error")),
        },
      },
    } as unknown as OpenAI;
    await expect(parseIntent("hey", client, "gpt-4o")).rejects.toThrow("network error");
  });
});

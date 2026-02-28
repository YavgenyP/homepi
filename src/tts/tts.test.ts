import { describe, it, expect, vi } from "vitest";
import type OpenAI from "openai";
import { speak, isValidVoice, VALID_VOICES } from "./tts.js";

function makeOpenAI(audioBytes: number[] = [1, 2, 3]): OpenAI {
  return {
    audio: {
      speech: {
        create: vi.fn().mockResolvedValue({
          arrayBuffer: async () => new Uint8Array(audioBytes).buffer,
        }),
      },
    },
  } as unknown as OpenAI;
}

describe("isValidVoice", () => {
  it("accepts all valid voices", () => {
    for (const v of VALID_VOICES) {
      expect(isValidVoice(v)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isValidVoice("robot")).toBe(false);
    expect(isValidVoice("")).toBe(false);
  });
});

describe("speak", () => {
  it("calls OpenAI TTS with correct params", async () => {
    const openai = makeOpenAI();
    const playerFn = vi.fn().mockResolvedValue(undefined);

    await speak("hello world", openai, "nova", playerFn);

    expect(openai.audio.speech.create).toHaveBeenCalledWith({
      model: "tts-1",
      voice: "nova",
      input: "hello world",
    });
  });

  it("passes the audio buffer to playerFn", async () => {
    const bytes = [10, 20, 30];
    const openai = makeOpenAI(bytes);
    const playerFn = vi.fn().mockResolvedValue(undefined);

    await speak("test", openai, "alloy", playerFn);

    const received: Buffer = playerFn.mock.calls[0][0];
    expect(received).toBeInstanceOf(Buffer);
    expect(Array.from(received)).toEqual(bytes);
  });

  it("uses alloy as default voice", async () => {
    const openai = makeOpenAI();
    const playerFn = vi.fn().mockResolvedValue(undefined);

    await speak("hi", openai, undefined as unknown as "alloy", playerFn);

    expect(openai.audio.speech.create).toHaveBeenCalledWith(
      expect.objectContaining({ voice: "alloy" })
    );
  });

  it("propagates OpenAI errors", async () => {
    const openai = {
      audio: {
        speech: {
          create: vi.fn().mockRejectedValue(new Error("api failure")),
        },
      },
    } as unknown as OpenAI;
    const playerFn = vi.fn();

    await expect(speak("hi", openai, "alloy", playerFn)).rejects.toThrow("api failure");
    expect(playerFn).not.toHaveBeenCalled();
  });

  it("propagates player errors", async () => {
    const openai = makeOpenAI();
    const playerFn = vi.fn().mockRejectedValue(new Error("ffplay not found"));

    await expect(speak("hi", openai, "alloy", playerFn)).rejects.toThrow("ffplay not found");
  });
});

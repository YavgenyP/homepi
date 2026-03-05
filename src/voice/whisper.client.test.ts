import { describe, it, expect, vi } from "vitest";
import type OpenAI from "openai";

vi.mock("openai/uploads", () => ({
  toFile: vi.fn().mockResolvedValue("mock-file"),
}));

// Import after mocking
const { transcribeAudio } = await import("./whisper.client.js");

function makeOpenai(text: string): OpenAI {
  return {
    audio: {
      transcriptions: {
        create: vi.fn().mockResolvedValue({ text }),
      },
    },
  } as unknown as OpenAI;
}

describe("transcribeAudio", () => {
  it("returns trimmed transcript", async () => {
    const result = await transcribeAudio(Buffer.from("data"), "audio.wav", makeOpenai("  hello world  "));
    expect(result).toBe("hello world");
  });

  it("passes whisper-1 model to API", async () => {
    const create = vi.fn().mockResolvedValue({ text: "ok" });
    const openai = { audio: { transcriptions: { create } } } as unknown as OpenAI;
    await transcribeAudio(Buffer.from("data"), "audio.wav", openai);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: "whisper-1" }));
  });

  it("returns empty string on empty API response", async () => {
    const result = await transcribeAudio(Buffer.from("data"), "audio.wav", makeOpenai(""));
    expect(result).toBe("");
  });

  it("returns empty string on API error", async () => {
    const openai = {
      audio: { transcriptions: { create: vi.fn().mockRejectedValue(new Error("api error")) } },
    } as unknown as OpenAI;
    const result = await transcribeAudio(Buffer.from("data"), "audio.wav", openai);
    expect(result).toBe("");
  });
});

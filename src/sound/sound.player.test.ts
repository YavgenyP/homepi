import { describe, it, expect, vi } from "vitest";
import { isRemoteUrl, playSound } from "./sound.player.js";

describe("isRemoteUrl", () => {
  it("returns true for https URLs", () => {
    expect(isRemoteUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
  });

  it("returns true for http URLs", () => {
    expect(isRemoteUrl("http://example.com/audio.mp3")).toBe(true);
  });

  it("returns false for absolute file paths", () => {
    expect(isRemoteUrl("/data/sounds/alarm.mp3")).toBe(false);
  });

  it("returns false for relative file paths", () => {
    expect(isRemoteUrl("sounds/alarm.mp3")).toBe(false);
  });
});

describe("playSound", () => {
  it("calls playFn with the source", async () => {
    const playFn = vi.fn().mockResolvedValue(undefined);
    await playSound("/data/sounds/alarm.mp3", playFn);
    expect(playFn).toHaveBeenCalledWith("/data/sounds/alarm.mp3");
  });

  it("calls playFn with a YouTube URL", async () => {
    const playFn = vi.fn().mockResolvedValue(undefined);
    const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    await playSound(url, playFn);
    expect(playFn).toHaveBeenCalledWith(url);
  });

  it("propagates errors from playFn", async () => {
    const playFn = vi.fn().mockRejectedValue(new Error("ffplay not found"));
    await expect(playSound("/some/file.mp3", playFn)).rejects.toThrow("ffplay not found");
  });
});

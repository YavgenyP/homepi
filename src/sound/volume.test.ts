import { describe, it, expect, vi } from "vitest";
import { setVolume, stopPlayback } from "./volume.js";

describe("setVolume", () => {
  it("calls pactl with correct percentage (auto backend)", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    await setVolume(50, "auto", exec);
    expect(exec).toHaveBeenCalledWith("pactl set-sink-volume @DEFAULT_SINK@ 50%");
  });

  it("calls pactl with correct percentage (pulse backend)", async () => {
    const exec = vi.fn().mockResolvedValue({});
    await setVolume(75, "pulse", exec);
    expect(exec).toHaveBeenCalledWith("pactl set-sink-volume @DEFAULT_SINK@ 75%");
  });

  it("falls back to amixer when pactl fails (auto backend)", async () => {
    const exec = vi.fn()
      .mockRejectedValueOnce(new Error("pactl not found"))
      .mockResolvedValueOnce({});
    await setVolume(40, "auto", exec);
    expect(exec).toHaveBeenNthCalledWith(1, "pactl set-sink-volume @DEFAULT_SINK@ 40%");
    expect(exec).toHaveBeenNthCalledWith(2, "amixer set Master 40%");
  });

  it("throws when pactl fails and backend is pulse", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("pactl not found"));
    await expect(setVolume(50, "pulse", exec)).rejects.toThrow("pactl failed");
  });

  it("calls amixer directly when backend is alsa", async () => {
    const exec = vi.fn().mockResolvedValue({});
    await setVolume(30, "alsa", exec);
    expect(exec).toHaveBeenCalledWith("amixer set Master 30%");
  });

  it("clamps level below 0 to 0", async () => {
    const exec = vi.fn().mockResolvedValue({});
    await setVolume(-10, "alsa", exec);
    expect(exec).toHaveBeenCalledWith("amixer set Master 0%");
  });

  it("clamps level above 100 to 100", async () => {
    const exec = vi.fn().mockResolvedValue({});
    await setVolume(150, "alsa", exec);
    expect(exec).toHaveBeenCalledWith("amixer set Master 100%");
  });

  it("rounds fractional levels", async () => {
    const exec = vi.fn().mockResolvedValue({});
    await setVolume(55.7, "alsa", exec);
    expect(exec).toHaveBeenCalledWith("amixer set Master 56%");
  });
});

describe("stopPlayback", () => {
  it("kills mpv and yt-dlp", async () => {
    const exec = vi.fn().mockResolvedValue({});
    await stopPlayback(exec);
    const calls = exec.mock.calls.map((c) => c[0] as string);
    expect(calls).toContain("pkill -f mpv");
    expect(calls).toContain("pkill -f yt-dlp");
  });

  it("does not throw when processes are not running (pkill exit code 1)", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("pkill: no processes found"));
    await expect(stopPlayback(exec)).resolves.not.toThrow();
  });
});

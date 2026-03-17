import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Set the system speaker volume on the Pi.
 * Tries pactl (PulseAudio) first, falls back to amixer (ALSA).
 * backend: "auto" | "pulse" | "alsa"
 */
export async function setVolume(
  level: number,
  backend: string = "auto",
  execFn: (cmd: string) => Promise<unknown> = execAsync
): Promise<void> {
  const pct = Math.max(0, Math.min(100, Math.round(level)));

  if (backend === "pulse" || backend === "auto") {
    try {
      await execFn(`pactl set-sink-volume @DEFAULT_SINK@ ${pct}%`);
      return;
    } catch {
      if (backend === "pulse") throw new Error(`pactl failed setting volume to ${pct}%`);
      // fall through to amixer
    }
  }

  await execFn(`amixer set Master ${pct}%`);
}

/**
 * Kill any active mpv / yt-dlp processes (sound playback + TTS).
 */
export async function stopPlayback(
  execFn: (cmd: string) => Promise<unknown> = execAsync
): Promise<void> {
  await Promise.allSettled([
    execFn("pkill -f mpv"),
    execFn("pkill -f yt-dlp"),
  ]);
}

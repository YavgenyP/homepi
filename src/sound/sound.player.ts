import { spawn } from "node:child_process";

export type PlayFn = (source: string) => Promise<void>;

/** Returns true for http/https URLs; false for local file paths. */
export function isRemoteUrl(source: string): boolean {
  return source.startsWith("http://") || source.startsWith("https://");
}

/**
 * Default player:
 * - Remote URL → yt-dlp | ffplay (requires yt-dlp + ffmpeg in PATH)
 * - Local path → ffplay directly (requires ffmpeg in PATH)
 */
export const defaultPlayFn: PlayFn = (source) => {
  if (isRemoteUrl(source)) {
    return new Promise((resolve, reject) => {
      const ytdlp = spawn(
        "yt-dlp",
        ["-o", "-", "-f", "bestaudio/best", "--quiet", source],
        { stdio: ["ignore", "pipe", "ignore"] }
      );
      const ffplay = spawn(
        "ffplay",
        ["-nodisp", "-autoexit", "-i", "pipe:0"],
        { stdio: ["pipe", "ignore", "ignore"] }
      );
      ytdlp.stdout.pipe(ffplay.stdin);
      ytdlp.on("error", reject);
      ffplay.on("error", reject);
      ffplay.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffplay exited with code ${code}`));
      });
    });
  } else {
    return new Promise((resolve, reject) => {
      const proc = spawn("ffplay", ["-nodisp", "-autoexit", source], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffplay exited with code ${code}`));
      });
    });
  }
};

/**
 * Play a sound from a local file path or a remote URL (YouTube, etc.).
 * @param source  File path or http(s) URL.
 * @param playFn  Injectable — replaces the real subprocess in tests.
 */
export async function playSound(
  source: string,
  playFn: PlayFn = defaultPlayFn
): Promise<void> {
  await playFn(source);
}

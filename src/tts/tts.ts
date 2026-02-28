import { spawn } from "node:child_process";
import type OpenAI from "openai";

export type PlayerFn = (audioBuffer: Buffer) => Promise<void>;

export const VALID_VOICES = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
] as const;
export type Voice = (typeof VALID_VOICES)[number];

export function isValidVoice(v: string): v is Voice {
  return (VALID_VOICES as readonly string[]).includes(v);
}

/** Pipes an MP3 buffer to ffplay for playback. Requires ffmpeg on the host. */
export function defaultPlayer(audioBuffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "ffplay",
      ["-nodisp", "-autoexit", "-f", "mp3", "-i", "pipe:0"],
      { stdio: ["pipe", "ignore", "ignore"] }
    );
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffplay exited with code ${code}`));
    });
    proc.stdin.end(audioBuffer);
  });
}

/**
 * Converts text to speech via OpenAI TTS and plays it through the system speaker.
 *
 * @param text     Text to speak.
 * @param openai   OpenAI client instance.
 * @param voice    One of the VALID_VOICES (default: "alloy").
 * @param playerFn Injectable player — replaces ffplay in tests.
 */
export async function speak(
  text: string,
  openai: OpenAI,
  voice: Voice = "alloy",
  playerFn: PlayerFn = defaultPlayer
): Promise<void> {
  const response = await openai.audio.speech.create({
    model: "tts-1",
    voice,
    input: text,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  await playerFn(buffer);
}

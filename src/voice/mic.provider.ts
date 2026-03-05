import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type OpenAI from "openai";
import { transcribeAudio } from "./whisper.client.js";

export class MicProvider {
  private running = false;

  constructor(
    private readonly config: {
      openai: OpenAI;
      onTranscript: (text: string) => Promise<void>;
      recordDurationSec?: number;
      tempFile?: string;
    }
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop().catch((err) => console.error("MicProvider loop crashed:", err));
  }

  stop(): void {
    this.running = false;
  }

  private async loop(): Promise<void> {
    const duration = this.config.recordDurationSec ?? 5;
    const tempFile = this.config.tempFile ?? "/tmp/homepi_voice.wav";

    while (this.running) {
      try {
        await this.record(duration, tempFile);
        const buf = await readFile(tempFile);
        const text = await transcribeAudio(buf, "audio.wav", this.config.openai);
        if (text.length > 3) {
          await this.config.onTranscript(text);
        }
      } catch (err) {
        console.error("MicProvider error:", err);
        await new Promise((res) => setTimeout(res, 1000));
      }
    }
  }

  private record(duration: number, outputFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn("arecord", [
        "-d", String(duration),
        "-f", "S16_LE",
        "-r", "16000",
        "-c", "1",
        outputFile,
      ]);
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`arecord exited with code ${code}`));
      });
    });
  }
}

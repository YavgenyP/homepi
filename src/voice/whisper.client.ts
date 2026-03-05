import type OpenAI from "openai";
import { toFile } from "openai/uploads";

export async function transcribeAudio(
  buffer: Buffer,
  filename: string,
  openai: OpenAI
): Promise<string> {
  try {
    const file = await toFile(buffer, filename, { type: "audio/wav" });
    const response = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file,
    });
    return response.text.trim();
  } catch {
    return "";
  }
}

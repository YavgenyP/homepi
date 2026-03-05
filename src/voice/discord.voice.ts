import { createRequire } from "node:module";
import type { Client } from "discord.js";
import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  EndBehaviorType,
} from "@discordjs/voice";
import type OpenAI from "openai";
import { encodeWav } from "./wav.js";
import { transcribeAudio } from "./whisper.client.js";

// prism-media is a transitive dep of @discordjs/voice (no TS types published)
const require = createRequire(import.meta.url);
const prism = require("prism-media") as {
  opus: { Decoder: new (opts: { rate: number; channels: number; frameSize: number }) => import("node:stream").Transform };
};

export class DiscordVoiceListener {
  private stopped = false;
  private readonly activeStreams = new Set<string>();

  constructor(
    private readonly config: {
      channelId: string;
      guildId: string;
      client: Client;
      openai: OpenAI;
      onTranscript: (userId: string, username: string, text: string) => Promise<void>;
    }
  ) {}

  async start(): Promise<void> {
    const { channelId, guildId, client } = this.config;

    const channel = await client.channels.fetch(channelId);
    if (!channel || !("guild" in channel)) {
      console.error("Voice channel not found or not a guild channel:", channelId);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const guildChannel = channel as any;

    const connection = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator: guildChannel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch {
      console.error("Failed to join voice channel within 30s");
      connection.destroy();
      return;
    }

    console.log("Voice listener ready in channel:", channelId);

    const receiver = connection.receiver;

    receiver.speaking.on("start", (userId: string) => {
      if (this.stopped || this.activeStreams.has(userId)) return;
      this.activeStreams.add(userId);

      const audioStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
      });

      const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
      const chunks: Buffer[] = [];

      audioStream.pipe(decoder);
      decoder.on("data", (chunk: Buffer) => chunks.push(chunk));

      decoder.on("end", async () => {
        this.activeStreams.delete(userId);
        if (this.stopped || chunks.length === 0) return;

        const pcm = Buffer.concat(chunks);
        const wav = encodeWav(pcm);
        const text = await transcribeAudio(wav, "audio.wav", this.config.openai);
        if (!text) return;

        const member = await guildChannel.guild.members.fetch(userId).catch(() => null);
        const username = (member?.user?.username as string | undefined) ?? userId;
        await this.config.onTranscript(userId, username, text);
      });

      decoder.on("error", (err: Error) => {
        this.activeStreams.delete(userId);
        console.error("Opus decoder error:", err);
      });
    });
  }

  stop(): void {
    this.stopped = true;
  }
}

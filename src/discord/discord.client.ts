import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import type OpenAI from "openai";
import type Database from "better-sqlite3";
import { handleMessage, handleVoiceCommand } from "./message.handler.js";
import type { SmartThingsCommandFn } from "../samsung/smartthings.client.js";
import type { HACommandFn, HAQueryFn, HASyncFn } from "../homeassistant/ha.client.js";
import { DiscordVoiceListener } from "../voice/discord.voice.js";

export type DiscordConfig = {
  token: string;
  channelId: string;
  openai: OpenAI;
  model: string;
  confidenceThreshold: number;
  evalSamplingRate: number;
  db: Database.Database;
  getPresenceStates: () => Map<number, "home" | "away">;
  /** Called with the reply text whenever the bot responds to a message. */
  speakFn?: (text: string) => void;
  gcalKeyFile?: string;
  controlDeviceFn?: SmartThingsCommandFn;
  controlHAFn?: HACommandFn;
  queryHAFn?: HAQueryFn;
  syncHAFn?: HASyncFn;
  /** Voice channel to auto-join on startup (optional). */
  voiceChannelId?: string;
  /** Guild ID — required when voiceChannelId is set. */
  guildId?: string;
};

export type DiscordBot = {
  client: Client;
  sendToChannel: (text: string) => Promise<void>;
  processVoiceText: (userId: string, username: string, text: string) => Promise<string | null>;
};

export async function startDiscordBot(config: DiscordConfig): Promise<DiscordBot> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });

  let sendToChannel: (text: string) => Promise<void> = async () => {};

  const ctx = {
    channelId: config.channelId,
    openai: config.openai,
    model: config.model,
    confidenceThreshold: config.confidenceThreshold,
    evalSamplingRate: config.evalSamplingRate,
    db: config.db,
    getPresenceStates: config.getPresenceStates,
    gcalKeyFile: config.gcalKeyFile,
    controlDeviceFn: config.controlDeviceFn,
    controlHAFn: config.controlHAFn,
    queryHAFn: config.queryHAFn,
    syncHAFn: config.syncHAFn,
  };

  const processVoiceText = (userId: string, username: string, text: string) =>
    handleVoiceCommand(userId, username, text, ctx);

  client.once("ready", async () => {
    console.log(`Discord bot ready: ${client.user?.tag}`);
    const channel = await client.channels.fetch(config.channelId);
    if (channel instanceof TextChannel) {
      sendToChannel = (text) => channel.send(text).then(() => {});
      console.log("Bot online.");
    }

    if (config.voiceChannelId && config.guildId) {
      const voiceListener = new DiscordVoiceListener({
        channelId: config.voiceChannelId,
        guildId: config.guildId,
        client,
        openai: config.openai,
        onTranscript: async (userId, username, text) => {
          const reply = await handleVoiceCommand(userId, username, text, ctx);
          if (reply) {
            await sendToChannel(reply);
            config.speakFn?.(reply);
          }
        },
      });
      voiceListener.start().catch((err) => console.error("Voice listener error:", err));
    }
  });

  client.on("messageCreate", async (msg) => {
    const reply = await handleMessage(msg, ctx);
    if (reply) {
      await msg.reply(reply);
      config.speakFn?.(reply);
    }
  });

  await client.login(config.token);
  return { client, sendToChannel, processVoiceText };
}

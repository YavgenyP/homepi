import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import type OpenAI from "openai";
import type Database from "better-sqlite3";
import { handleMessage } from "./message.handler.js";

export type DiscordConfig = {
  token: string;
  channelId: string;
  openai: OpenAI;
  model: string;
  confidenceThreshold: number;
  db: Database.Database;
  getPresenceStates: () => Map<number, "home" | "away">;
};

export type DiscordBot = {
  client: Client;
  sendToChannel: (text: string) => Promise<void>;
};

export async function startDiscordBot(config: DiscordConfig): Promise<DiscordBot> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  let sendToChannel: (text: string) => Promise<void> = async () => {};

  const ctx = {
    channelId: config.channelId,
    openai: config.openai,
    model: config.model,
    confidenceThreshold: config.confidenceThreshold,
    db: config.db,
    getPresenceStates: config.getPresenceStates,
  };

  client.once("ready", async () => {
    console.log(`Discord bot ready: ${client.user?.tag}`);
    const channel = await client.channels.fetch(config.channelId);
    if (channel instanceof TextChannel) {
      sendToChannel = (text) => channel.send(text).then(() => {});
      await channel.send("Bot online.");
    }
  });

  client.on("messageCreate", async (msg) => {
    const reply = await handleMessage(msg, ctx);
    if (reply) await msg.reply(reply);
  });

  await client.login(config.token);
  return { client, sendToChannel };
}

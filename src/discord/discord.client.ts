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
};

export async function startDiscordBot(config: DiscordConfig): Promise<Client> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const ctx = {
    channelId: config.channelId,
    openai: config.openai,
    model: config.model,
    confidenceThreshold: config.confidenceThreshold,
    db: config.db,
  };

  client.once("ready", async () => {
    console.log(`Discord bot ready: ${client.user?.tag}`);
    const channel = await client.channels.fetch(config.channelId);
    if (channel instanceof TextChannel) {
      await channel.send("Bot online.");
    }
  });

  client.on("messageCreate", async (msg) => {
    const reply = await handleMessage(msg, ctx);
    if (reply) await msg.reply(reply);
  });

  await client.login(config.token);
  return client;
}

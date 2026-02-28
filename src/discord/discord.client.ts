import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import { handleMessage } from "./message.handler.js";

export type DiscordConfig = {
  token: string;
  channelId: string;
};

export async function startDiscordBot(config: DiscordConfig): Promise<Client> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once("ready", async () => {
    console.log(`Discord bot ready: ${client.user?.tag}`);
    const channel = await client.channels.fetch(config.channelId);
    if (channel instanceof TextChannel) {
      await channel.send("Bot online.");
    }
  });

  client.on("messageCreate", async (msg) => {
    const reply = await handleMessage(msg, { channelId: config.channelId });
    if (reply) await msg.reply(reply);
  });

  await client.login(config.token);
  return client;
}

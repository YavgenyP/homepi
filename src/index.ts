import { createHealthServer } from "./health.js";
import { startDiscordBot } from "./discord/discord.client.js";

const PORT = Number(process.env.PORT ?? 3000);

createHealthServer(PORT);
console.log(`Health server listening on port ${PORT}`);

const token = process.env.DISCORD_TOKEN;
const channelId = process.env.DISCORD_CHANNEL_ID;

if (!token || !channelId) {
  console.error("Missing DISCORD_TOKEN or DISCORD_CHANNEL_ID — bot not started.");
  process.exit(1);
}

await startDiscordBot({ token, channelId });

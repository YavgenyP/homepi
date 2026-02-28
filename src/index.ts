import OpenAI from "openai";
import { createHealthServer } from "./health.js";
import { startDiscordBot } from "./discord/discord.client.js";
import { openDb } from "./storage/db.js";

const PORT = Number(process.env.PORT ?? 3000);

createHealthServer(PORT);
console.log(`Health server listening on port ${PORT}`);

const token = process.env.DISCORD_TOKEN;
const channelId = process.env.DISCORD_CHANNEL_ID;
const openaiKey = process.env.OPENAI_API_KEY;

if (!token || !channelId || !openaiKey) {
  console.error("Missing DISCORD_TOKEN, DISCORD_CHANNEL_ID, or OPENAI_API_KEY.");
  process.exit(1);
}

const db = openDb(process.env.SQLITE_PATH ?? "./app.db");
const openai = new OpenAI({ apiKey: openaiKey });
const model = process.env.LLM_MODEL ?? "gpt-4o";
const confidenceThreshold = Number(process.env.LLM_CONFIDENCE_THRESHOLD ?? 0.75);

await startDiscordBot({ token, channelId, openai, model, confidenceThreshold, db });

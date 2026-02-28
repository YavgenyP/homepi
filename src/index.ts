import OpenAI from "openai";
import { createHealthServer } from "./health.js";
import { startDiscordBot } from "./discord/discord.client.js";
import { openDb } from "./storage/db.js";
import { PingProvider } from "./presence/ping.provider.js";
import { BleProvider } from "./presence/ble.provider.js";
import { PresenceStateMachine } from "./presence/presence.state.js";
import type { PresenceProvider } from "./presence/provider.interface.js";
import { Scheduler } from "./scheduler/scheduler.js";
import { evaluateArrivalRules } from "./rules/arrival.evaluator.js";

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

const providers: PresenceProvider[] = [
  new PingProvider(db, Number(process.env.PRESENCE_PING_TIMEOUT_MS ?? 1000)),
];

if (process.env.PRESENCE_BLE_ENABLED === "true") {
  providers.push(
    new BleProvider(
      db,
      Number(process.env.PRESENCE_BLE_SCAN_INTERVAL_SEC ?? 20) * 1000
    )
  );
  console.log("BLE provider enabled.");
}

// Presence machine starts with a stub notify — replaced after Discord is ready
let sendToChannel: (text: string) => Promise<void> = async () => {};

const presenceMachine = new PresenceStateMachine(
  providers,
  db,
  async (personId) => {
    await evaluateArrivalRules(personId, db, (text) => sendToChannel(text));
  },
  {
    intervalSec: Number(process.env.PRESENCE_PING_INTERVAL_SEC ?? 30),
    debounceSec: Number(process.env.PRESENCE_DEBOUNCE_SEC ?? 60),
    homeTtlSec: Number(process.env.PRESENCE_HOME_TTL_SEC ?? 180),
  }
);

const bot = await startDiscordBot({
  token,
  channelId,
  openai,
  model,
  confidenceThreshold,
  db,
  getPresenceStates: () => presenceMachine.getCurrentStates(),
});

sendToChannel = bot.sendToChannel;
presenceMachine.start();

const scheduler = new Scheduler(
  db,
  (text) => sendToChannel(text),
  Number(process.env.SCHEDULER_INTERVAL_SEC ?? 30)
);
scheduler.start();

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
import { speak, isValidVoice } from "./tts/tts.js";
import { playSound } from "./sound/sound.player.js";
import { sendDeviceCommand, type DeviceCommand } from "./samsung/smartthings.client.js";
import { getValidToken } from "./samsung/smartthings.auth.js";
import { sendHACommand, getHAState, getHAAllStates, type HACommandFn } from "./homeassistant/ha.client.js";
import { MicProvider } from "./voice/mic.provider.js";
import { createUIServer } from "./ui/server.js";
import type { HandlerContext } from "./discord/message.handler.js";
import { syncPhotosFromDrive } from "./photos/gdrive.client.js";

const PORT = Number(process.env.PORT ?? 3000);

createHealthServer(PORT);
console.log(`Health server listening on port ${PORT}`);

const token = process.env.DISCORD_TOKEN;
const channelId = process.env.DISCORD_CHANNEL_ID;
const openaiKey = process.env.OPENAI_API_KEY;
const voiceChannelId = process.env.DISCORD_VOICE_CHANNEL_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const voiceMicEnabled = process.env.VOICE_MIC_ENABLED === "true";
const voiceMicUserId = process.env.VOICE_MIC_USER_ID ?? "0";
const voiceMicUsername = process.env.VOICE_MIC_USERNAME ?? "voice";
const voiceMicRecordSec = Number(process.env.VOICE_MIC_RECORD_SEC ?? 5);

if (!token || !channelId || !openaiKey) {
  console.error("Missing DISCORD_TOKEN, DISCORD_CHANNEL_ID, or OPENAI_API_KEY.");
  process.exit(1);
}

const db = openDb(process.env.SQLITE_PATH ?? "./app.db");
const openai = new OpenAI({ apiKey: openaiKey });
const model = process.env.LLM_MODEL ?? "gpt-4o";
const confidenceThreshold = Number(process.env.LLM_CONFIDENCE_THRESHOLD ?? 0.75);
const evalSamplingRate = Number(process.env.LLM_EVAL_SAMPLING_RATE ?? 0.05);

const gcalKeyFile = process.env.GCAL_KEY_FILE;

// SmartThings — optional, enabled via SMARTTHINGS_CLIENT_ID + SMARTTHINGS_CLIENT_SECRET
const smartthingsClientId = process.env.SMARTTHINGS_CLIENT_ID;
const smartthingsClientSecret = process.env.SMARTTHINGS_CLIENT_SECRET;
const controlDeviceFn =
  smartthingsClientId && smartthingsClientSecret
    ? async (deviceId: string, command: DeviceCommand, value?: string | number) => {
        const token = await getValidToken(db, smartthingsClientId, smartthingsClientSecret);
        return sendDeviceCommand(deviceId, command, value, token);
      }
    : undefined;
if (controlDeviceFn) console.log("SmartThings device control enabled (OAuth).");

// Home Assistant — optional, enabled via HOMEASSISTANT_URL + HOMEASSISTANT_TOKEN
const haUrl = process.env.HOMEASSISTANT_URL;
const haToken = process.env.HOMEASSISTANT_TOKEN;
const controlHAFn: HACommandFn | undefined =
  haUrl && haToken
    ? (entityId, command, value, remoteEntityId) => sendHACommand(entityId, command, value, haUrl, haToken, fetch, remoteEntityId)
    : undefined;
const queryHAFn =
  haUrl && haToken
    ? (entityId: string) => getHAState(entityId, haUrl, haToken)
    : undefined;
const syncHAFn =
  haUrl && haToken
    ? () => getHAAllStates(haUrl, haToken)
    : undefined;
if (controlHAFn) console.log("Home Assistant device control enabled.");

// TTS — optional, requires ffmpeg on the host and /dev/snd in docker-compose
const ttsEnabled = process.env.TTS_ENABLED === "true";
const ttsVoiceRaw = process.env.TTS_VOICE ?? "alloy";
const ttsVoice = isValidVoice(ttsVoiceRaw) ? ttsVoiceRaw : "alloy";
if (ttsEnabled) console.log(`TTS enabled (voice: ${ttsVoice}).`);

function makeSpeakFn(): ((text: string) => void) | undefined {
  if (!ttsEnabled) return undefined;
  return (text) => {
    speak(text, openai, ttsVoice).catch((err) =>
      console.error("TTS error:", err)
    );
  };
}

const speakFn = makeSpeakFn();

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

// Touchscreen — optional, enabled via TOUCHSCREEN_ENABLED=true
const touchscreenEnabled = process.env.TOUCHSCREEN_ENABLED === "true";
const uiPort = Number(process.env.UI_PORT ?? 8080);
const localUserId = process.env.LOCAL_USER_ID ?? "0";
const localUsername = process.env.LOCAL_USERNAME ?? "touchscreen";

// Presence machine starts with a stub notify — replaced after Discord is ready
let sendToChannel: (text: string) => Promise<void> = async () => {};
let uiBroadcast: ((text: string) => void) | undefined;

const presenceMachine = new PresenceStateMachine(
  providers,
  db,
  async (personId, personName, state) => {
    if (state === "home") {
      await sendToChannel(`${personName} is home.`);
      await evaluateArrivalRules(personId, db, (text) => sendToChannel(text), playSound, controlDeviceFn, controlHAFn);
    } else {
      await sendToChannel(`${personName} has left home.`);
    }
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
  evalSamplingRate,
  db,
  getPresenceStates: () => presenceMachine.getCurrentStates(),
  speakFn,
  gcalKeyFile,
  controlDeviceFn,
  controlHAFn,
  queryHAFn,
  syncHAFn,
  voiceChannelId,
  guildId,
});

// Wrap sendToChannel so proactive notifications (arrival, scheduler) also speak and reach the UI
sendToChannel = async (text) => {
  await bot.sendToChannel(text);
  speakFn?.(text);
  uiBroadcast?.(text);
};

// Touchscreen UI server — started after bot so HandlerContext can reference sendToChannel wrappers
if (touchscreenEnabled) {
  const uiCtx: HandlerContext = {
    channelId,
    openai,
    model,
    confidenceThreshold,
    evalSamplingRate,
    db,
    getPresenceStates: () => presenceMachine.getCurrentStates(),
    gcalKeyFile,
    controlDeviceFn,
    controlHAFn,
    queryHAFn,
    syncHAFn,
  };
  const photosDir = process.env.PHOTOS_DIR ?? "/data/photos";
  const photosGdriveFolder = process.env.GDRIVE_PHOTOS_FOLDER_ID;
  const photoSyncIntervalMin = Number(process.env.PHOTO_SYNC_INTERVAL_MIN ?? 60);

  // Wire setPiPlayingFn after server is created (circular reference avoided via late assignment)
  const ui = createUIServer(uiPort, uiCtx, {
    localUserId,
    localUsername,
    weatherApiKey: process.env.WEATHER_API_KEY,
    weatherLat: process.env.WEATHER_LAT,
    weatherLon: process.env.WEATHER_LON,
    photosDir,
    micRecordSec: voiceMicRecordSec,
    cookiesFile: process.env.YTDLP_COOKIES_FILE,
  });

  // Periodic Google Drive photo sync (optional)
  if (gcalKeyFile && photosGdriveFolder) {
    const runSync = () => {
      syncPhotosFromDrive(gcalKeyFile, photosGdriveFolder, photosDir)
        .then((r) => console.log(`[photos] synced: +${r.downloaded} skip:${r.skipped} err:${r.errors}`))
        .catch((err) => console.error("[photos] sync error:", err));
    };
    runSync();
    setInterval(runSync, photoSyncIntervalMin * 60 * 1000);
    console.log(`Photo sync enabled (folder: ${photosGdriveFolder}, interval: ${photoSyncIntervalMin}min).`);
  }
  uiBroadcast = ui.broadcast;
  uiCtx.setPiPlayingFn = ui.setPiPlaying;
  console.log(`Touchscreen UI enabled on port ${uiPort}.`);
}

presenceMachine.start();

if (voiceMicEnabled) {
  const mic = new MicProvider({
    openai,
    recordDurationSec: voiceMicRecordSec,
    onTranscript: async (text) => {
      const reply = await bot.processVoiceText(voiceMicUserId, voiceMicUsername, text);
      if (reply) {
        await sendToChannel(reply);
        speakFn?.(reply);
      }
    },
  });
  mic.start();
  console.log("Pi microphone voice control enabled.");
}

const scheduler = new Scheduler(
  db,
  (text) => sendToChannel(text),
  Number(process.env.SCHEDULER_INTERVAL_SEC ?? 30),
  playSound,
  () => presenceMachine.getCurrentStates(),
  controlDeviceFn,
  controlHAFn,
  queryHAFn
);
scheduler.start();

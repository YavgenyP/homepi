import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type Database from "better-sqlite3";
import { processCommand, type HandlerContext } from "../discord/message.handler.js";
import { setVolume, stopPlayback } from "../sound/volume.js";
import { getWeather } from "../weather/weather.client.js";
import { listLocalPhotos } from "../photos/gdrive.client.js";
import { transcribeAudio } from "../voice/whisper.client.js";
import { playSound } from "../sound/sound.player.js";

// Static files are co-located in src/ui/public/ (dev) or dist/ui/public/ (prod).
// __dirname is unavailable in ESM; derive from import.meta.url instead.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PUBLIC_DIR = path.join(__dirname, "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".ico":  "image/x-icon",
};

export type UIServerOpts = {
  localUserId: string;
  localUsername: string;
  publicDir?: string;
  weatherApiKey?: string;
  weatherLat?: string;
  weatherLon?: string;
  photosDir?: string;
  micRecordSec?: number;
  cookiesFile?: string;
};

export type PiPlayingInfo = { source: string; title: string };

export type UIServer = {
  server: http.Server;
  /** Call this to push a message to all connected touchscreen clients */
  broadcast: (text: string) => void;
  /** Update what's currently playing on the Pi (from Discord/chat play_sound commands) */
  setPiPlaying: (info: PiPlayingInfo | null) => void;
};

function buildUiState(db: Database.Database, getPresenceStates: () => Map<number, "home" | "away">) {
  const presenceMap = getPresenceStates();

  const people = (
    db.prepare("SELECT id, name FROM people ORDER BY name").all() as Array<{ id: number; name: string }>
  ).map((p) => ({ name: p.name, state: presenceMap.get(p.id) ?? "away" }));

  const devices = [
    ...(db.prepare("SELECT name, room, '' as entity_id FROM smart_devices ORDER BY name").all() as Array<{
      name: string; room: string; entity_id: string;
    }>),
    ...(db.prepare("SELECT name, room, entity_id FROM ha_devices ORDER BY name").all() as Array<{
      name: string; room: string; entity_id: string;
    }>),
  ];

  const topCommands = db
    .prepare(
      `SELECT device_name as device, command, COUNT(*) as count
       FROM task_executions
       GROUP BY device_name, command
       ORDER BY count DESC
       LIMIT 4`
    )
    .all() as Array<{ device: string; command: string; count: number }>;

  let shortcuts: Array<{ name: string; url: string }> = [];
  try {
    shortcuts = db
      .prepare("SELECT name, url FROM sound_shortcuts ORDER BY name")
      .all() as Array<{ name: string; url: string }>;
  } catch {
    // Table doesn't exist yet (added in item #39) — return empty list
  }

  return { people, devices, topCommands, shortcuts };
}

export function createUIServer(
  port: number,
  ctx: HandlerContext,
  opts: UIServerOpts
): UIServer {
  const publicDir = opts.publicDir ?? DEFAULT_PUBLIC_DIR;
  const clients = new Set<WebSocket>();

  // ── Pi playback state ────────────────────────────────────────────────────────
  let piPlaying: PiPlayingInfo | null = null;

  function setPiPlaying(info: PiPlayingInfo | null): void {
    piPlaying = info;
  }

  function broadcast(text: string): void {
    const msg = JSON.stringify({ type: "message", text });
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  }

  // ── HTTP ────────────────────────────────────────────────────────────────────

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    // REST endpoint: GET /ui-state
    if (req.method === "GET" && url.pathname === "/ui-state") {
      const state = buildUiState(ctx.db, ctx.getPresenceStates);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(state));
      return;
    }

    // REST endpoint: POST /volume  body: { level: number }
    if (req.method === "POST" && url.pathname === "/volume") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const { level } = JSON.parse(body) as { level: number };
          const backend = process.env.AUDIO_BACKEND ?? "auto";
          setVolume(level, backend)
            .then(() => {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true, level }));
            })
            .catch((err) => {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, error: String(err) }));
            });
        } catch {
          res.writeHead(400);
          res.end("Bad request");
        }
      });
      return;
    }

    // REST endpoint: POST /mic — one-shot Pi microphone recording → Whisper → processCommand
    if (req.method === "POST" && url.pathname === "/mic") {
      const { exec } = await import("node:child_process");
      const { readFile, unlink } = await import("node:fs/promises");
      const tmpFile = "/tmp/homepi_ui_mic.wav";
      const duration = opts.micRecordSec ?? 5;

      exec(
        `arecord -d ${duration} -f S16_LE -r 16000 -c 1 ${tmpFile}`,
        async (err) => {
          if (err) {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "arecord failed — is a microphone attached?" }));
            return;
          }
          try {
            const buf = await readFile(tmpFile);
            await unlink(tmpFile).catch(() => {});
            const transcript = await transcribeAudio(buf, "audio.wav", ctx.openai);
            if (!transcript || transcript.length < 3) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ transcript: "", reply: null }));
              return;
            }
            const reply = await processCommand(opts.localUserId, opts.localUsername, transcript, ctx.channelId, ctx);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ transcript, reply }));
            if (reply) broadcast(reply);
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(e) }));
          }
        }
      );
      return;
    }

    // REST endpoint: GET /photos — list synced photo filenames
    if (req.method === "GET" && url.pathname === "/photos") {
      const dir = opts.photosDir ?? "";
      const files = dir ? listLocalPhotos(dir) : [];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(files));
      return;
    }

    // Static: GET /photo/<filename> — serve a synced photo
    if (req.method === "GET" && url.pathname.startsWith("/photo/")) {
      const photosDir = opts.photosDir;
      if (!photosDir) { res.writeHead(404); res.end(); return; }
      const filename = path.basename(url.pathname.slice("/photo/".length));
      const filePath = path.join(photosDir, filename);
      if (!filePath.startsWith(path.resolve(photosDir))) { res.writeHead(403); res.end(); return; }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        const ext = path.extname(filename).toLowerCase();
        const mime = ext === ".png" ? "image/png" : "image/jpeg";
        res.writeHead(200, { "Content-Type": mime });
        res.end(data);
      });
      return;
    }

    // REST endpoint: GET /weather
    if (req.method === "GET" && url.pathname === "/weather") {
      const { weatherApiKey, weatherLat, weatherLon } = opts;
      if (!weatherApiKey || !weatherLat || !weatherLon) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(null));
        return;
      }
      try {
        const data = await getWeather(weatherApiKey, weatherLat, weatherLon);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      } catch (err) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    // REST endpoint: GET /now-playing — current Pi yt-dlp playback state
    if (req.method === "GET" && url.pathname === "/now-playing") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(piPlaying));
      return;
    }

    // REST endpoint: POST /play-pi — play a URL/file directly on Pi (with title for display)
    if (req.method === "POST" && url.pathname === "/play-pi") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let source: string, title: string;
        try {
          ({ url: source, title } = JSON.parse(body) as { url: string; title: string });
        } catch {
          res.writeHead(400);
          res.end("Bad request");
          return;
        }
        piPlaying = { source, title };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        playSound(source)
          .catch((err) => console.error("play-pi error:", err))
          .finally(() => {
            if (piPlaying?.source === source) piPlaying = null;
          });
      });
      return;
    }

    // REST endpoint: GET /devices-state — live HA state for all registered ha_devices
    if (req.method === "GET" && url.pathname === "/devices-state") {
      const haRows = ctx.db
        .prepare("SELECT name, room, entity_id FROM ha_devices ORDER BY name")
        .all() as Array<{ name: string; room: string; entity_id: string }>;
      const stRows = ctx.db
        .prepare("SELECT name, room, device_type FROM smart_devices ORDER BY name")
        .all() as Array<{ name: string; room: string; device_type: string }>;

      const haResults = await Promise.all(
        haRows.map(async (d) => {
          let haState: { state: string; attributes: Record<string, unknown> } | null = null;
          if (ctx.queryHAFn) {
            try { haState = await ctx.queryHAFn(d.entity_id); } catch { /* offline */ }
          }
          const domain = d.entity_id.split(".")[0] ?? "unknown";
          return { name: d.name, room: d.room ?? null, entity_id: d.entity_id, domain, haState };
        })
      );

      const stResults = stRows.map((d) => ({
        name: d.name,
        room: d.room ?? null,
        entity_id: null as string | null,
        domain: "smartthings",
        device_type: d.device_type,
        haState: null,
      }));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([...haResults, ...stResults]));
      return;
    }

    // REST endpoint: POST /command — run a text command through processCommand
    if (req.method === "POST" && url.pathname === "/command") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let text: string;
        try {
          ({ text } = JSON.parse(body) as { text: string });
        } catch {
          res.writeHead(400);
          res.end("Bad request");
          return;
        }
        processCommand(opts.localUserId, opts.localUsername, text, ctx.channelId, ctx)
          .then((reply) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ reply }));
            if (reply) broadcast(reply);
          })
          .catch((err) => {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ reply: null, error: String(err) }));
          });
      });
      return;
    }

    // REST endpoint: POST /stop-sound
    if (req.method === "POST" && url.pathname === "/stop-sound") {
      stopPlayback()
        .then(() => {
          piPlaying = null;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        })
        .catch(() => {
          piPlaying = null;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true })); // best-effort
        });
      return;
    }

    // REST endpoint: POST /youtube-search — search YouTube via yt-dlp, return results
    if (req.method === "POST" && url.pathname === "/youtube-search") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        let query: string;
        try {
          ({ query } = JSON.parse(body) as { query: string });
        } catch {
          res.writeHead(400);
          res.end("Bad request");
          return;
        }
        if (!query?.trim()) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify([]));
          return;
        }
        const { spawn } = await import("node:child_process");
        // -j (lowercase) outputs one full JSON per result line — compatible with all yt-dlp versions
        const searchArgs = [`ytsearch5:${query}`, "-j", "--no-playlist"];
        if (opts.cookiesFile) searchArgs.push("--cookies", opts.cookiesFile);
        const proc = spawn("yt-dlp", searchArgs);
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
        proc.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
        proc.on("error", () => {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "yt-dlp not found — install yt-dlp to enable search" }));
        });
        proc.on("close", (code) => {
          if (res.headersSent) return;
          if (code !== 0 && !stdout) {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `yt-dlp exited ${code}: ${stderr.slice(0, 200)}` }));
            return;
          }
          type RawVideo = { id?: string; title?: string; duration?: number | null; thumbnail?: string };
          const results = stdout
            .split("\n")
            .filter(Boolean)
            .flatMap((line) => {
              try {
                const v = JSON.parse(line) as RawVideo;
                if (!v.id) return [];
                return [{ id: v.id, title: v.title ?? "Unknown", duration: v.duration ?? null,
                  thumbnail: v.thumbnail ?? `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg` }];
              } catch { return []; }
            });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(results));
        });
      });
      return;
    }

    // Static files
    let filePath = path.resolve(publicDir, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    // Security: prevent path traversal
    const normalizedPublic = path.resolve(publicDir);
    if (!filePath.startsWith(normalizedPublic + path.sep) && filePath !== normalizedPublic) {
      res.writeHead(403);
      res.end();
      return;
    }

    fs.stat(filePath, (statErr, stat) => {
      if (statErr || !stat.isFile()) {
        // SPA fallback
        filePath = path.join(publicDir, "index.html");
      }
      fs.readFile(filePath, (readErr, data) => {
        if (readErr) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const ext = path.extname(filePath);
        const headers: Record<string, string> = { "Content-Type": MIME[ext] ?? "application/octet-stream" };
        // Prevent caching of JS/CSS so updates are picked up immediately
        if (ext === ".js" || ext === ".css") headers["Cache-Control"] = "no-store";
        res.writeHead(200, headers);
        res.end(data);
      });
    });
  });

  // ── WebSocket ───────────────────────────────────────────────────────────────

  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.on("message", (raw) => {
      const text = raw.toString().trim();
      if (!text) return;
      processCommand(opts.localUserId, opts.localUsername, text, ctx.channelId, ctx)
        .then((reply) => {
          if (reply) ws.send(JSON.stringify({ type: "reply", text: reply }));
        })
        .catch(console.error);
    });
  });

  // ── Start ───────────────────────────────────────────────────────────────────

  server.listen(port, () => {
    console.log(`UI server listening on port ${port}`);
  });

  return { server, broadcast, setPiPlaying };
}

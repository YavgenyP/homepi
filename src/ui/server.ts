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
};

export type UIServer = {
  server: http.Server;
  /** Call this to push a message to all connected touchscreen clients */
  broadcast: (text: string) => void;
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

    // REST endpoint: GET /now-playing — state of the first media_player ha_device
    if (req.method === "GET" && url.pathname === "/now-playing") {
      const row = ctx.db
        .prepare("SELECT name, entity_id FROM ha_devices WHERE entity_id LIKE 'media_player.%' LIMIT 1")
        .get() as { name: string; entity_id: string } | undefined;

      if (!row || !ctx.queryHAFn) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(null));
        return;
      }

      try {
        const ha = await ctx.queryHAFn(row.entity_id);
        const attrs = ha.attributes as Record<string, unknown>;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          entity_id: row.entity_id,
          name: row.name,
          state: ha.state,
          title: (attrs.media_title as string | undefined) ?? null,
          artist: (attrs.media_artist as string | undefined) ?? null,
          volume: attrs.volume_level != null ? Math.round((attrs.volume_level as number) * 100) : null,
        }));
      } catch {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(null));
      }
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
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        })
        .catch(() => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true })); // best-effort
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
        res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
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

  return { server, broadcast };
}

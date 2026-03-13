import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type Database from "better-sqlite3";
import { processCommand, type HandlerContext } from "../discord/message.handler.js";

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

  return { people, devices, topCommands };
}

export function createUIServer(
  port: number,
  ctx: HandlerContext,
  opts: UIServerOpts
): UIServer {
  const publicDir = opts.publicDir ?? DEFAULT_PUBLIC_DIR;
  const clients = new Set<WebSocket>();

  // ── HTTP ────────────────────────────────────────────────────────────────────

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    // REST endpoint
    if (req.method === "GET" && url.pathname === "/ui-state") {
      const state = buildUiState(ctx.db, ctx.getPresenceStates);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(state));
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

  function broadcast(text: string): void {
    const msg = JSON.stringify({ type: "message", text });
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  }

  return { server, broadcast };
}

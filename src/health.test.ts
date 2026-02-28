import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { createHealthServer } from "./health.js";

function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    }).on("error", reject);
  });
}

describe("health server", () => {
  let server: http.Server;

  afterEach(() => {
    server.close();
  });

  it("GET /health returns 200 with status ok", async () => {
    server = createHealthServer(0);
    await new Promise<void>((r) => server.once("listening", r));
    const { port } = server.address() as { port: number };

    const { status, body } = await get(`http://localhost:${port}/health`);
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ status: "ok" });
  });

  it("unknown routes return 404", async () => {
    server = createHealthServer(0);
    await new Promise<void>((r) => server.once("listening", r));
    const { port } = server.address() as { port: number };

    const { status } = await get(`http://localhost:${port}/unknown`);
    expect(status).toBe(404);
  });
});

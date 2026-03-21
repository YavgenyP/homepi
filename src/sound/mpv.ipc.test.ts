import { describe, it, expect, vi } from "vitest";
import { sendMpvCommand } from "./mpv.ipc.js";
import { EventEmitter } from "node:events";

function makeSocket(shouldError = false) {
  const sock = new EventEmitter() as EventEmitter & {
    write: (d: string) => void;
    end: () => void;
    destroy: () => void;
    setTimeout: (ms: number, fn: () => void) => void;
  };
  sock.write = vi.fn();
  sock.end = vi.fn(() => setImmediate(() => sock.emit("close")));
  sock.destroy = vi.fn();
  sock.setTimeout = vi.fn();

  if (shouldError) setImmediate(() => sock.emit("error", new Error("ENOENT")));
  return sock;
}

describe("sendMpvCommand", () => {
  it("writes JSON command to socket and resolves", async () => {
    const sock = makeSocket();
    const connectFn = vi.fn((_path: unknown, cb: () => void) => { setImmediate(cb); return sock; });
    await sendMpvCommand(["cycle", "pause"], "/tmp/test.sock", connectFn as never);
    expect(sock.write).toHaveBeenCalledWith(
      JSON.stringify({ command: ["cycle", "pause"] }) + "\n"
    );
  });

  it("resolves silently when socket does not exist (ENOENT)", async () => {
    const sock = makeSocket(true);
    const connectFn = vi.fn(() => sock);
    await expect(
      sendMpvCommand(["seek", 10], "/tmp/missing.sock", connectFn as never)
    ).resolves.toBeUndefined();
  });
});

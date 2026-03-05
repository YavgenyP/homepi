import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type OpenAI from "openai";

// --- module mocks (hoisted) ---
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
vi.mock("./whisper.client.js", () => ({ transcribeAudio: vi.fn() }));

const { spawn } = await import("node:child_process");
const { readFile } = await import("node:fs/promises");
const { transcribeAudio } = await import("./whisper.client.js");
const { MicProvider } = await import("./mic.provider.js");

const fakeOpenai = {} as OpenAI;

/**
 * Returns a mock ChildProcess that emits 'close' with closeCode
 * after the handler is registered (not before).
 */
function makeProc(closeCode = 0) {
  const proc = {
    on(event: string, cb: (...args: unknown[]) => void) {
      if (event === "close") {
        queueMicrotask(() => cb(closeCode));
      }
      return proc;
    },
  };
  return proc as ReturnType<typeof spawn>;
}

beforeEach(() => {
  vi.mocked(spawn).mockImplementation(() => makeProc());
  vi.mocked(readFile).mockResolvedValue(Buffer.from("audio") as never);
  vi.mocked(transcribeAudio).mockResolvedValue("hello world");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("MicProvider", () => {
  it("calls onTranscript when Whisper returns non-empty text", async () => {
    // Stop from inside the callback to prevent infinite tight loop
    let provider: InstanceType<typeof MicProvider>;
    const onTranscript = vi.fn().mockImplementation(async () => { provider.stop(); });
    provider = new MicProvider({ openai: fakeOpenai, onTranscript, tempFile: "/tmp/test.wav" });
    provider.start();

    await vi.waitFor(() => expect(onTranscript).toHaveBeenCalledWith("hello world"), { timeout: 2000 });
  });

  it("skips onTranscript when transcript is 3 chars or fewer", async () => {
    let callCount = 0;
    let provider: InstanceType<typeof MicProvider>;
    vi.mocked(transcribeAudio).mockImplementation(async () => {
      callCount++;
      if (callCount >= 2) provider.stop();
      return "ok";
    });
    const onTranscript = vi.fn().mockResolvedValue(undefined);
    provider = new MicProvider({ openai: fakeOpenai, onTranscript, tempFile: "/tmp/test.wav" });
    provider.start();

    await vi.waitFor(() => expect(callCount).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("loops: calls arecord at least twice in sequence", async () => {
    let spawnCount = 0;
    let provider: InstanceType<typeof MicProvider>;
    vi.mocked(spawn).mockImplementation(() => {
      spawnCount++;
      if (spawnCount >= 2) provider.stop();
      return makeProc();
    });
    const onTranscript = vi.fn().mockResolvedValue(undefined);
    provider = new MicProvider({ openai: fakeOpenai, onTranscript, tempFile: "/tmp/test.wav" });
    provider.start();

    await vi.waitFor(() => expect(spawnCount).toBeGreaterThanOrEqual(2), { timeout: 2000 });
  });

  it("stop() exits the loop cleanly", async () => {
    // stop() from inside the first onTranscript call, then confirm no more spawns
    let provider: InstanceType<typeof MicProvider>;
    const onTranscript = vi.fn().mockImplementation(async () => { provider.stop(); });
    provider = new MicProvider({ openai: fakeOpenai, onTranscript, tempFile: "/tmp/test.wav" });
    provider.start();

    await vi.waitFor(() => expect(onTranscript).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const spawnsBefore = vi.mocked(spawn).mock.calls.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(vi.mocked(spawn).mock.calls.length).toBe(spawnsBefore);
  });

  it("logs error and retries on arecord failure", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    let callCount = 0;
    let provider: InstanceType<typeof MicProvider>;
    vi.mocked(spawn).mockImplementation(() => {
      callCount++;
      if (callCount >= 3) provider.stop();
      return makeProc(callCount === 1 ? 1 : 0);
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onTranscript = vi.fn().mockResolvedValue(undefined);
    provider = new MicProvider({ openai: fakeOpenai, onTranscript, tempFile: "/tmp/test.wav" });
    provider.start();

    // Flush microtasks so the first (failing) iteration runs
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(consoleSpy).toHaveBeenCalled();

    // Advance past the 1s error sleep, then flush microtasks for the retry
    await vi.advanceTimersByTimeAsync(1001);
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(callCount).toBeGreaterThan(1);

    provider.stop();
    vi.useRealTimers();
    consoleSpy.mockRestore();
  });
});

import { describe, it, expect, vi } from "vitest";
import { searchYouTube } from "./youtube.search.js";
import { EventEmitter } from "node:events";

function makeFakeProc(stdout: string, exitCode: number = 0) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  setImmediate(() => {
    if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
    proc.emit("close", exitCode);
  });
  return proc;
}

const SAMPLE_RESULT = JSON.stringify({
  id: "abc123",
  title: "Lofi Hip Hop",
  duration: 3600,
  thumbnail: "https://i.ytimg.com/vi/abc123/mqdefault.jpg",
});

describe("searchYouTube", () => {
  it("returns parsed results from yt-dlp stdout", async () => {
    const spawnFn = vi.fn().mockReturnValue(makeFakeProc(SAMPLE_RESULT + "\n"));
    const results = await searchYouTube("lofi", undefined, spawnFn as never);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "abc123", title: "Lofi Hip Hop", duration: 3600 });
  });

  it("passes cookiesFile to yt-dlp args", async () => {
    const spawnFn = vi.fn().mockReturnValue(makeFakeProc(SAMPLE_RESULT + "\n"));
    await searchYouTube("lofi", "/cookies.txt", spawnFn as never);

    const args = spawnFn.mock.calls[0][1] as string[];
    expect(args).toContain("--cookies");
    expect(args).toContain("/cookies.txt");
  });

  it("uses ytsearch5 prefix", async () => {
    const spawnFn = vi.fn().mockReturnValue(makeFakeProc(SAMPLE_RESULT + "\n"));
    await searchYouTube("jazz", undefined, spawnFn as never);

    const args = spawnFn.mock.calls[0][1] as string[];
    expect(args[0]).toBe("ytsearch5:jazz");
  });

  it("skips malformed lines", async () => {
    const spawnFn = vi.fn().mockReturnValue(
      makeFakeProc(SAMPLE_RESULT + "\nnot-json\n" + JSON.stringify({ title: "no id" }) + "\n")
    );
    const results = await searchYouTube("test", undefined, spawnFn as never);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("abc123");
  });

  it("rejects when yt-dlp exits non-zero with no output", async () => {
    const spawnFn = vi.fn().mockReturnValue(makeFakeProc("", 1));
    await expect(searchYouTube("test", undefined, spawnFn as never)).rejects.toThrow("yt-dlp exited 1");
  });

  it("uses fallback thumbnail when missing", async () => {
    const noThumb = JSON.stringify({ id: "xyz", title: "Test" });
    const spawnFn = vi.fn().mockReturnValue(makeFakeProc(noThumb + "\n"));
    const results = await searchYouTube("test", undefined, spawnFn as never);
    expect(results[0].thumbnail).toContain("xyz");
  });
});

import { describe, it, expect } from "vitest";
import { encodeWav } from "./wav.js";

describe("encodeWav", () => {
  it("output length is 44 + pcm.length", () => {
    const pcm = Buffer.alloc(200);
    expect(encodeWav(pcm).length).toBe(244);
  });

  it("has correct RIFF magic bytes", () => {
    const wav = encodeWav(Buffer.alloc(10));
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
  });

  it("has correct fmt and data chunk markers", () => {
    const wav = encodeWav(Buffer.alloc(10));
    expect(wav.subarray(12, 16).toString("ascii")).toBe("fmt ");
    expect(wav.subarray(36, 40).toString("ascii")).toBe("data");
  });

  it("encodes sample rate correctly", () => {
    const wav = encodeWav(Buffer.alloc(10), 44100, 1, 16);
    expect(wav.readUInt32LE(24)).toBe(44100);
  });

  it("encodes channels correctly", () => {
    const wav = encodeWav(Buffer.alloc(10), 48000, 2, 16);
    expect(wav.readUInt16LE(22)).toBe(2);
  });

  it("encodes bit depth correctly", () => {
    const wav = encodeWav(Buffer.alloc(10), 48000, 2, 16);
    expect(wav.readUInt16LE(34)).toBe(16);
  });
});

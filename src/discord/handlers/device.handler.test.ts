import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../storage/db.js";
import { handleControlDevice } from "./device.handler.js";
import type { Intent } from "../intent.schema.js";

const BASE: Intent = {
  intent: "control_device",
  trigger: "none",
  action: "none",
  message: null,
  time_spec: null,
  person: null,
  phone: null,
  sound_source: null,
  require_home: false,
  device: { name: "tv", command: "on" },
  confidence: 0.95,
  clarifying_question: null,
};

const DEVICE_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

let db: Database.Database;

function seedDevice(name: string, uuid: string): void {
  db.prepare(
    "INSERT INTO smart_devices (name, smartthings_device_id) VALUES (?, ?)"
  ).run(name, uuid);
}

beforeEach(() => {
  db = openDb(":memory:");
});

describe("handleControlDevice", () => {
  it("returns guidance when intent.device is null", async () => {
    const fn = vi.fn();
    const reply = await handleControlDevice({ ...BASE, device: null }, db, fn);
    expect(reply).toMatch(/which device/i);
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns error when device name is not found", async () => {
    const fn = vi.fn();
    const reply = await handleControlDevice(BASE, db, fn);
    expect(reply).toMatch(/don't know a device/i);
    expect(fn).not.toHaveBeenCalled();
  });

  it("calls controlDeviceFn with correct UUID and command for 'on'", async () => {
    seedDevice("tv", DEVICE_UUID);
    const fn = vi.fn().mockResolvedValue(undefined);
    const reply = await handleControlDevice(BASE, db, fn);
    expect(fn).toHaveBeenCalledWith(DEVICE_UUID, "on", undefined);
    expect(reply).toMatch(/turned on tv/i);
  });

  it("calls controlDeviceFn with 'off' command", async () => {
    seedDevice("tv", DEVICE_UUID);
    const fn = vi.fn().mockResolvedValue(undefined);
    await handleControlDevice({ ...BASE, device: { name: "tv", command: "off" } }, db, fn);
    expect(fn).toHaveBeenCalledWith(DEVICE_UUID, "off", undefined);
  });

  it("performs case-insensitive device name lookup", async () => {
    seedDevice("TV", DEVICE_UUID);
    const fn = vi.fn().mockResolvedValue(undefined);
    const reply = await handleControlDevice(
      { ...BASE, device: { name: "tv", command: "on" } },
      db,
      fn
    );
    expect(fn).toHaveBeenCalledWith(DEVICE_UUID, "on", undefined);
    expect(reply).not.toMatch(/don't know/i);
  });

  it("returns error message when controlDeviceFn throws (no crash)", async () => {
    seedDevice("tv", DEVICE_UUID);
    const fn = vi.fn().mockRejectedValue(new Error("SmartThings timeout"));
    const reply = await handleControlDevice(BASE, db, fn);
    expect(reply).toMatch(/failed to control/i);
    expect(reply).toMatch(/SmartThings timeout/);
  });

  it("calls controlDeviceFn with volumeUp and no value", async () => {
    seedDevice("tv", DEVICE_UUID);
    const fn = vi.fn().mockResolvedValue(undefined);
    const reply = await handleControlDevice(
      { ...BASE, device: { name: "tv", command: "volumeUp" } },
      db,
      fn
    );
    expect(fn).toHaveBeenCalledWith(DEVICE_UUID, "volumeUp", undefined);
    expect(reply).toMatch(/turned up the tv volume/i);
  });

  it("calls controlDeviceFn with setVolume and numeric value", async () => {
    seedDevice("tv", DEVICE_UUID);
    const fn = vi.fn().mockResolvedValue(undefined);
    const reply = await handleControlDevice(
      { ...BASE, device: { name: "tv", command: "setVolume", value: 30 } },
      db,
      fn
    );
    expect(fn).toHaveBeenCalledWith(DEVICE_UUID, "setVolume", 30);
    expect(reply).toMatch(/set tv volume to 30/i);
  });

  it("calls controlDeviceFn with setInputSource and string value", async () => {
    seedDevice("tv", DEVICE_UUID);
    const fn = vi.fn().mockResolvedValue(undefined);
    const reply = await handleControlDevice(
      { ...BASE, device: { name: "tv", command: "setInputSource", value: "HDMI2" } },
      db,
      fn
    );
    expect(fn).toHaveBeenCalledWith(DEVICE_UUID, "setInputSource", "HDMI2");
    expect(reply).toMatch(/switched tv input to HDMI2/i);
  });

  it("calls controlDeviceFn with mute and no value", async () => {
    seedDevice("tv", DEVICE_UUID);
    const fn = vi.fn().mockResolvedValue(undefined);
    const reply = await handleControlDevice(
      { ...BASE, device: { name: "tv", command: "mute" } },
      db,
      fn
    );
    expect(fn).toHaveBeenCalledWith(DEVICE_UUID, "mute", undefined);
    expect(reply).toMatch(/muted tv/i);
  });

  it("calls controlDeviceFn with startActivity and app name", async () => {
    seedDevice("tv", DEVICE_UUID);
    const fn = vi.fn().mockResolvedValue(undefined);
    const reply = await handleControlDevice(
      { ...BASE, device: { name: "tv", command: "startActivity", value: "Netflix" } },
      db,
      fn
    );
    expect(fn).toHaveBeenCalledWith(DEVICE_UUID, "startActivity", "Netflix");
    expect(reply).toMatch(/launched Netflix on tv/i);
  });
});

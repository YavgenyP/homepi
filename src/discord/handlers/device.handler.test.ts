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
    expect(fn).toHaveBeenCalledWith(DEVICE_UUID, "on");
    expect(reply).toMatch(/turned on tv/i);
  });

  it("calls controlDeviceFn with 'off' command", async () => {
    seedDevice("tv", DEVICE_UUID);
    const fn = vi.fn().mockResolvedValue(undefined);
    await handleControlDevice({ ...BASE, device: { name: "tv", command: "off" } }, db, fn);
    expect(fn).toHaveBeenCalledWith(DEVICE_UUID, "off");
  });

  it("performs case-insensitive device name lookup", async () => {
    seedDevice("TV", DEVICE_UUID);
    const fn = vi.fn().mockResolvedValue(undefined);
    const reply = await handleControlDevice(
      { ...BASE, device: { name: "tv", command: "on" } },
      db,
      fn
    );
    expect(fn).toHaveBeenCalledWith(DEVICE_UUID, "on");
    expect(reply).not.toMatch(/don't know/i);
  });

  it("returns error message when controlDeviceFn throws (no crash)", async () => {
    seedDevice("tv", DEVICE_UUID);
    const fn = vi.fn().mockRejectedValue(new Error("SmartThings timeout"));
    const reply = await handleControlDevice(BASE, db, fn);
    expect(reply).toMatch(/failed to control/i);
    expect(reply).toMatch(/SmartThings timeout/);
  });
});

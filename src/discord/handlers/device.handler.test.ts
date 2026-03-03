import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../storage/db.js";
import { handleControlDevice, handleQueryDevice } from "./device.handler.js";
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

function seedHADevice(name: string, entityId: string): void {
  db.prepare("INSERT INTO ha_devices (name, entity_id) VALUES (?, ?)").run(name, entityId);
}

describe("handleControlDevice", () => {
  it("returns guidance when intent.device is null", async () => {
    const fn = vi.fn();
    const reply = await handleControlDevice({ ...BASE, device: null }, db, fn, undefined);
    expect(reply).toMatch(/which device/i);
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns error when device name is not found in either table", async () => {
    const fn = vi.fn();
    const reply = await handleControlDevice(BASE, db, fn, undefined);
    expect(reply).toMatch(/don't know a device/i);
    expect(fn).not.toHaveBeenCalled();
  });

  it("calls controlDeviceFn with correct UUID and command for 'on'", async () => {
    seedDevice("tv", DEVICE_UUID);
    const fn = vi.fn().mockResolvedValue(undefined);
    const reply = await handleControlDevice(BASE, db, fn, undefined);
    expect(fn).toHaveBeenCalledWith(DEVICE_UUID, "on", undefined);
    expect(reply).toMatch(/turned on tv/i);
  });

  it("calls controlDeviceFn with 'off' command", async () => {
    seedDevice("tv", DEVICE_UUID);
    const fn = vi.fn().mockResolvedValue(undefined);
    await handleControlDevice({ ...BASE, device: { name: "tv", command: "off" } }, db, fn, undefined);
    expect(fn).toHaveBeenCalledWith(DEVICE_UUID, "off", undefined);
  });

  it("performs case-insensitive device name lookup", async () => {
    seedDevice("TV", DEVICE_UUID);
    const fn = vi.fn().mockResolvedValue(undefined);
    const reply = await handleControlDevice(
      { ...BASE, device: { name: "tv", command: "on" } },
      db,
      fn,
      undefined
    );
    expect(fn).toHaveBeenCalledWith(DEVICE_UUID, "on", undefined);
    expect(reply).not.toMatch(/don't know/i);
  });

  it("returns error message when controlDeviceFn throws (no crash)", async () => {
    seedDevice("tv", DEVICE_UUID);
    const fn = vi.fn().mockRejectedValue(new Error("SmartThings timeout"));
    const reply = await handleControlDevice(BASE, db, fn, undefined);
    expect(reply).toMatch(/failed to control/i);
    expect(reply).toMatch(/SmartThings timeout/);
  });

  it("calls controlDeviceFn with volumeUp and no value", async () => {
    seedDevice("tv", DEVICE_UUID);
    const fn = vi.fn().mockResolvedValue(undefined);
    const reply = await handleControlDevice(
      { ...BASE, device: { name: "tv", command: "volumeUp" } },
      db,
      fn,
      undefined
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
      fn,
      undefined
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
      fn,
      undefined
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
      fn,
      undefined
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
      fn,
      undefined
    );
    expect(fn).toHaveBeenCalledWith(DEVICE_UUID, "startActivity", "Netflix");
    expect(reply).toMatch(/launched Netflix on tv/i);
  });

  it("calls controlHAFn for HA device with correct entity_id", async () => {
    seedHADevice("ac", "climate.tadiran_ac");
    const haFn = vi.fn().mockResolvedValue(undefined);
    const reply = await handleControlDevice(
      { ...BASE, device: { name: "ac", command: "on" } },
      db,
      undefined,
      haFn
    );
    expect(haFn).toHaveBeenCalledWith("climate.tadiran_ac", "on", undefined);
    expect(reply).toMatch(/turned on ac/i);
  });

  it("returns error when HA device registered but no controlHAFn provided", async () => {
    seedHADevice("ac", "climate.tadiran_ac");
    const reply = await handleControlDevice(
      { ...BASE, device: { name: "ac", command: "on" } },
      db,
      undefined,
      undefined
    );
    expect(reply).toMatch(/don't know a device/i);
  });

  it("returns error message when controlHAFn throws", async () => {
    seedHADevice("ac", "climate.tadiran_ac");
    const haFn = vi.fn().mockRejectedValue(new Error("HA timeout"));
    const reply = await handleControlDevice(
      { ...BASE, device: { name: "ac", command: "on" } },
      db,
      undefined,
      haFn
    );
    expect(reply).toMatch(/failed to control/i);
    expect(reply).toMatch(/HA timeout/);
  });

  it("prefers ST over HA when device exists in both tables", async () => {
    seedDevice("ac", DEVICE_UUID);
    seedHADevice("ac", "climate.tadiran_ac");
    const stFn = vi.fn().mockResolvedValue(undefined);
    const haFn = vi.fn().mockResolvedValue(undefined);
    await handleControlDevice(
      { ...BASE, device: { name: "ac", command: "on" } },
      db,
      stFn,
      haFn
    );
    expect(stFn).toHaveBeenCalledWith(DEVICE_UUID, "on", undefined);
    expect(haFn).not.toHaveBeenCalled();
  });

  it("calls controlHAFn with setMode and value", async () => {
    seedHADevice("purifier", "fan.xiaomi_purifier");
    const haFn = vi.fn().mockResolvedValue(undefined);
    const reply = await handleControlDevice(
      { ...BASE, device: { name: "purifier", command: "setMode", value: "Auto" } },
      db,
      undefined,
      haFn
    );
    expect(haFn).toHaveBeenCalledWith("fan.xiaomi_purifier", "setMode", "Auto");
    expect(reply).toMatch(/set purifier mode to Auto/i);
  });
});

describe("handleQueryDevice", () => {
  const QUERY_BASE: Intent = {
    intent: "query_device",
    trigger: "none",
    action: "none",
    message: null,
    time_spec: null,
    person: null,
    phone: null,
    sound_source: null,
    require_home: false,
    device: { name: "air quality", command: "on" },
    confidence: 0.95,
    clarifying_question: null,
  };

  it("returns guidance when intent.device is null", async () => {
    const reply = await handleQueryDevice({ ...QUERY_BASE, device: null }, db, undefined);
    expect(reply).toMatch(/which device/i);
  });

  it("returns error when device not registered in ha_devices", async () => {
    const reply = await handleQueryDevice(QUERY_BASE, db, undefined);
    expect(reply).toMatch(/don't know a device/i);
  });

  it("returns not configured when queryHAFn not provided", async () => {
    db.prepare("INSERT INTO ha_devices (name, entity_id) VALUES (?, ?)").run("air quality", "sensor.pm25");
    const reply = await handleQueryDevice(QUERY_BASE, db, undefined);
    expect(reply).toMatch(/not configured/i);
  });

  it("returns formatted state with unit for known sensor", async () => {
    db.prepare("INSERT INTO ha_devices (name, entity_id) VALUES (?, ?)").run("air quality", "sensor.pm25");
    const queryFn = vi.fn().mockResolvedValue({
      state: "12",
      attributes: { unit_of_measurement: "µg/m³" },
    });
    const reply = await handleQueryDevice(QUERY_BASE, db, queryFn);
    expect(queryFn).toHaveBeenCalledWith("sensor.pm25");
    expect(reply).toBe("air quality: 12 µg/m³");
  });

  it("returns formatted state without unit when attribute is absent", async () => {
    db.prepare("INSERT INTO ha_devices (name, entity_id) VALUES (?, ?)").run("filter", "sensor.filter_life");
    const queryFn = vi.fn().mockResolvedValue({ state: "73", attributes: {} });
    const reply = await handleQueryDevice(
      { ...QUERY_BASE, device: { name: "filter", command: "on" } },
      db,
      queryFn
    );
    expect(reply).toBe("filter: 73");
  });

  it("returns error message when queryHAFn throws", async () => {
    db.prepare("INSERT INTO ha_devices (name, entity_id) VALUES (?, ?)").run("air quality", "sensor.pm25");
    const queryFn = vi.fn().mockRejectedValue(new Error("timeout"));
    const reply = await handleQueryDevice(QUERY_BASE, db, queryFn);
    expect(reply).toMatch(/failed to query/i);
    expect(reply).toMatch(/timeout/);
  });
});

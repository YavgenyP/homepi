import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import type OpenAI from "openai";
import { openDb } from "../../storage/db.js";
import { handleControlDevice, handleQueryDevice, handleListDevices, handleSyncHADevices, handleBrowseHADevices, handleAddHADevices, handleAliasDevice, cosineSimilarity } from "./device.handler.js";
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
  device_alias: null,
  ha_entity_ids: null,
  ha_domain_filter: null,
  confidence: 0.95,
  clarifying_question: null,
};

const DEVICE_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

// Mock openai that returns a fixed embedding vector (unit vector for simplicity)
function mockOpenAI(embeddingVec?: number[]): OpenAI {
  const vec = embeddingVec ?? Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0));
  return {
    embeddings: {
      create: vi.fn().mockResolvedValue({ data: [{ embedding: vec }] }),
    },
  } as unknown as OpenAI;
}

let db: Database.Database;

function seedDevice(name: string, uuid: string): void {
  db.prepare(
    "INSERT INTO smart_devices (name, smartthings_device_id) VALUES (?, ?)"
  ).run(name, uuid);
}

function seedHADevice(name: string, entityId: string, aliases = "", embedding = ""): void {
  db.prepare("INSERT INTO ha_devices (name, entity_id, aliases, embedding) VALUES (?, ?, ?, ?)").run(name, entityId, aliases, embedding);
}

beforeEach(() => {
  db = openDb(":memory:");
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [1, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });
});

describe("handleControlDevice", () => {
  it("returns guidance when intent.device is null", async () => {
    const fn = vi.fn();
    const reply = await handleControlDevice({ ...BASE, device: null }, db, mockOpenAI(), fn, undefined);
    expect(reply).toMatch(/which device/i);
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns error when device name is not found in either table", async () => {
    const fn = vi.fn();
    const reply = await handleControlDevice(BASE, db, mockOpenAI(), fn, undefined);
    expect(reply).toMatch(/don't know a device/i);
    expect(fn).not.toHaveBeenCalled();
  });

  it("calls controlDeviceFn with correct UUID and command for 'on'", async () => {
    seedDevice("tv", DEVICE_UUID);
    const fn = vi.fn().mockResolvedValue(undefined);
    const reply = await handleControlDevice(BASE, db, mockOpenAI(), fn, undefined);
    expect(fn).toHaveBeenCalledWith(DEVICE_UUID, "on", undefined);
    expect(reply).toMatch(/turned on tv/i);
  });

  it("calls controlDeviceFn with 'off' command", async () => {
    seedDevice("tv", DEVICE_UUID);
    const fn = vi.fn().mockResolvedValue(undefined);
    await handleControlDevice({ ...BASE, device: { name: "tv", command: "off" } }, db, mockOpenAI(), fn, undefined);
    expect(fn).toHaveBeenCalledWith(DEVICE_UUID, "off", undefined);
  });

  it("performs case-insensitive device name lookup", async () => {
    seedDevice("TV", DEVICE_UUID);
    const fn = vi.fn().mockResolvedValue(undefined);
    const reply = await handleControlDevice(
      { ...BASE, device: { name: "tv", command: "on" } },
      db,
      mockOpenAI(),
      fn,
      undefined
    );
    expect(fn).toHaveBeenCalledWith(DEVICE_UUID, "on", undefined);
    expect(reply).not.toMatch(/don't know/i);
  });

  it("returns error message when controlDeviceFn throws (no crash)", async () => {
    seedDevice("tv", DEVICE_UUID);
    const fn = vi.fn().mockRejectedValue(new Error("SmartThings timeout"));
    const reply = await handleControlDevice(BASE, db, mockOpenAI(), fn, undefined);
    expect(reply).toMatch(/failed to control/i);
    expect(reply).toMatch(/SmartThings timeout/);
  });

  it("calls controlDeviceFn with volumeUp and no value", async () => {
    seedDevice("tv", DEVICE_UUID);
    const fn = vi.fn().mockResolvedValue(undefined);
    const reply = await handleControlDevice(
      { ...BASE, device: { name: "tv", command: "volumeUp" } },
      db,
      mockOpenAI(),
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
      mockOpenAI(),
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
      mockOpenAI(),
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
      mockOpenAI(),
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
      mockOpenAI(),
      fn,
      undefined
    );
    expect(fn).toHaveBeenCalledWith(DEVICE_UUID, "startActivity", "Netflix");
    expect(reply).toMatch(/launched Netflix on tv/i);
  });

  it("calls controlHAFn for HA device with correct entity_id (exact name)", async () => {
    seedHADevice("ac", "climate.tadiran_ac");
    const haFn = vi.fn().mockResolvedValue(undefined);
    const reply = await handleControlDevice(
      { ...BASE, device: { name: "ac", command: "on" } },
      db,
      mockOpenAI(),
      undefined,
      haFn
    );
    expect(haFn).toHaveBeenCalledWith("climate.tadiran_ac", "on", undefined);
    expect(reply).toMatch(/turned on ac/i);
  });

  it("calls controlHAFn for HA device found by alias", async () => {
    seedHADevice("xiaomi cpa4 fan", "fan.xiaomi_cpa4", "purifier,air purifier");
    const haFn = vi.fn().mockResolvedValue(undefined);
    const reply = await handleControlDevice(
      { ...BASE, device: { name: "purifier", command: "on" } },
      db,
      mockOpenAI(),
      undefined,
      haFn
    );
    expect(haFn).toHaveBeenCalledWith("fan.xiaomi_cpa4", "on", undefined);
    expect(reply).toMatch(/turned on purifier/i);
  });

  it("calls controlHAFn for HA device found by embedding similarity", async () => {
    // Store a device with a known embedding vector [1, 0, 0, ...]
    const deviceVec = Array(1536).fill(0);
    deviceVec[0] = 1;
    seedHADevice("xiaomi purifier", "fan.xiaomi", "", JSON.stringify(deviceVec));

    // Query vector close to deviceVec (cosine ~1)
    const queryVec = Array(1536).fill(0);
    queryVec[0] = 0.99;
    queryVec[1] = 0.1;

    const haFn = vi.fn().mockResolvedValue(undefined);
    const reply = await handleControlDevice(
      { ...BASE, device: { name: "air thing", command: "on" } },
      db,
      mockOpenAI(queryVec),
      undefined,
      haFn
    );
    expect(haFn).toHaveBeenCalledWith("fan.xiaomi", "on", undefined);
    expect(reply).toMatch(/turned on air thing/i);
  });

  it("returns not-found when embedding similarity is below threshold", async () => {
    // Orthogonal vectors → similarity = 0
    const deviceVec = Array(1536).fill(0);
    deviceVec[0] = 1;
    seedHADevice("xiaomi purifier", "fan.xiaomi", "", JSON.stringify(deviceVec));

    const queryVec = Array(1536).fill(0);
    queryVec[1] = 1; // orthogonal

    const haFn = vi.fn().mockResolvedValue(undefined);
    const reply = await handleControlDevice(
      { ...BASE, device: { name: "dishwasher", command: "on" } },
      db,
      mockOpenAI(queryVec),
      undefined,
      haFn
    );
    expect(reply).toMatch(/don't know a device/i);
    expect(haFn).not.toHaveBeenCalled();
  });

  it("returns error when HA device registered but no controlHAFn provided", async () => {
    seedHADevice("ac", "climate.tadiran_ac");
    const reply = await handleControlDevice(
      { ...BASE, device: { name: "ac", command: "on" } },
      db,
      mockOpenAI(),
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
      mockOpenAI(),
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
      mockOpenAI(),
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
      mockOpenAI(),
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
    device_alias: null,
    ha_entity_ids: null,
    ha_domain_filter: null,
    confidence: 0.95,
    clarifying_question: null,
  };

  it("returns guidance when intent.device is null", async () => {
    const reply = await handleQueryDevice({ ...QUERY_BASE, device: null }, db, mockOpenAI(), undefined);
    expect(reply).toMatch(/which device/i);
  });

  it("returns error when device not registered in ha_devices", async () => {
    const reply = await handleQueryDevice(QUERY_BASE, db, mockOpenAI(), undefined);
    expect(reply).toMatch(/don't know a device/i);
  });

  it("returns not configured when queryHAFn not provided", async () => {
    seedHADevice("air quality", "sensor.pm25");
    const reply = await handleQueryDevice(QUERY_BASE, db, mockOpenAI(), undefined);
    expect(reply).toMatch(/not configured/i);
  });

  it("returns formatted state with unit for known sensor", async () => {
    seedHADevice("air quality", "sensor.pm25");
    const queryFn = vi.fn().mockResolvedValue({
      state: "12",
      attributes: { unit_of_measurement: "µg/m³" },
    });
    const reply = await handleQueryDevice(QUERY_BASE, db, mockOpenAI(), queryFn);
    expect(queryFn).toHaveBeenCalledWith("sensor.pm25");
    expect(reply).toBe("air quality: 12 µg/m³");
  });

  it("returns formatted state without unit when attribute is absent", async () => {
    seedHADevice("filter", "sensor.filter_life");
    const queryFn = vi.fn().mockResolvedValue({ state: "73", attributes: {} });
    const reply = await handleQueryDevice(
      { ...QUERY_BASE, device: { name: "filter", command: "on" } },
      db,
      mockOpenAI(),
      queryFn
    );
    expect(reply).toBe("filter: 73");
  });

  it("returns error message when queryHAFn throws", async () => {
    seedHADevice("air quality", "sensor.pm25");
    const queryFn = vi.fn().mockRejectedValue(new Error("timeout"));
    const reply = await handleQueryDevice(QUERY_BASE, db, mockOpenAI(), queryFn);
    expect(reply).toMatch(/failed to query/i);
    expect(reply).toMatch(/timeout/);
  });

  it("resolves device by alias when exact name does not match", async () => {
    seedHADevice("pm2.5 sensor", "sensor.pm25", "air quality,air");
    const queryFn = vi.fn().mockResolvedValue({ state: "8", attributes: { unit_of_measurement: "µg/m³" } });
    const reply = await handleQueryDevice(QUERY_BASE, db, mockOpenAI(), queryFn);
    expect(queryFn).toHaveBeenCalledWith("sensor.pm25");
    expect(reply).toContain("8");
  });

  it("returns mode + temperatures for climate entities", async () => {
    seedHADevice("ac", "climate.tadiran_ac");
    const queryFn = vi.fn().mockResolvedValue({
      state: "heat",
      attributes: { current_temperature: 22.5, temperature: 24, fan_mode: "auto" },
    });
    const reply = await handleQueryDevice(
      { ...QUERY_BASE, device: { name: "ac", command: "on" } },
      db,
      mockOpenAI(),
      queryFn
    );
    expect(reply).toBe("ac: heat, current 22.5°, target 24°, fan: auto");
  });
});

describe("handleListDevices", () => {
  it("returns no-devices message when both tables are empty", () => {
    const reply = handleListDevices(db);
    expect(reply).toMatch(/no devices/i);
  });

  it("lists SmartThings devices", () => {
    seedDevice("tv", DEVICE_UUID);
    const reply = handleListDevices(db);
    expect(reply).toMatch(/SmartThings/);
    expect(reply).toContain("tv");
    expect(reply).toContain(DEVICE_UUID);
  });

  it("lists HA devices with aliases when present", () => {
    seedHADevice("purifier", "fan.xiaomi_purifier", "air purifier,fan");
    const reply = handleListDevices(db);
    expect(reply).toMatch(/Home Assistant/);
    expect(reply).toContain("purifier");
    expect(reply).toContain("air purifier");
    expect(reply).toContain("fan.xiaomi_purifier");
  });

  it("lists both tables when both have entries", () => {
    seedDevice("tv", DEVICE_UUID);
    seedHADevice("ac", "climate.ac");
    const reply = handleListDevices(db);
    expect(reply).toMatch(/SmartThings/);
    expect(reply).toMatch(/Home Assistant/);
  });
});

describe("handleSyncHADevices", () => {
  it("returns not configured when syncHAFn not provided", async () => {
    const reply = await handleSyncHADevices(db, mockOpenAI(), undefined);
    expect(reply).toMatch(/not configured/i);
  });

  it("inserts new entities using friendly_name and computes embeddings", async () => {
    const openai = mockOpenAI();
    const syncFn = vi.fn().mockResolvedValue([
      { entity_id: "fan.purifier", friendly_name: "Xiaomi Purifier" },
      { entity_id: "sensor.pm25", friendly_name: "PM2.5" },
    ]);
    const reply = await handleSyncHADevices(db, openai, syncFn);
    expect(reply).toMatch(/added 2/i);
    expect(reply).toContain("xiaomi purifier");
    expect(reply).toContain("pm2.5");
    const rows = db.prepare("SELECT name, entity_id, embedding FROM ha_devices ORDER BY name").all() as Array<{ name: string; entity_id: string; embedding: string }>;
    expect(rows).toHaveLength(2);
    // embeddings should be stored
    expect(rows[0].embedding.length).toBeGreaterThan(0);
  });

  it("falls back to entity_id slug when no friendly_name", async () => {
    const syncFn = vi.fn().mockResolvedValue([
      { entity_id: "switch.child_lock", friendly_name: undefined },
    ]);
    await handleSyncHADevices(db, mockOpenAI(), syncFn);
    const row = db.prepare("SELECT name FROM ha_devices WHERE entity_id = ?").get("switch.child_lock") as { name: string };
    expect(row.name).toBe("child lock");
  });

  it("skips entities whose name already exists in ha_devices", async () => {
    seedHADevice("xiaomi purifier", "fan.old_purifier");
    const syncFn = vi.fn().mockResolvedValue([
      { entity_id: "fan.purifier", friendly_name: "Xiaomi Purifier" },
      { entity_id: "sensor.pm25", friendly_name: "PM2.5" },
    ]);
    const reply = await handleSyncHADevices(db, mockOpenAI(), syncFn);
    expect(reply).toMatch(/added 1/i);
    expect(reply).toMatch(/1 already registered/i);
  });

  it("returns all-skipped message when nothing new", async () => {
    seedHADevice("xiaomi purifier", "fan.purifier");
    const syncFn = vi.fn().mockResolvedValue([
      { entity_id: "fan.purifier", friendly_name: "Xiaomi Purifier" },
    ]);
    const reply = await handleSyncHADevices(db, mockOpenAI(), syncFn);
    expect(reply).toMatch(/already registered/i);
    expect(reply).not.toMatch(/added/i);
  });

  it("returns error message when syncHAFn throws", async () => {
    const syncFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const reply = await handleSyncHADevices(db, mockOpenAI(), syncFn);
    expect(reply).toMatch(/failed to reach/i);
    expect(reply).toMatch(/ECONNREFUSED/);
  });
});

describe("handleAliasDevice", () => {
  const ALIAS_BASE: Intent = {
    ...BASE,
    intent: "alias_device",
    device: { name: "xiaomi cpa4 fan", command: "on" },
    device_alias: "purifier",
  };

  it("returns error when device.name or device_alias is missing", async () => {
    const reply = await handleAliasDevice({ ...ALIAS_BASE, device: null }, db, mockOpenAI());
    expect(reply).toMatch(/please specify/i);
  });

  it("returns error when device not found in ha_devices", async () => {
    const reply = await handleAliasDevice(ALIAS_BASE, db, mockOpenAI());
    expect(reply).toMatch(/don't know a device/i);
  });

  it("adds a new alias and recomputes embedding", async () => {
    seedHADevice("xiaomi cpa4 fan", "fan.xiaomi_cpa4");
    const openai = mockOpenAI();
    const reply = await handleAliasDevice(ALIAS_BASE, db, openai);
    expect(reply).toMatch(/added "purifier"/i);
    const row = db.prepare("SELECT aliases, embedding FROM ha_devices WHERE name = 'xiaomi cpa4 fan'").get() as { aliases: string; embedding: string };
    expect(row.aliases).toContain("purifier");
    expect(row.embedding.length).toBeGreaterThan(0);
  });

  it("returns already-exists message when alias is already set", async () => {
    seedHADevice("xiaomi cpa4 fan", "fan.xiaomi_cpa4", "purifier");
    const reply = await handleAliasDevice(ALIAS_BASE, db, mockOpenAI());
    expect(reply).toMatch(/already an alias/i);
  });

  it("deduplicates aliases case-insensitively", async () => {
    seedHADevice("xiaomi cpa4 fan", "fan.xiaomi_cpa4", "Purifier");
    const reply = await handleAliasDevice({ ...ALIAS_BASE, device_alias: "purifier" }, db, mockOpenAI());
    expect(reply).toMatch(/already an alias/i);
  });

  it("appends to existing aliases", async () => {
    seedHADevice("xiaomi cpa4 fan", "fan.xiaomi_cpa4", "air purifier");
    await handleAliasDevice(ALIAS_BASE, db, mockOpenAI());
    const row = db.prepare("SELECT aliases FROM ha_devices WHERE name = 'xiaomi cpa4 fan'").get() as { aliases: string };
    expect(row.aliases).toContain("air purifier");
    expect(row.aliases).toContain("purifier");
  });
});

// ── handleBrowseHADevices ─────────────────────────────────────────────────────

const BROWSE_BASE: Intent = {
  ...BASE,
  intent: "browse_ha_devices",
  device: null,
  ha_domain_filter: null,
};

describe("handleBrowseHADevices", () => {
  const syncFn = vi.fn();

  beforeEach(() => {
    syncFn.mockReset();
  });

  it("returns not-configured when syncHAFn is absent", async () => {
    const reply = await handleBrowseHADevices(BROWSE_BASE, db, undefined);
    expect(reply).toMatch(/not configured/i);
  });

  it("returns all-registered message when nothing is unregistered", async () => {
    seedHADevice("ac", "climate.tadiran_ac");
    syncFn.mockResolvedValue([{ entity_id: "climate.tadiran_ac", friendly_name: "AC" }]);
    const reply = await handleBrowseHADevices(BROWSE_BASE, db, syncFn);
    expect(reply).toMatch(/already registered/i);
  });

  it("shows grouped unregistered entities with sequential numbers and entity IDs", async () => {
    syncFn.mockResolvedValue([
      { entity_id: "climate.ac", friendly_name: "Tadiran AC" },
      { entity_id: "fan.purifier", friendly_name: "Xiaomi Purifier" },
    ]);
    const reply = await handleBrowseHADevices(BROWSE_BASE, db, syncFn);
    expect(reply).toContain("climate");
    expect(reply).toContain("fan");
    expect(reply).toContain("Tadiran AC");
    expect(reply).toContain("[climate.ac]");
    expect(reply).toContain("Xiaomi Purifier");
    expect(reply).toContain("[fan.purifier]");
    expect(reply).toContain("1.");
    expect(reply).toContain("2.");
  });

  it("skips already-registered entity_ids", async () => {
    seedHADevice("ac", "climate.ac");
    syncFn.mockResolvedValue([
      { entity_id: "climate.ac", friendly_name: "Tadiran AC" },
      { entity_id: "fan.purifier", friendly_name: "Xiaomi Purifier" },
    ]);
    const reply = await handleBrowseHADevices(BROWSE_BASE, db, syncFn);
    expect(reply).not.toContain("climate.ac");
    expect(reply).toContain("fan.purifier");
  });

  it("skips SKIP_DOMAINS entries", async () => {
    syncFn.mockResolvedValue([
      { entity_id: "automation.morning_routine", friendly_name: "Morning Routine" },
      { entity_id: "fan.purifier", friendly_name: "Purifier" },
    ]);
    const reply = await handleBrowseHADevices(BROWSE_BASE, db, syncFn);
    expect(reply).not.toContain("automation");
    expect(reply).toContain("fan");
    expect(reply).toContain("Purifier");
  });

  it("caps each domain at 8 and shows overflow hint", async () => {
    const sensors = Array.from({ length: 10 }, (_, i) => ({
      entity_id: `sensor.s${i}`,
      friendly_name: `Sensor ${i}`,
    }));
    syncFn.mockResolvedValue(sensors);
    const reply = await handleBrowseHADevices(BROWSE_BASE, db, syncFn);
    // Should show 8 entries + overflow hint
    expect(reply).toContain("2 more");
    expect(reply).toContain("show sensor devices");
  });

  it("shows full domain without cap when ha_domain_filter is set", async () => {
    const sensors = Array.from({ length: 10 }, (_, i) => ({
      entity_id: `sensor.s${i}`,
      friendly_name: `Sensor ${i}`,
    }));
    syncFn.mockResolvedValue(sensors);
    const reply = await handleBrowseHADevices(
      { ...BROWSE_BASE, ha_domain_filter: "sensor" },
      db,
      syncFn
    );
    // All 10 should appear, no "more" hint
    expect(reply).not.toContain("more");
    expect(reply).toContain("Sensor 9");
  });

  it("filters by ha_domain_filter (other domains excluded)", async () => {
    syncFn.mockResolvedValue([
      { entity_id: "climate.ac", friendly_name: "AC" },
      { entity_id: "fan.purifier", friendly_name: "Purifier" },
    ]);
    const reply = await handleBrowseHADevices(
      { ...BROWSE_BASE, ha_domain_filter: "fan" },
      db,
      syncFn
    );
    expect(reply).toContain("fan.purifier");
    expect(reply).not.toContain("climate.ac");
  });

  it("returns error when syncHAFn throws", async () => {
    syncFn.mockRejectedValue(new Error("ECONNREFUSED"));
    const reply = await handleBrowseHADevices(BROWSE_BASE, db, syncFn);
    expect(reply).toMatch(/failed to reach/i);
    expect(reply).toContain("ECONNREFUSED");
  });

  it("includes footer hint to register", async () => {
    syncFn.mockResolvedValue([{ entity_id: "fan.purifier", friendly_name: "Purifier" }]);
    const reply = await handleBrowseHADevices(BROWSE_BASE, db, syncFn);
    expect(reply).toMatch(/add|connect/i);
  });
});

// ── handleAddHADevices ────────────────────────────────────────────────────────

const ADD_BASE: Intent = {
  ...BASE,
  intent: "add_ha_devices",
  device: null,
  ha_entity_ids: ["climate.ac", "fan.purifier"],
};

describe("handleAddHADevices", () => {
  const syncFn = vi.fn();

  beforeEach(() => {
    syncFn.mockReset();
  });

  it("returns not-configured when syncHAFn is absent", async () => {
    const reply = await handleAddHADevices(ADD_BASE, db, mockOpenAI(), undefined);
    expect(reply).toMatch(/not configured/i);
  });

  it("returns error when ha_entity_ids is null", async () => {
    const reply = await handleAddHADevices({ ...ADD_BASE, ha_entity_ids: null }, db, mockOpenAI(), syncFn);
    expect(reply).toMatch(/no entity/i);
  });

  it("returns error when ha_entity_ids is empty array", async () => {
    const reply = await handleAddHADevices({ ...ADD_BASE, ha_entity_ids: [] }, db, mockOpenAI(), syncFn);
    expect(reply).toMatch(/no entity/i);
  });

  it("registers entities and replies with summary", async () => {
    syncFn.mockResolvedValue([
      { entity_id: "climate.ac", friendly_name: "Tadiran AC" },
      { entity_id: "fan.purifier", friendly_name: "Xiaomi Purifier" },
    ]);
    const reply = await handleAddHADevices(ADD_BASE, db, mockOpenAI(), syncFn);
    expect(reply).toMatch(/registered 2/i);
    expect(reply).toContain("tadiran ac");
    expect(reply).toContain("climate.ac");
    expect(reply).toContain("xiaomi purifier");
    expect(reply).toContain("fan.purifier");
    const rows = db.prepare("SELECT entity_id FROM ha_devices").all() as Array<{ entity_id: string }>;
    expect(rows.map((r) => r.entity_id)).toEqual(expect.arrayContaining(["climate.ac", "fan.purifier"]));
  });

  it("skips and reports already-registered entity_ids", async () => {
    seedHADevice("ac", "climate.ac");
    syncFn.mockResolvedValue([
      { entity_id: "climate.ac", friendly_name: "Tadiran AC" },
      { entity_id: "fan.purifier", friendly_name: "Xiaomi Purifier" },
    ]);
    const reply = await handleAddHADevices(ADD_BASE, db, mockOpenAI(), syncFn);
    expect(reply).toMatch(/registered 1/i);
    expect(reply).toMatch(/already registered/i);
    expect(reply).toContain("climate.ac");
  });

  it("reports entity_ids not found in HA", async () => {
    syncFn.mockResolvedValue([
      { entity_id: "fan.purifier", friendly_name: "Xiaomi Purifier" },
    ]);
    const reply = await handleAddHADevices(ADD_BASE, db, mockOpenAI(), syncFn);
    expect(reply).toMatch(/not found in ha/i);
    expect(reply).toContain("climate.ac");
    expect(reply).toContain("fan.purifier");
  });

  it("returns error when syncHAFn throws", async () => {
    syncFn.mockRejectedValue(new Error("ECONNREFUSED"));
    const reply = await handleAddHADevices(ADD_BASE, db, mockOpenAI(), syncFn);
    expect(reply).toMatch(/failed to reach/i);
  });

  it("derives name from entity_id slug when no friendly_name", async () => {
    syncFn.mockResolvedValue([
      { entity_id: "climate.ac", friendly_name: undefined },
    ]);
    await handleAddHADevices({ ...ADD_BASE, ha_entity_ids: ["climate.ac"] }, db, mockOpenAI(), syncFn);
    const row = db.prepare("SELECT name FROM ha_devices WHERE entity_id = 'climate.ac'").get() as { name: string };
    expect(row.name).toBe("ac");
  });
});

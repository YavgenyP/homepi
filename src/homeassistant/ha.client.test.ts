import { describe, it, expect, vi } from "vitest";
import { sendHACommand, getHAState, getHAAllStates } from "./ha.client.js";

const HA_URL = "http://192.168.1.100:8123";
const TOKEN = "test-token";
const ENTITY_ID = "media_player.living_room";

function mockFetch(status: number, ok = true) {
  return vi.fn().mockResolvedValue({ ok, status, statusText: ok ? "OK" : "Unauthorized" });
}

describe("sendHACommand", () => {
  it("POSTs to {domain}/turn_on for 'on' command", async () => {
    const fetch = mockFetch(200);
    await sendHACommand(ENTITY_ID, "on", undefined, HA_URL, TOKEN, fetch);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe(`${HA_URL}/api/services/media_player/turn_on`);
    expect(JSON.parse(opts.body)).toEqual({ entity_id: ENTITY_ID });
    expect(opts.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("POSTs to {domain}/turn_off for 'off' command", async () => {
    const fetch = mockFetch(200);
    await sendHACommand(ENTITY_ID, "off", undefined, HA_URL, TOKEN, fetch);
    const [url] = fetch.mock.calls[0];
    expect(url).toBe(`${HA_URL}/api/services/media_player/turn_off`);
  });

  it("POSTs to {domain}/volume_set with volume_level scaled 0–1 for setVolume", async () => {
    const fetch = mockFetch(200);
    await sendHACommand(ENTITY_ID, "setVolume", 30, HA_URL, TOKEN, fetch);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe(`${HA_URL}/api/services/media_player/volume_set`);
    const body = JSON.parse(opts.body);
    expect(body.entity_id).toBe(ENTITY_ID);
    expect(body.volume_level).toBeCloseTo(0.3);
  });

  it("POSTs to {domain}/volume_mute with is_volume_muted true for mute", async () => {
    const fetch = mockFetch(200);
    await sendHACommand(ENTITY_ID, "mute", undefined, HA_URL, TOKEN, fetch);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe(`${HA_URL}/api/services/media_player/volume_mute`);
    const body = JSON.parse(opts.body);
    expect(body.is_volume_muted).toBe(true);
  });

  it("POSTs to {domain}/select_source with source for setInputSource", async () => {
    const fetch = mockFetch(200);
    await sendHACommand(ENTITY_ID, "setInputSource", "HDMI2", HA_URL, TOKEN, fetch);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe(`${HA_URL}/api/services/media_player/select_source`);
    const body = JSON.parse(opts.body);
    expect(body.source).toBe("HDMI2");
  });

  it("sendKey: POSTs to remote/send_command on derived remote entity", async () => {
    const fetch = mockFetch(200);
    await sendHACommand(ENTITY_ID, "sendKey", "HOME", HA_URL, TOKEN, fetch);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe(`${HA_URL}/api/services/remote/send_command`);
    const body = JSON.parse(opts.body);
    expect(body.entity_id).toBe("remote.living_room");
    expect(body.command).toBe("HOME");
  });

  it("setTvChannel: POSTs digit keycodes + ENTER to remote entity", async () => {
    const fetch = mockFetch(200);
    await sendHACommand(ENTITY_ID, "setTvChannel", "13", HA_URL, TOKEN, fetch);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe(`${HA_URL}/api/services/remote/send_command`);
    const body = JSON.parse(opts.body);
    expect(body.entity_id).toBe("remote.living_room");
    expect(body.command).toEqual([1, 3]);
  });

  it("on: routes to remote/turn_on using remoteEntityId when provided", async () => {
    const fetch = mockFetch(200);
    await sendHACommand(ENTITY_ID, "on", undefined, HA_URL, TOKEN, fetch, "remote.living_room");
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe(`${HA_URL}/api/services/remote/turn_on`);
    expect(JSON.parse(opts.body)).toEqual({ entity_id: "remote.living_room" });
  });

  it("off: routes to remote/turn_off using remoteEntityId when provided", async () => {
    const fetch = mockFetch(200);
    await sendHACommand(ENTITY_ID, "off", undefined, HA_URL, TOKEN, fetch, "remote.living_room");
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe(`${HA_URL}/api/services/remote/turn_off`);
    expect(JSON.parse(opts.body)).toEqual({ entity_id: "remote.living_room" });
  });

  it("sendKey: uses explicit remoteEntityId when provided instead of derived", async () => {
    const fetch = mockFetch(200);
    await sendHACommand(ENTITY_ID, "sendKey", "HOME", HA_URL, TOKEN, fetch, "remote.explicit_remote");
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe(`${HA_URL}/api/services/remote/send_command`);
    const body = JSON.parse(opts.body);
    expect(body.entity_id).toBe("remote.explicit_remote");
    expect(body.command).toBe("HOME");
  });

  it("throws on non-ok response (e.g. 401)", async () => {
    const fetch = mockFetch(401, false);
    await expect(
      sendHACommand(ENTITY_ID, "on", undefined, HA_URL, TOKEN, fetch)
    ).rejects.toThrow("Home Assistant API error: 401");
  });

  it("POSTs to {domain}/set_preset_mode with preset_mode for setMode", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await sendHACommand("fan.xiaomi_purifier", "setMode", "Auto", HA_URL, TOKEN, fetch);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe(`${HA_URL}/api/services/fan/set_preset_mode`);
    const body = JSON.parse(opts.body);
    expect(body.entity_id).toBe("fan.xiaomi_purifier");
    expect(body.preset_mode).toBe("Auto");
  });

  it("POSTs to climate/set_temperature with temperature for setTemperature", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await sendHACommand("climate.tadiran_ac", "setTemperature", 22, HA_URL, TOKEN, fetch);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe(`${HA_URL}/api/services/climate/set_temperature`);
    const body = JSON.parse(opts.body);
    expect(body.entity_id).toBe("climate.tadiran_ac");
    expect(body.temperature).toBe(22);
  });

  it("POSTs to climate/set_hvac_mode with hvac_mode for setHvacMode", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await sendHACommand("climate.tadiran_ac", "setHvacMode", "cool", HA_URL, TOKEN, fetch);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe(`${HA_URL}/api/services/climate/set_hvac_mode`);
    const body = JSON.parse(opts.body);
    expect(body.entity_id).toBe("climate.tadiran_ac");
    expect(body.hvac_mode).toBe("cool");
  });

  it("POSTs to climate/set_fan_mode with fan_mode for setFanMode", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await sendHACommand("climate.tadiran_ac", "setFanMode", "high", HA_URL, TOKEN, fetch);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe(`${HA_URL}/api/services/climate/set_fan_mode`);
    const body = JSON.parse(opts.body);
    expect(body.entity_id).toBe("climate.tadiran_ac");
    expect(body.fan_mode).toBe("high");
  });
});

describe("getHAState", () => {
  it("GETs /api/states/{entityId} and returns state + attributes", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        state: "12",
        attributes: { unit_of_measurement: "µg/m³", friendly_name: "PM2.5" },
      }),
    });
    const result = await getHAState("sensor.pm25", HA_URL, TOKEN, fetch);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe(`${HA_URL}/api/states/sensor.pm25`);
    expect(opts.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(result.state).toBe("12");
    expect(result.attributes.unit_of_measurement).toBe("µg/m³");
  });

  it("throws on non-ok response (e.g. 401)", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });
    await expect(
      getHAState("sensor.pm25", HA_URL, TOKEN, fetch)
    ).rejects.toThrow("Home Assistant API error: 401");
  });
});

describe("getHAAllStates", () => {
  it("GETs /api/states and returns entity_id + friendly_name for each entity", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([
        { entity_id: "fan.purifier", attributes: { friendly_name: "Xiaomi Purifier" } },
        { entity_id: "sensor.pm25", attributes: { friendly_name: "PM2.5", unit_of_measurement: "µg/m³" } },
        { entity_id: "switch.child_lock", attributes: {} },
      ]),
    });
    const result = await getHAAllStates(HA_URL, TOKEN, fetch);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe(`${HA_URL}/api/states`);
    expect(opts.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ entity_id: "fan.purifier", friendly_name: "Xiaomi Purifier" });
    expect(result[2]).toEqual({ entity_id: "switch.child_lock", friendly_name: undefined });
  });

  it("throws on non-ok response", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });
    await expect(getHAAllStates(HA_URL, TOKEN, fetch)).rejects.toThrow("Home Assistant API error: 401");
  });
});

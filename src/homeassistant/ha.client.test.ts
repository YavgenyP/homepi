import { describe, it, expect, vi } from "vitest";
import { sendHACommand } from "./ha.client.js";

const HA_URL = "http://192.168.1.100:8123";
const TOKEN = "test-token";
const ENTITY_ID = "media_player.living_room";

function mockFetch(status: number, ok = true) {
  return vi.fn().mockResolvedValue({ ok, status, statusText: ok ? "OK" : "Unauthorized" });
}

describe("sendHACommand", () => {
  it("POSTs to homeassistant/turn_on for 'on' command", async () => {
    const fetch = mockFetch(200);
    await sendHACommand(ENTITY_ID, "on", undefined, HA_URL, TOKEN, fetch);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe(`${HA_URL}/api/services/homeassistant/turn_on`);
    expect(JSON.parse(opts.body)).toEqual({ entity_id: ENTITY_ID });
    expect(opts.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("POSTs to homeassistant/turn_off for 'off' command", async () => {
    const fetch = mockFetch(200);
    await sendHACommand(ENTITY_ID, "off", undefined, HA_URL, TOKEN, fetch);
    const [url] = fetch.mock.calls[0];
    expect(url).toBe(`${HA_URL}/api/services/homeassistant/turn_off`);
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

  it("throws on non-ok response (e.g. 401)", async () => {
    const fetch = mockFetch(401, false);
    await expect(
      sendHACommand(ENTITY_ID, "on", undefined, HA_URL, TOKEN, fetch)
    ).rejects.toThrow("Home Assistant API error: 401");
  });
});

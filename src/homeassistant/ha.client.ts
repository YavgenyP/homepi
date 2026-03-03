import type { DeviceCommand } from "../samsung/smartthings.client.js";

export type HACommandFn = (
  entityId: string,
  command: DeviceCommand,
  value?: string | number
) => Promise<void>;

const HA_COMMAND_MAP: Record<
  DeviceCommand,
  {
    service: string;
    domainOverride?: string;
    buildData?: (value: string | number | undefined) => Record<string, unknown>;
  }
> = {
  on:             { service: "turn_on",     domainOverride: "homeassistant" },
  off:            { service: "turn_off",    domainOverride: "homeassistant" },
  volumeUp:       { service: "volume_up" },
  volumeDown:     { service: "volume_down" },
  setVolume:      { service: "volume_set",    buildData: (v) => ({ volume_level: Number(v) / 100 }) },
  mute:           { service: "volume_mute",   buildData: () => ({ is_volume_muted: true }) },
  unmute:         { service: "volume_mute",   buildData: () => ({ is_volume_muted: false }) },
  setTvChannel:   { service: "play_media",    buildData: (v) => ({ media_content_id: String(v), media_content_type: "channel" }) },
  setInputSource: { service: "select_source", buildData: (v) => ({ source: String(v) }) },
  play:           { service: "media_play" },
  pause:          { service: "media_pause" },
  stop:           { service: "media_stop" },
  startActivity:  { service: "select_source", buildData: (v) => ({ source: String(v) }) },
};

export async function sendHACommand(
  entityId: string,
  command: DeviceCommand,
  value: string | number | undefined,
  haUrl: string,
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const { service, domainOverride, buildData } = HA_COMMAND_MAP[command];
  const domain = domainOverride ?? entityId.split(".")[0];

  const body = JSON.stringify({
    entity_id: entityId,
    ...(buildData ? buildData(value) : {}),
  });

  const url = `${haUrl}/api/services/${domain}/${service}`;
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Home Assistant API error: ${response.status} ${response.statusText}`);
  }
}

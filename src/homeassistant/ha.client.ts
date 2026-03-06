import type { DeviceCommand } from "../samsung/smartthings.client.js";

export type HACommandFn = (
  entityId: string,
  command: DeviceCommand,
  value?: string | number
) => Promise<void>;

export type HAQueryFn = (
  entityId: string
) => Promise<{ state: string; attributes: Record<string, unknown> }>;

export type HAEntitySummary = { entity_id: string; friendly_name?: string };
export type HASyncFn = () => Promise<HAEntitySummary[]>;

// For androidtv_remote: sendKey and setTvChannel must target the remote.* entity
// (derived from media_player.*) via remote/send_command.
function toRemoteEntityId(entityId: string): string {
  return entityId.replace(/^media_player\./, "remote.");
}

const HA_COMMAND_MAP: Record<
  DeviceCommand,
  {
    service: string;
    domainOverride?: string;
    entityIdTransform?: (id: string) => string;
    buildData?: (value: string | number | undefined) => Record<string, unknown>;
  }
> = {
  on:             { service: "turn_on" },
  off:            { service: "turn_off" },
  volumeUp:       { service: "volume_up" },
  volumeDown:     { service: "volume_down" },
  setVolume:      { service: "volume_set",    buildData: (v) => ({ volume_level: Number(v) / 100 }) },
  mute:           { service: "volume_mute",   buildData: () => ({ is_volume_muted: true }) },
  unmute:         { service: "volume_mute",   buildData: () => ({ is_volume_muted: false }) },
  setTvChannel:   {
    service: "send_command",
    domainOverride: "remote",
    entityIdTransform: toRemoteEntityId,
    buildData: (v) => ({ command: [...String(v)].map((d) => `KEYCODE_${d}`).concat("KEYCODE_ENTER") }),
  },
  setInputSource: { service: "select_source", buildData: (v) => ({ source: String(v) }) },
  play:           { service: "media_play" },
  pause:          { service: "media_pause" },
  stop:           { service: "media_stop" },
  startActivity:  { service: "select_source", buildData: (v) => ({ source: String(v) }) },
  setMode:        { service: "set_preset_mode",  buildData: (v) => ({ preset_mode: String(v) }) },
  setTemperature: { service: "set_temperature",  buildData: (v) => ({ temperature: Number(v) }) },
  setHvacMode:    { service: "set_hvac_mode",    buildData: (v) => ({ hvac_mode: String(v) }) },
  setFanMode:     { service: "set_fan_mode",     buildData: (v) => ({ fan_mode: String(v) }) },
  launchApp:      { service: "play_media",       buildData: (v) => ({ media_content_id: String(v), media_content_type: "app" }) },
  sendKey:        {
    service: "send_command",
    domainOverride: "remote",
    entityIdTransform: toRemoteEntityId,
    buildData: (v) => ({ command: String(v) }),
  },
  listApps:       { service: "play_media",       buildData: (v) => ({ media_content_id: String(v), media_content_type: "app" }) },
};

export async function sendHACommand(
  entityId: string,
  command: DeviceCommand,
  value: string | number | undefined,
  haUrl: string,
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const { service, domainOverride, entityIdTransform, buildData } = HA_COMMAND_MAP[command];
  const domain = domainOverride ?? entityId.split(".")[0];
  const resolvedEntityId = entityIdTransform ? entityIdTransform(entityId) : entityId;

  const body = JSON.stringify({
    entity_id: resolvedEntityId,
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

export async function getHAState(
  entityId: string,
  haUrl: string,
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<{ state: string; attributes: Record<string, unknown> }> {
  const url = `${haUrl}/api/states/${entityId}`;
  const response = await fetchFn(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Home Assistant API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { state: string; attributes: Record<string, unknown> };
  return { state: data.state, attributes: data.attributes };
}

export async function getHAAllStates(
  haUrl: string,
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<HAEntitySummary[]> {
  const url = `${haUrl}/api/states`;
  const response = await fetchFn(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Home Assistant API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as Array<{ entity_id: string; attributes: Record<string, unknown> }>;
  return data.map((e) => ({
    entity_id: e.entity_id,
    friendly_name: e.attributes.friendly_name as string | undefined,
  }));
}

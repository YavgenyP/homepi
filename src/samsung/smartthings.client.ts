export type DeviceCommand =
  | "on"
  | "off"
  | "volumeUp"
  | "volumeDown"
  | "setVolume"
  | "mute"
  | "unmute"
  | "setTvChannel"
  | "setInputSource"
  | "play"
  | "pause"
  | "stop"
  | "startActivity"
  | "setMode"
  | "setTemperature"
  | "setHvacMode"
  | "setFanMode"
  | "launchApp"
  | "sendKey";

export type SmartThingsCommandFn = (
  smartthingsDeviceId: string,
  command: DeviceCommand,
  value?: string | number
) => Promise<void>;

const COMMAND_MAP: Record<DeviceCommand, { capability: string; apiCommand: string }> = {
  on: { capability: "switch", apiCommand: "on" },
  off: { capability: "switch", apiCommand: "off" },
  volumeUp: { capability: "audioVolume", apiCommand: "volumeUp" },
  volumeDown: { capability: "audioVolume", apiCommand: "volumeDown" },
  setVolume: { capability: "audioVolume", apiCommand: "setVolume" },
  mute: { capability: "audioMute", apiCommand: "mute" },
  unmute: { capability: "audioMute", apiCommand: "unmute" },
  setTvChannel: { capability: "tvChannel", apiCommand: "setTvChannel" },
  setInputSource: { capability: "mediaInputSource", apiCommand: "setInputSource" },
  play: { capability: "mediaPlayback", apiCommand: "play" },
  pause: { capability: "mediaPlayback", apiCommand: "pause" },
  stop: { capability: "mediaPlayback", apiCommand: "stop" },
  startActivity: { capability: "custom.launchapp", apiCommand: "startActivity" },
  setMode:        { capability: "airConditionerMode",      apiCommand: "setAirConditionerMode" },
  setTemperature: { capability: "thermostatCoolingSetpoint", apiCommand: "setCoolingSetpoint" },
  setHvacMode:    { capability: "airConditionerMode",      apiCommand: "setAirConditionerMode" },
  setFanMode:     { capability: "airConditionerFanMode",   apiCommand: "setFanMode" },
  launchApp:      { capability: "custom.launchapp",        apiCommand: "startActivity" },
  sendKey:        { capability: "mediaInputSource",        apiCommand: "setInputSource" },
};

export async function sendDeviceCommand(
  smartthingsDeviceId: string,
  command: DeviceCommand,
  value: string | number | undefined,
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const { capability, apiCommand } = COMMAND_MAP[command];
  const commandObj: Record<string, unknown> = {
    component: "main",
    capability,
    command: apiCommand,
  };
  if (value !== undefined) {
    commandObj.arguments = [value];
  }

  const url = `https://api.smartthings.com/v1/devices/${smartthingsDeviceId}/commands`;
  const body = JSON.stringify({ commands: [commandObj] });

  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`SmartThings API error: ${response.status} ${response.statusText}`);
  }
}

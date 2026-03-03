import type Database from "better-sqlite3";
import type { Intent } from "../intent.schema.js";
import type { DeviceCommand, SmartThingsCommandFn } from "../../samsung/smartthings.client.js";

type SmartDeviceRow = { smartthings_device_id: string };

function buildConfirmation(command: DeviceCommand, name: string, value?: string | number): string {
  switch (command) {
    case "on": return `Turned on ${name}.`;
    case "off": return `Turned off ${name}.`;
    case "volumeUp": return `Turned up the ${name} volume.`;
    case "volumeDown": return `Turned down the ${name} volume.`;
    case "setVolume": return `Set ${name} volume to ${value}.`;
    case "mute": return `Muted ${name}.`;
    case "unmute": return `Unmuted ${name}.`;
    case "setTvChannel": return `Changed ${name} to channel ${value}.`;
    case "setInputSource": return `Switched ${name} input to ${value}.`;
    case "play": return `Playing ${name}.`;
    case "pause": return `Paused ${name}.`;
    case "stop": return `Stopped ${name}.`;
    case "startActivity": return `Launched ${value} on ${name}.`;
  }
}

export async function handleControlDevice(
  intent: Intent,
  db: Database.Database,
  controlDeviceFn: SmartThingsCommandFn
): Promise<string> {
  if (!intent.device) {
    return "Which device do you want to control, and what should it do?";
  }

  const { name, command, value } = intent.device;

  const row = db
    .prepare(
      "SELECT smartthings_device_id FROM smart_devices WHERE LOWER(name) = LOWER(?)"
    )
    .get(name) as SmartDeviceRow | undefined;

  if (!row) {
    return `I don't know a device called "${name}". Register it in the REPL first.`;
  }

  try {
    await controlDeviceFn(row.smartthings_device_id, command, value);
    return buildConfirmation(command, name, value);
  } catch (err) {
    return `Failed to control "${name}": ${String(err)}`;
  }
}

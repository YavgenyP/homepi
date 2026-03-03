import type Database from "better-sqlite3";
import type { Intent } from "../intent.schema.js";
import type { DeviceCommand, SmartThingsCommandFn } from "../../samsung/smartthings.client.js";
import type { HACommandFn, HAQueryFn } from "../../homeassistant/ha.client.js";

type SmartDeviceRow = { smartthings_device_id: string };
type HADeviceRow = { entity_id: string };

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
    case "setMode": return `Set ${name} mode to ${value}.`;
  }
}

export async function handleControlDevice(
  intent: Intent,
  db: Database.Database,
  controlDeviceFn?: SmartThingsCommandFn,
  controlHAFn?: HACommandFn
): Promise<string> {
  if (!intent.device) {
    return "Which device do you want to control, and what should it do?";
  }

  const { name, command, value } = intent.device;

  // 1. Try SmartThings
  const stRow = db
    .prepare("SELECT smartthings_device_id FROM smart_devices WHERE LOWER(name) = LOWER(?)")
    .get(name) as SmartDeviceRow | undefined;

  if (stRow && controlDeviceFn) {
    try {
      await controlDeviceFn(stRow.smartthings_device_id, command, value);
      return buildConfirmation(command, name, value);
    } catch (err) {
      return `Failed to control "${name}": ${String(err)}`;
    }
  }

  // 2. Try Home Assistant
  const haRow = db
    .prepare("SELECT entity_id FROM ha_devices WHERE LOWER(name) = LOWER(?)")
    .get(name) as HADeviceRow | undefined;

  if (haRow && controlHAFn) {
    try {
      await controlHAFn(haRow.entity_id, command, value);
      return buildConfirmation(command, name, value);
    } catch (err) {
      return `Failed to control "${name}": ${String(err)}`;
    }
  }

  return `I don't know a device called "${name}". Register it in the REPL first.`;
}

export async function handleQueryDevice(
  intent: Intent,
  db: Database.Database,
  queryHAFn?: HAQueryFn
): Promise<string> {
  if (!intent.device) {
    return "Which device do you want to query?";
  }

  const { name } = intent.device;

  const haRow = db
    .prepare("SELECT entity_id FROM ha_devices WHERE LOWER(name) = LOWER(?)")
    .get(name) as HADeviceRow | undefined;

  if (!haRow) {
    return `I don't know a device called "${name}". Register it in the REPL first.`;
  }

  if (!queryHAFn) {
    return "Home Assistant is not configured.";
  }

  try {
    const result = await queryHAFn(haRow.entity_id);
    const unit = result.attributes.unit_of_measurement as string | undefined;
    return `${name}: ${result.state}${unit ? " " + unit : ""}`;
  } catch (err) {
    return `Failed to query "${name}": ${String(err)}`;
  }
}

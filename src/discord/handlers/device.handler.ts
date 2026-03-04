import type Database from "better-sqlite3";
import type { Intent } from "../intent.schema.js";
import type { DeviceCommand, SmartThingsCommandFn } from "../../samsung/smartthings.client.js";
import type { HACommandFn, HAQueryFn, HASyncFn } from "../../homeassistant/ha.client.js";

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
    const cause = err instanceof Error && err.cause ? ` (${String(err.cause)})` : "";
    return `Failed to query "${name}": ${String(err)}${cause}`;
  }
}

export function handleListDevices(db: Database.Database): string {
  const stRows = db.prepare("SELECT name, smartthings_device_id FROM smart_devices ORDER BY name").all() as Array<{ name: string; smartthings_device_id: string }>;
  const haRows = db.prepare("SELECT name, entity_id FROM ha_devices ORDER BY name").all() as Array<{ name: string; entity_id: string }>;

  const lines: string[] = [];

  if (stRows.length > 0) {
    lines.push(`SmartThings (${stRows.length}):`);
    for (const r of stRows) lines.push(`  • ${r.name} → ${r.smartthings_device_id}`);
  }

  if (haRows.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`Home Assistant (${haRows.length}):`);
    for (const r of haRows) lines.push(`  • ${r.name} → ${r.entity_id}`);
  }

  if (lines.length === 0) return "No devices registered yet. Use \"sync my devices\" to auto-discover from Home Assistant.";
  return lines.join("\n");
}

function deriveDeviceName(entityId: string, friendlyName?: string): string {
  if (friendlyName) return friendlyName.toLowerCase().trim();
  return entityId.split(".").slice(1).join(".").replace(/_/g, " ");
}

export async function handleSyncHADevices(
  db: Database.Database,
  syncHAFn?: HASyncFn
): Promise<string> {
  if (!syncHAFn) return "Home Assistant is not configured.";

  let entities;
  try {
    entities = await syncHAFn();
  } catch (err) {
    const cause = err instanceof Error && err.cause ? ` (${String(err.cause)})` : "";
    return `Failed to reach Home Assistant: ${String(err)}${cause}`;
  }

  const existing = new Set(
    (db.prepare("SELECT name FROM ha_devices").all() as Array<{ name: string }>).map((r) => r.name.toLowerCase())
  );

  const added: string[] = [];
  const insert = db.prepare("INSERT INTO ha_devices (name, entity_id) VALUES (?, ?)");

  for (const entity of entities) {
    const name = deriveDeviceName(entity.entity_id, entity.friendly_name);
    if (existing.has(name.toLowerCase())) continue;
    insert.run(name, entity.entity_id);
    added.push(`  • ${name} → ${entity.entity_id}`);
    existing.add(name.toLowerCase());
  }

  const skipped = entities.length - added.length;
  if (added.length === 0) return `All ${skipped} entities already registered.`;

  const lines = [`Added ${added.length} device${added.length === 1 ? "" : "s"}:`, ...added];
  if (skipped > 0) lines.push(`(${skipped} already registered, skipped)`);
  return lines.join("\n");
}

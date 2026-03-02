import type Database from "better-sqlite3";
import type { Intent } from "../intent.schema.js";
import type { SmartThingsCommandFn } from "../../samsung/smartthings.client.js";

type SmartDeviceRow = { smartthings_device_id: string };

export async function handleControlDevice(
  intent: Intent,
  db: Database.Database,
  controlDeviceFn: SmartThingsCommandFn
): Promise<string> {
  if (!intent.device) {
    return "Which device do you want to control, and should it be on or off?";
  }

  const { name, command } = intent.device;

  const row = db
    .prepare(
      "SELECT smartthings_device_id FROM smart_devices WHERE LOWER(name) = LOWER(?)"
    )
    .get(name) as SmartDeviceRow | undefined;

  if (!row) {
    return `I don't know a device called "${name}". Register it in the REPL first.`;
  }

  try {
    await controlDeviceFn(row.smartthings_device_id, command);
    return `Turned ${command} ${name}.`;
  } catch (err) {
    return `Failed to control "${name}": ${String(err)}`;
  }
}

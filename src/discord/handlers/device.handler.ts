import type Database from "better-sqlite3";
import type OpenAI from "openai";
import type { Intent } from "../intent.schema.js";
import type { DeviceCommand, SmartThingsCommandFn } from "../../samsung/smartthings.client.js";
import type { HACommandFn, HAQueryFn, HASyncFn } from "../../homeassistant/ha.client.js";

type SmartDeviceRow = { smartthings_device_id: string };
type HADeviceRow = { name: string; entity_id: string; aliases: string; embedding: string; room: string };

// ── Embedding helpers ─────────────────────────────────────────────────────────

export async function getEmbedding(text: string, openai: OpenAI): Promise<number[]> {
  const res = await openai.embeddings.create({ model: "text-embedding-3-small", input: text });
  return res.data[0].embedding;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

const EMBEDDING_THRESHOLD = 0.75;

export async function findHADevice(
  name: string,
  db: Database.Database,
  openai: OpenAI
): Promise<HADeviceRow | undefined> {
  const rows = db
    .prepare("SELECT name, entity_id, aliases, embedding, room FROM ha_devices")
    .all() as HADeviceRow[];

  // 1. Exact name match
  const exact = rows.find((r) => r.name.toLowerCase() === name.toLowerCase());
  if (exact) return exact;

  // 2. Alias match
  const nameLower = name.toLowerCase();
  const aliased = rows.find((r) =>
    r.aliases
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean)
      .includes(nameLower)
  );
  if (aliased) return aliased;

  // 3. Embedding similarity fallback
  const withEmbeddings = rows.filter((r) => r.embedding);
  if (!withEmbeddings.length) return undefined;

  const queryVec = await getEmbedding(name, openai);
  let best: HADeviceRow | undefined;
  let bestScore = 0;
  for (const r of withEmbeddings) {
    const score = cosineSimilarity(queryVec, JSON.parse(r.embedding) as number[]);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return bestScore >= EMBEDDING_THRESHOLD ? best : undefined;
}

// ── Confirmation messages ─────────────────────────────────────────────────────

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
    case "setMode":        return `Set ${name} mode to ${value}.`;
    case "setTemperature": return `Set ${name} temperature to ${value}°C.`;
    case "setHvacMode":    return `Set ${name} to ${value} mode.`;
    case "setFanMode":     return `Set ${name} fan speed to ${value}.`;
    case "launchApp":      return `Launching ${value} on ${name}.`;
    case "sendKey":        return `Sent ${value} key to ${name}.`;
    case "listApps":       return `Listed apps on ${name}.`;
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export async function handleControlDevice(
  intent: Intent,
  db: Database.Database,
  openai: OpenAI,
  controlDeviceFn?: SmartThingsCommandFn,
  controlHAFn?: HACommandFn
): Promise<string> {
  if (!intent.device) {
    return "Which device do you want to control, and what should it do?";
  }

  const { name, command, value } = intent.device;

  // 1. Try SmartThings (exact name only)
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

  // 2. Try Home Assistant (3-tier: exact → alias → embedding)
  const haRow = await findHADevice(name, db, openai);

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
  openai: OpenAI,
  queryHAFn?: HAQueryFn
): Promise<string> {
  if (!intent.device) {
    return "Which device do you want to query?";
  }

  const { name } = intent.device;
  const haRow = await findHADevice(name, db, openai);

  if (!haRow) {
    return `I don't know a device called "${name}". Register it in the REPL first.`;
  }

  if (!queryHAFn) {
    return "Home Assistant is not configured.";
  }

  try {
    const result = await queryHAFn(haRow.entity_id);
    const attrs = result.attributes as Record<string, unknown>;
    const domain = haRow.entity_id.split(".")[0];

    if (intent.device?.command === "listApps") {
      // androidtv integration uses app_list; androidtv_remote uses source_list
      const appList = (attrs.app_list as string[] | undefined) ?? (attrs.source_list as string[] | undefined);
      if (!appList?.length) {
        const currentApp = attrs.app_id ? ` Currently running: ${attrs.app_name ?? ""} (${attrs.app_id}).` : "";
        return `${name}: this device's integration doesn't expose an app list. To find a package name, open the app on the device and ask "what app is running on ${name}?".${currentApp}`;
      }
      const MAX = 50;
      const shown = appList.slice(0, MAX);
      const extra = appList.length - shown.length;
      const lines = [`${name} — ${appList.length} apps:`, ...shown];
      if (extra > 0) lines.push(`… and ${extra} more`);
      return lines.join("\n");
    }

    if (domain === "climate") {
      const parts: string[] = [`${name}: ${result.state}`];
      if (attrs.current_temperature != null) parts.push(`current ${attrs.current_temperature}°`);
      if (attrs.temperature != null) parts.push(`target ${attrs.temperature}°`);
      if (attrs.fan_mode != null) parts.push(`fan: ${attrs.fan_mode}`);
      return parts.join(", ");
    }

    const unit = attrs.unit_of_measurement as string | undefined;
    return `${name}: ${result.state}${unit ? " " + unit : ""}`;
  } catch (err) {
    const cause = err instanceof Error && err.cause ? ` (${String(err.cause)})` : "";
    return `Failed to query "${name}": ${String(err)}${cause}`;
  }
}

export function handleListDevices(db: Database.Database): string {
  const stRows = db.prepare("SELECT name, smartthings_device_id, room FROM smart_devices ORDER BY name").all() as Array<{ name: string; smartthings_device_id: string; room: string }>;
  const haRows = db.prepare("SELECT name, entity_id, aliases, room FROM ha_devices ORDER BY name").all() as Array<{ name: string; entity_id: string; aliases: string; room: string }>;

  const lines: string[] = [];

  if (stRows.length > 0) {
    lines.push(`SmartThings (${stRows.length}):`);
    for (const r of stRows) {
      const loc = r.room ? ` [${r.room}]` : "";
      lines.push(`  • ${r.name}${loc} → ${r.smartthings_device_id}`);
    }
  }

  if (haRows.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`Home Assistant (${haRows.length}):`);
    for (const r of haRows) {
      const loc = r.room ? ` [${r.room}]` : "";
      const aliases = r.aliases ? ` (aliases: ${r.aliases})` : "";
      lines.push(`  • ${r.name}${loc}${aliases} → ${r.entity_id}`);
    }
  }

  if (lines.length === 0) return "No devices registered yet. Use \"sync my devices\" to auto-discover from Home Assistant.";
  return lines.join("\n");
}

export async function handleSetDeviceRoom(
  intent: Intent,
  db: Database.Database,
  openai: OpenAI
): Promise<string> {
  const name = intent.device?.name;
  const room = intent.device_room;
  if (!name || !room) return "Please specify both a device and a room.";

  const haRow = await findHADevice(name, db, openai);
  if (haRow) {
    db.prepare("UPDATE ha_devices SET room = ? WHERE name = ?").run(room.toLowerCase().trim(), haRow.name);
    return `Set room for "${haRow.name}" to "${room}".`;
  }

  const stRow = db.prepare("SELECT name FROM smart_devices WHERE LOWER(name) = LOWER(?)").get(name) as { name: string } | undefined;
  if (stRow) {
    db.prepare("UPDATE smart_devices SET room = ? WHERE name = ?").run(room.toLowerCase().trim(), stRow.name);
    return `Set room for "${stRow.name}" to "${room}".`;
  }

  return `I don't know a device called "${name}". Register it first.`;
}

function deriveDeviceName(entityId: string, friendlyName?: string): string {
  if (friendlyName) return friendlyName.toLowerCase().trim();
  return entityId.split(".").slice(1).join(".").replace(/_/g, " ");
}

export async function handleSyncHADevices(
  db: Database.Database,
  openai: OpenAI,
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
  const insert = db.prepare("INSERT INTO ha_devices (name, entity_id, embedding) VALUES (?, ?, ?)");

  for (const entity of entities) {
    const name = deriveDeviceName(entity.entity_id, entity.friendly_name);
    if (existing.has(name.toLowerCase())) continue;

    let embeddingJson = "";
    try {
      const vec = await getEmbedding(name, openai);
      embeddingJson = JSON.stringify(vec);
    } catch {
      // Non-fatal: embedding computation failure won't block sync
    }

    insert.run(name, entity.entity_id, embeddingJson);
    added.push(`  • ${name} → ${entity.entity_id}`);
    existing.add(name.toLowerCase());
  }

  const skipped = entities.length - added.length;
  if (added.length === 0) return `All ${skipped} entities already registered.`;

  const lines = [`Added ${added.length} device${added.length === 1 ? "" : "s"}:`, ...added];
  if (skipped > 0) lines.push(`(${skipped} already registered, skipped)`);
  return lines.join("\n");
}

// ── Browse / Add HA devices ───────────────────────────────────────────────────

export const SKIP_DOMAINS = new Set([
  "automation", "script", "scene", "zone", "person", "sun", "group",
  "persistent_notification", "update", "device_tracker", "weather",
  "timer", "counter", "input_text", "input_select", "input_datetime",
  "input_number", "input_boolean", "number", "text", "select",
  "button", "event", "image", "conversation", "stt", "tts", "wake_word",
]);

const DOMAIN_CAP = 8;

export async function handleBrowseHADevices(
  intent: Intent,
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

  const registered = new Set(
    (db.prepare("SELECT entity_id FROM ha_devices").all() as Array<{ entity_id: string }>).map((r) => r.entity_id)
  );

  const domainFilter = intent.ha_domain_filter?.toLowerCase() ?? null;

  // Group unregistered entities by domain
  const grouped = new Map<string, Array<{ entity_id: string; friendly_name?: string }>>();
  for (const e of entities) {
    const domain = e.entity_id.split(".")[0];
    if (SKIP_DOMAINS.has(domain)) continue;
    if (registered.has(e.entity_id)) continue;
    if (domainFilter && domain !== domainFilter) continue;
    if (!grouped.has(domain)) grouped.set(domain, []);
    grouped.get(domain)!.push(e);
  }

  if (grouped.size === 0) {
    return domainFilter
      ? `No unregistered "${domainFilter}" devices found in Home Assistant.`
      : "All HA devices are already registered.";
  }

  const lines: string[] = domainFilter
    ? [`Available HA devices — ${domainFilter}:`]
    : ["Available HA devices (not yet registered):"];

  let counter = 1;
  for (const [domain, items] of [...grouped.entries()].sort()) {
    const capped = !domainFilter && items.length > DOMAIN_CAP;
    const shown = capped ? items.slice(0, DOMAIN_CAP) : items;
    lines.push(`\n${domain} (${items.length})`);
    for (const e of shown) {
      const label = e.friendly_name ?? e.entity_id.split(".").slice(1).join(".").replace(/_/g, " ");
      lines.push(`  ${counter}. ${label}  [${e.entity_id}]`);
      counter++;
    }
    if (capped) {
      lines.push(`  ... ${items.length - DOMAIN_CAP} more — say "show ${domain} devices" to list all`);
    }
  }

  lines.push(`\nSay "add 1, 2" or "connect the <name>" to register.`);
  return lines.join("\n");
}

export async function handleAddHADevices(
  intent: Intent,
  db: Database.Database,
  openai: OpenAI,
  syncHAFn?: HASyncFn
): Promise<string> {
  if (!syncHAFn) return "Home Assistant is not configured.";
  if (!intent.ha_entity_ids?.length) return "No entity IDs provided.";

  let entities;
  try {
    entities = await syncHAFn();
  } catch (err) {
    const cause = err instanceof Error && err.cause ? ` (${String(err.cause)})` : "";
    return `Failed to reach Home Assistant: ${String(err)}${cause}`;
  }

  const entityMap = new Map<string, string | undefined>(
    entities.map((e) => [e.entity_id, e.friendly_name])
  );

  const existingEntityIds = new Set(
    (db.prepare("SELECT entity_id FROM ha_devices").all() as Array<{ entity_id: string }>).map((r) => r.entity_id)
  );

  const insert = db.prepare("INSERT INTO ha_devices (name, entity_id, embedding) VALUES (?, ?, ?)");
  const added: string[] = [];
  const skipped: string[] = [];
  const notFound: string[] = [];

  for (const entityId of intent.ha_entity_ids) {
    if (existingEntityIds.has(entityId)) {
      skipped.push(entityId);
      continue;
    }
    if (!entityMap.has(entityId)) {
      notFound.push(entityId);
      continue;
    }
    const name = deriveDeviceName(entityId, entityMap.get(entityId));

    let embeddingJson = "";
    try {
      const vec = await getEmbedding(name, openai);
      embeddingJson = JSON.stringify(vec);
    } catch {
      // Non-fatal
    }

    insert.run(name, entityId, embeddingJson);
    added.push(`  • ${name} → ${entityId}`);
    existingEntityIds.add(entityId);
  }

  const lines: string[] = [];
  if (added.length > 0) {
    lines.push(`Registered ${added.length} device${added.length === 1 ? "" : "s"}:`);
    lines.push(...added);
  }
  if (skipped.length > 0) {
    lines.push(`Already registered: ${skipped.join(", ")}`);
  }
  if (notFound.length > 0) {
    lines.push(`Not found in HA: ${notFound.join(", ")}`);
  }
  if (lines.length === 0) return "Nothing to register.";
  return lines.join("\n");
}

export async function handleAliasDevice(
  intent: Intent,
  db: Database.Database,
  openai: OpenAI
): Promise<string> {
  const deviceName = intent.device?.name;
  const alias = intent.device_alias;

  if (!deviceName || !alias) {
    return "Please specify both the device name and the alias (e.g. \"call the xiaomi fan 'purifier'\").";
  }

  const row = db
    .prepare("SELECT name, aliases FROM ha_devices WHERE LOWER(name) = LOWER(?)")
    .get(deviceName) as { name: string; aliases: string } | undefined;

  if (!row) {
    return `I don't know a device called "${deviceName}". Register it in the REPL first.`;
  }

  const existing = row.aliases
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);

  const aliasLower = alias.toLowerCase().trim();
  if (existing.includes(aliasLower)) {
    return `"${alias}" is already an alias for "${row.name}".`;
  }

  const updated = [...existing, aliasLower].join(",");
  db.prepare("UPDATE ha_devices SET aliases = ? WHERE LOWER(name) = LOWER(?)").run(updated, deviceName);

  // Recompute embedding with updated name + aliases
  try {
    const embeddingText = `${row.name} ${updated.replace(/,/g, " ")}`.trim();
    const vec = await getEmbedding(embeddingText, openai);
    db.prepare("UPDATE ha_devices SET embedding = ? WHERE LOWER(name) = LOWER(?)").run(JSON.stringify(vec), deviceName);
  } catch {
    // Non-fatal
  }

  return `Added "${aliasLower}" as an alias for "${row.name}".`;
}

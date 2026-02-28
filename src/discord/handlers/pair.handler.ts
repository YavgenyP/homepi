import type Database from "better-sqlite3";
import type { Intent } from "../intent.schema.js";

export function handlePair(
  intent: Intent,
  discordUserId: string,
  discordUsername: string,
  db: Database.Database
): string {
  const { phone } = intent;

  if (!phone || (!phone.ip && !phone.ble_mac)) {
    return "Please include an IP address or BLE MAC. Example: `register my phone 192.168.1.23`";
  }

  const kind = phone.ip ? "ping_ip" : "ble_mac";
  const value = (phone.ip ?? phone.ble_mac) as string;

  // Upsert person
  db.prepare(
    "INSERT OR IGNORE INTO people (discord_user_id, name) VALUES (?, ?)"
  ).run(discordUserId, discordUsername);

  const person = db
    .prepare("SELECT id FROM people WHERE discord_user_id = ?")
    .get(discordUserId) as { id: number };

  // Insert device — ignore if already exists
  const result = db
    .prepare(
      "INSERT OR IGNORE INTO person_devices (person_id, kind, value) VALUES (?, ?, ?)"
    )
    .run(person.id, kind, value);

  if (result.changes === 0) {
    return `${value} is already registered to your account.`;
  }

  const label = kind === "ping_ip" ? `phone (${value})` : `BLE device (${value})`;
  return `Registered your ${label}. I'll use it for presence detection.`;
}

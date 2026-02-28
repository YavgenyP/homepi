import { spawn } from "node:child_process";
import type Database from "better-sqlite3";
import type { PresenceProvider, PresenceSighting } from "./provider.interface.js";

export type BleScanFn = (durationMs: number) => Promise<Set<string>>;

const MAC_RE = /([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}/g;

/**
 * Scans for BLE devices using bluetoothctl (Linux / Raspberry Pi only).
 * Requires BlueZ and a Bluetooth adapter. Will fail on Windows/macOS.
 */
export async function bluetoothctlScan(durationMs: number): Promise<Set<string>> {
  return new Promise((resolve) => {
    const seen = new Set<string>();
    const proc = spawn("bluetoothctl", ["scan", "on"]);

    proc.stdout.on("data", (chunk: Buffer) => {
      const matches = chunk.toString().match(MAC_RE);
      if (matches) matches.forEach((m) => seen.add(m.toLowerCase()));
    });

    // bluetoothctl also outputs to stderr in some versions
    proc.stderr.on("data", (chunk: Buffer) => {
      const matches = chunk.toString().match(MAC_RE);
      if (matches) matches.forEach((m) => seen.add(m.toLowerCase()));
    });

    setTimeout(() => {
      proc.kill();
      resolve(seen);
    }, durationMs);
  });
}

type DeviceRow = { person_id: number; value: string };

export class BleProvider implements PresenceProvider {
  readonly name = "ble";

  constructor(
    private readonly db: Database.Database,
    private readonly scanDurationMs: number = 5000,
    private readonly scanFn: BleScanFn = bluetoothctlScan
  ) {}

  async poll(): Promise<PresenceSighting[]> {
    const devices = this.db
      .prepare(
        "SELECT person_id, value FROM person_devices WHERE kind = 'ble_mac'"
      )
      .all() as DeviceRow[];

    if (devices.length === 0) return [];

    const seenMacs = await this.scanFn(this.scanDurationMs);

    const seenPersonIds = new Set<number>();
    for (const d of devices) {
      if (seenMacs.has(d.value.toLowerCase())) {
        seenPersonIds.add(d.person_id);
      }
    }

    const now = Math.floor(Date.now() / 1000);
    return Array.from(seenPersonIds).map((personId) => ({ personId, seenAt: now }));
  }
}

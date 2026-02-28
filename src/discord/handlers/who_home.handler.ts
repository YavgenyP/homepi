import type Database from "better-sqlite3";

type State = "home" | "away";

type PersonRow = { id: number; name: string };

export function handleWhoHome(
  states: Map<number, State>,
  db: Database.Database
): string {
  const people = db
    .prepare("SELECT id, name FROM people ORDER BY name")
    .all() as PersonRow[];

  if (people.length === 0) {
    return "No one is registered yet. Use `register my phone <ip>` to get started.";
  }

  return people
    .map((p) => {
      const state = states.get(p.id) ?? "away";
      return `${p.name}: ${state}`;
    })
    .join("\n");
}

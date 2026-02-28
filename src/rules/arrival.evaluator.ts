import type Database from "better-sqlite3";

type RuleRow = { action_json: string };

export async function evaluateArrivalRules(
  personId: number,
  db: Database.Database,
  sendToChannel: (text: string) => Promise<void>
): Promise<void> {
  const rules = db
    .prepare(
      `SELECT action_json FROM rules
       WHERE trigger_type = 'arrival'
         AND enabled = 1
         AND JSON_EXTRACT(trigger_json, '$.person_id') = ?`
    )
    .all(personId) as RuleRow[];

  for (const rule of rules) {
    const action = JSON.parse(rule.action_json) as { message: string };
    await sendToChannel(action.message);
  }
}

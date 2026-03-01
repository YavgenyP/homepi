import type Database from "better-sqlite3";

type RuleRow = { action_json: string };
type ActionJson = { message?: string; sound?: string };

export async function evaluateArrivalRules(
  personId: number,
  db: Database.Database,
  sendToChannel: (text: string) => Promise<void>,
  playSoundFn?: (source: string) => Promise<void>
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
    const action = JSON.parse(rule.action_json) as ActionJson;
    if (action.message) await sendToChannel(action.message);
    if (action.sound && playSoundFn) {
      await playSoundFn(action.sound).catch((err) =>
        console.error("Sound playback error:", err)
      );
    }
  }
}

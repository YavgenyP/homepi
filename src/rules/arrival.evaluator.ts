import type Database from "better-sqlite3";

type RuleRow = { action_json: string };
type ActionJson = {
  message?: string;
  sound?: string;
  target_person_id?: number;
};

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

    // Build notification text, prepending @mention when target is set
    let notifyText = action.message;
    if (action.target_person_id !== undefined && action.message) {
      const personRow = db
        .prepare("SELECT discord_user_id FROM people WHERE id = ?")
        .get(action.target_person_id) as { discord_user_id: string } | undefined;
      if (personRow?.discord_user_id) {
        notifyText = `<@${personRow.discord_user_id}> ${action.message}`;
      }
    }

    if (notifyText) await sendToChannel(notifyText);
    if (action.sound && playSoundFn) {
      await playSoundFn(action.sound).catch((err) =>
        console.error("Sound playback error:", err)
      );
    }
  }
}

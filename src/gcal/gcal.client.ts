import { google } from "googleapis";
import type Database from "better-sqlite3";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export async function createCalendarEvent(
  personId: number,
  db: Database.Database,
  keyFile: string,
  event: { summary: string; startIso: string }
): Promise<void> {
  const row = db
    .prepare("SELECT gcal_calendar_id FROM people WHERE id = ?")
    .get(personId) as { gcal_calendar_id: string | null } | undefined;

  if (!row?.gcal_calendar_id) return;

  const calendarId = row.gcal_calendar_id;

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: [CALENDAR_SCOPE],
  });

  const calendar = google.calendar({ version: "v3", auth });

  const start = new Date(event.startIso);
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: event.summary,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    },
  });
}

import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../storage/db.js";

const { mockInsert } = vi.hoisted(() => ({
  mockInsert: vi.fn().mockResolvedValue({}),
}));

vi.mock("googleapis", () => ({
  google: {
    auth: {
      GoogleAuth: vi.fn().mockImplementation(() => ({})),
    },
    calendar: vi.fn().mockReturnValue({
      events: { insert: mockInsert },
    }),
  },
}));

import { createCalendarEvent } from "./gcal.client.js";

let db: Database.Database;

beforeEach(() => {
  db = openDb(":memory:");
  mockInsert.mockClear();
});

function seedPerson(calendarId: string | null = null): number {
  db.prepare("INSERT INTO people (discord_user_id, name) VALUES (?, ?)").run(
    "u1",
    "Alice"
  );
  if (calendarId !== null) {
    db.prepare(
      "UPDATE people SET gcal_calendar_id = ? WHERE discord_user_id = 'u1'"
    ).run(calendarId);
  }
  return (
    db.prepare("SELECT id FROM people WHERE discord_user_id = 'u1'").get() as {
      id: number;
    }
  ).id;
}

describe("createCalendarEvent", () => {
  it("returns silently when person has no gcal_calendar_id", async () => {
    const personId = seedPerson(null);
    await createCalendarEvent(personId, db, "/fake/key.json", {
      summary: "test",
      startIso: "2099-06-01T08:00:00.000Z",
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("returns silently when person does not exist", async () => {
    await createCalendarEvent(9999, db, "/fake/key.json", {
      summary: "test",
      startIso: "2099-06-01T08:00:00.000Z",
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("calls events.insert with correct summary and times when calendar configured", async () => {
    const personId = seedPerson("alice@gmail.com");
    const startIso = "2099-06-01T08:00:00.000Z";

    await createCalendarEvent(personId, db, "/fake/key.json", {
      summary: "take out the trash",
      startIso,
    });

    expect(mockInsert).toHaveBeenCalledOnce();
    const [callArg] = mockInsert.mock.calls[0];
    expect(callArg.calendarId).toBe("alice@gmail.com");
    expect(callArg.requestBody.summary).toBe("take out the trash");
    expect(callArg.requestBody.start.dateTime).toBe(startIso);

    // end should be 30 minutes after start
    const endDate = new Date(callArg.requestBody.end.dateTime);
    const startDate = new Date(startIso);
    expect(endDate.getTime() - startDate.getTime()).toBe(30 * 60 * 1000);
  });
});

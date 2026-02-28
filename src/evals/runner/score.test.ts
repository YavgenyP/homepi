import { describe, it, expect } from "vitest";
import { matchesExpected } from "./score.js";

describe("matchesExpected", () => {
  it("passes when all expected fields match", () => {
    const actual = { intent: "who_home", confidence: 0.9, person: null };
    const expected = { intent: "who_home" };
    expect(matchesExpected(actual, expected).pass).toBe(true);
  });

  it("fails when a top-level field differs", () => {
    const actual = { intent: "unknown" };
    const expected = { intent: "who_home" };
    const { pass, failures } = matchesExpected(actual, expected);
    expect(pass).toBe(false);
    expect(failures[0]).toMatch(/intent/);
  });

  it("passes on nested object partial match", () => {
    const actual = { phone: { ip: "192.168.1.23", ble_mac: undefined } };
    const expected = { phone: { ip: "192.168.1.23" } };
    expect(matchesExpected(actual, expected).pass).toBe(true);
  });

  it("fails on nested object mismatch", () => {
    const actual = { phone: { ip: "10.0.0.1" } };
    const expected = { phone: { ip: "192.168.1.23" } };
    const { pass, failures } = matchesExpected(actual, expected);
    expect(pass).toBe(false);
    expect(failures[0]).toMatch(/phone\.ip/);
  });

  it("fails when expected object but actual is null", () => {
    const actual = { phone: null };
    const expected = { phone: { ip: "192.168.1.23" } };
    const { pass, failures } = matchesExpected(actual, expected);
    expect(pass).toBe(false);
    expect(failures[0]).toMatch(/phone/);
  });

  it("passes with empty expected (no constraints)", () => {
    const actual = { intent: "help", confidence: 0.5 };
    expect(matchesExpected(actual, {}).pass).toBe(true);
  });

  it("checks clarifying_question field", () => {
    const actual = {
      clarifying_question: "What time in the morning should I remind you?",
    };
    const expected = {
      clarifying_question: "What time in the morning should I remind you?",
    };
    expect(matchesExpected(actual, expected).pass).toBe(true);
  });
});

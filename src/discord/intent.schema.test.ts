import { describe, it, expect } from "vitest";
import { IntentSchema } from "./intent.schema.js";

const validBase = {
  intent: "who_home",
  trigger: "none",
  action: "none",
  message: null,
  time_spec: null,
  person: null,
  phone: null,
  confidence: 0.9,
  clarifying_question: null,
} as const;

describe("IntentSchema", () => {
  it("accepts a valid intent", () => {
    expect(() => IntentSchema.parse(validBase)).not.toThrow();
  });

  it("accepts a create_rule intent with time_spec", () => {
    const intent = {
      ...validBase,
      intent: "create_rule",
      trigger: "time",
      action: "notify",
      message: "take out trash",
      time_spec: { datetime_iso: "2026-03-01T08:00:00" },
      person: { ref: "me" },
    };
    expect(() => IntentSchema.parse(intent)).not.toThrow();
  });

  it("accepts a pair_phone intent", () => {
    const intent = {
      ...validBase,
      intent: "pair_phone",
      phone: { ip: "192.168.1.23" },
      person: { ref: "me" },
    };
    expect(() => IntentSchema.parse(intent)).not.toThrow();
  });

  it("rejects an unknown intent value", () => {
    expect(() =>
      IntentSchema.parse({ ...validBase, intent: "fly_rocket" })
    ).toThrow();
  });

  it("rejects confidence out of range", () => {
    expect(() =>
      IntentSchema.parse({ ...validBase, confidence: 1.5 })
    ).toThrow();
  });

  it("rejects missing required fields", () => {
    const { intent: _i, ...noIntent } = validBase;
    expect(() => IntentSchema.parse(noIntent)).toThrow();
  });
});

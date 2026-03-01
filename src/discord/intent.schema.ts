import { z } from "zod";

export const IntentSchema = z.object({
  intent: z.enum([
    "pair_phone",
    "create_rule",
    "list_rules",
    "delete_rule",
    "who_home",
    "help",
    "unknown",
  ]),
  trigger: z.enum(["time", "arrival", "none"]),
  action: z.enum(["notify", "none"]),
  message: z.string().nullable(),
  time_spec: z
    .object({
      datetime_iso: z.string().nullish(),
      cron: z.string().nullish(),
    })
    .nullable(),
  person: z
    .object({
      ref: z.enum(["me", "name"]),
      name: z.string().nullish(),
    })
    .nullable(),
  phone: z
    .object({
      ip: z.string().nullish(),
      ble_mac: z.string().nullish(),
    })
    .nullable(),
  sound_source: z.string().nullable().default(null),
  require_home: z.boolean().default(false),
  confidence: z.number().min(0).max(1),
  clarifying_question: z.string().nullable(),
});

export type Intent = z.infer<typeof IntentSchema>;

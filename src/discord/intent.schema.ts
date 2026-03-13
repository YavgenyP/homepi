import { z } from "zod";

export const IntentSchema = z.object({
  intent: z.enum([
    "pair_phone",
    "create_rule",
    "list_rules",
    "delete_rule",
    "who_home",
    "help",
    "control_device",
    "query_device",
    "list_devices",
    "sync_ha_devices",
    "browse_ha_devices",
    "add_ha_devices",
    "alias_device",
    "set_device_room",
    "set_volume",
    "stop_sound",
    "save_shortcut",
    "delete_shortcut",
    "unknown",
  ]),
  trigger: z.enum(["time", "arrival", "condition", "none"]),
  action: z.enum(["notify", "device_control", "none"]),
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
  device: z
    .object({
      name: z.string(),
      command: z.enum([
        "on",
        "off",
        "volumeUp",
        "volumeDown",
        "setVolume",
        "mute",
        "unmute",
        "setTvChannel",
        "setInputSource",
        "play",
        "pause",
        "stop",
        "startActivity",
        "setMode",
        "setTemperature",
        "setHvacMode",
        "setFanMode",
        "launchApp",
        "sendKey",
        "listApps",
      ]),
      value: z.union([z.string(), z.number()]).optional(),
    })
    .nullable()
    .default(null),
  condition_entity_id: z.string().nullable().default(null),
  condition_state: z.string().nullable().default(null),
  condition_operator: z.enum(["<", ">", "<=", ">="]).nullable().default(null),
  condition_threshold: z.number().nullable().default(null),
  duration_sec: z.number().nullable().default(null),
  device_alias: z.string().nullable().default(null),
  device_room: z.string().nullable().default(null),
  ha_entity_ids: z.array(z.string()).nullable().default(null),
  ha_domain_filter: z.string().nullable().default(null),
  volume: z.number().min(0).max(100).nullable().default(null),
  shortcut_name: z.string().nullable().default(null),
  shortcut_url: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1),
  clarifying_question: z.string().nullable(),
});

export type Intent = z.infer<typeof IntentSchema>;

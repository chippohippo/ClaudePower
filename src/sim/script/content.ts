// Focus trees, events, ambitions and headlines: schemas + loaded content (data/focuses, data/events).
import { z } from "zod";
import { ConditionSchema, EffectSchema } from "./schema";

export const FocusSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/), name: z.string(), description: z.string(),
  prerequisites: z.array(z.string()).default([]),
  /** Any one of these must be done (OR); combined with prerequisites (AND). */
  anyOf: z.array(z.string()).default([]),
  exclusive: z.array(z.string()).default([]),
  cost: z.number().nonnegative(), days: z.number().int().positive(),
  points: z.object({ adm: z.number().optional(), dip: z.number().optional(), mil: z.number().optional() }).optional(),
  available: ConditionSchema.optional(),
  effects: z.array(EffectSchema),
  ai: z.number().nonnegative().default(1),
  branch: z.string().optional(),
});
export type FocusDef = z.infer<typeof FocusSchema>;
export const FocusTreeSchema = z.object({
  id: z.string(), name: z.string(),
  /** Country tags this tree belongs to, or "generic". */
  countries: z.union([z.array(z.string()), z.literal("generic")]),
  /** Generic trees: who may take it. */
  eligible: ConditionSchema.optional(),
  focuses: z.array(FocusSchema).min(1),
});
export type FocusTree = z.infer<typeof FocusTreeSchema>;

export const EventSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/), title: z.string(), description: z.string(),
  /** country: one per country; province/ig: binds the first province/IG that matches `bindIf`. */
  scope: z.enum(["country", "province", "ig"]).default("country"),
  trigger: ConditionSchema,
  bindIf: ConditionSchema.optional(),
  /** Mean time to happen, months (0 = fires as soon as the trigger holds; used for triggered follow-ups). */
  mtth: z.number().nonnegative(),
  once: z.boolean().default(false),
  cooldown: z.number().nonnegative().default(60),
  /** Fired only by triggerEvent/other content, never by the monthly scan. */
  triggeredOnly: z.boolean().default(false),
  /** Reaction content for a major flag (consistency linter). */
  reactsTo: z.array(z.string()).default([]),
  choices: z.array(z.object({ name: z.string(), effects: z.array(EffectSchema), ai: z.number().nonnegative().default(1) })).min(1).max(3),
});
export type EventDef = z.infer<typeof EventSchema>;
export const EventsFile = z.array(EventSchema);

export const FlagsFile = z.array(z.object({ id: z.string(), major: z.boolean().default(false), description: z.string() }));
export const AmbitionsFile = z.array(z.object({
  id: z.string(), name: z.string(), description: z.string(),
  eligible: ConditionSchema, goal: ConditionSchema, reward: z.array(EffectSchema),
}));
export const HeadlinesFile = z.record(z.string(), z.array(z.string()).min(1));

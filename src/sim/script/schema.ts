// Content scripting language shared by focuses, events and ambitions: JSON conditions and effects.
import { z } from "zod";

const op = z.enum([">", "<", ">=", "<="]);
export const COUNTRY_STATS = ["stability", "sol", "urban", "literacy", "unemployment", "debtRatio", "gdpPerCapita", "population", "pp", "treasuryMonths", "inflation", "lifeExp", "manpower", "year"] as const;
export const IG_STATS = ["clout", "approval", "radicalism"] as const;

export type Condition =
  | { all: Condition[] } | { any: Condition[] } | { not: Condition }
  | { flag: string } | { countryFlag: string } | { tag: string } | { government: "democracy" | "autocracy" }
  | { year: { min?: number; max?: number } }
  | { law: { category: string; law: string } }
  | { stat: { key: (typeof COUNTRY_STATS)[number]; op: z.infer<typeof op>; value: number } }
  | { ig: { id: string; key: (typeof IG_STATS)[number]; op: z.infer<typeof op>; value: number } }
  | { focus: string } | { headIdeology: "dem" | "fas" | "com" | "non" } | { ideology: { id: "dem" | "fas" | "com" | "non"; op: z.infer<typeof op>; value: number } }
  | { atWarFlag: string } | { always: boolean }
  | { province: { key: "unrest" | "unemployment" | "sol" | "population"; op: z.infer<typeof op>; value: number } }
  | { igBound: { key: (typeof IG_STATS)[number]; op: z.infer<typeof op>; value: number } };

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() => z.union([
  z.object({ all: z.array(ConditionSchema) }).strict(),
  z.object({ any: z.array(ConditionSchema) }).strict(),
  z.object({ not: ConditionSchema }).strict(),
  z.object({ flag: z.string() }).strict(),
  z.object({ countryFlag: z.string() }).strict(),
  z.object({ tag: z.string().regex(/^[A-Z]{3}$/) }).strict(),
  z.object({ government: z.enum(["democracy", "autocracy"]) }).strict(),
  z.object({ year: z.object({ min: z.number().optional(), max: z.number().optional() }) }).strict(),
  z.object({ law: z.object({ category: z.string(), law: z.string() }) }).strict(),
  z.object({ stat: z.object({ key: z.enum(COUNTRY_STATS), op, value: z.number() }) }).strict(),
  z.object({ ig: z.object({ id: z.string(), key: z.enum(IG_STATS), op, value: z.number() }) }).strict(),
  z.object({ focus: z.string() }).strict(),
  z.object({ headIdeology: z.enum(["dem", "fas", "com", "non"]) }).strict(),
  z.object({ ideology: z.object({ id: z.enum(["dem", "fas", "com", "non"]), op, value: z.number() }) }).strict(),
  z.object({ atWarFlag: z.string() }).strict(),
  z.object({ always: z.boolean() }).strict(),
  z.object({ province: z.object({ key: z.enum(["unrest", "unemployment", "sol", "population"]), op, value: z.number() }) }).strict(),
  z.object({ igBound: z.object({ key: z.enum(IG_STATS), op, value: z.number() }) }).strict(),
]));

export const EffectSchema = z.union([
  z.object({ pp: z.number() }).strict(),
  z.object({ points: z.object({ adm: z.number().optional(), dip: z.number().optional(), mil: z.number().optional() }) }).strict(),
  z.object({ treasuryMonths: z.number() }).strict(),
  z.object({ setFlag: z.string() }).strict(),
  z.object({ clearFlag: z.string() }).strict(),
  z.object({ setCountryFlag: z.string() }).strict(),
  z.object({ clearCountryFlag: z.string() }).strict(),
  z.object({ modifier: z.object({ name: z.string(), target: z.string(), add: z.number().optional(), mult: z.number().optional(), months: z.number().int().positive().optional() }) }).strict(),
  z.object({ law: z.object({ category: z.string(), law: z.string() }) }).strict(),
  z.object({ stability: z.number() }).strict(),
  z.object({ igFavour: z.object({ id: z.string(), value: z.number() }) }).strict(),
  z.object({ igRadicalism: z.object({ id: z.string(), value: z.number() }) }).strict(),
  z.object({ boundIgFavour: z.number() }).strict(),
  z.object({ boundIgRadicalism: z.number() }).strict(),
  z.object({ build: z.object({ building: z.string(), levels: z.number().int().positive(), where: z.enum(["capital", "largest", "bound"]) }) }).strict(),
  z.object({ develop: z.object({ kind: z.enum(["tax", "production", "manpower"]), amount: z.number().int().positive(), where: z.enum(["capital", "largest", "bound", "all"]) }) }).strict(),
  z.object({ provinceUnrest: z.number() }).strict(),
  z.object({ government: z.enum(["democracy", "autocracy"]) }).strict(),
  z.object({ ideologyShift: z.object({ id: z.enum(["dem", "fas", "com", "non"]), amount: z.number() }) }).strict(),
  z.object({ privilege: z.object({ id: z.string(), granted: z.boolean() }) }).strict(),
  z.object({ chronicle: z.string() }).strict(),
  z.object({ triggerEvent: z.string() }).strict(),
]);
export type Effect = z.infer<typeof EffectSchema>;

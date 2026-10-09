// Zod schemas for all data/ files.
import { z } from "zod";

export const CountrySchema = z.object({
  tag: z.string().regex(/^[A-Z]{3}$/),
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});

export const CountrySchemaV2 = CountrySchema.extend({
  capital: z.tuple([z.number(), z.number()]),
  major: z.boolean(),
});
export const Map1936File = z.object({
  adm0: z.record(z.string(), z.string().regex(/^[A-Z]{3}$/)),
  admin1: z.record(z.string(), z.record(z.string(), z.string().regex(/^[A-Z]{3}$/))),
});
export const TERRAINS = ["plains", "forest", "hills", "mountains", "desert", "jungle", "tundra", "marsh"] as const;
export const ProvinceSchema = z.object({
  id: z.number().int().nonnegative(), name: z.string(), owner: z.string().regex(/^[A-Z]{3}$/),
  terrain: z.enum(TERRAINS), development: z.number().min(0), areaKm2: z.number().positive(),
  lon: z.number(), lat: z.number(), neighbors: z.array(z.number().int()),
});
export const ProvincesFile = z.object({ capitals: z.record(z.string(), z.number().int()), provinces: z.array(ProvinceSchema) });
export const CountriesFile = z.array(CountrySchemaV2);

const share = z.record(z.string(), z.number().min(0).max(1));
export const RegionStart = z.object({
  population: z.number().positive(), urban: z.number().min(0).max(1), literacy: z.number().min(0).max(1),
  gdpPerCapita: z.number().positive(), cultures: share, religions: share,
});
export const REGION_NAMES = ["europe", "namerica", "samerica", "africa", "mideast", "oceania", "asia"] as const;
export const CountryStart = RegionStart.extend({ colonies: z.partialRecord(z.enum(REGION_NAMES), RegionStart).optional() });
export const CountriesStartFile = z.record(z.string().regex(/^[A-Z]{3}$/), CountryStart);
export type RegionStartDef = z.infer<typeof RegionStart>;

export const GoodsFile = z.array(z.object({ id: z.string(), name: z.string(), basePrice: z.number().positive() }));
export type GoodDef = z.infer<typeof GoodsFile>[number];
const qty = z.record(z.string(), z.number().nonnegative());
export const NEED_TIERS = ["subsistence", "everyday", "luxury"] as const;
export const NeedsFile = z.object({ subsistence: qty, everyday: qty, luxury: qty });
export const STRATA = ["peasants", "workers", "clerks", "professionals", "elites", "military", "bureaucrats"] as const;
export type Stratum = (typeof STRATA)[number];
const PmSchema = z.object({
  id: z.string(), name: z.string(), year: z.number().int(),
  jobs: z.partialRecord(z.enum(STRATA), z.number().nonnegative()), inputs: qty, outputs: qty,
});
export const BuildingsFile = z.array(z.object({
  id: z.string(), name: z.string(), owner: z.enum(["private", "state"]),
  category: z.enum(["agriculture", "extraction", "industry", "services", "public"]),
  resource: z.enum(["oil", "coal", "iron"]).optional(), effect: z.enum(["literacy", "health"]).optional(),
  pms: z.array(PmSchema).min(1),
}));
export type BuildingDef = z.infer<typeof BuildingsFile>[number];
const Box = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export const ResourcesFile = z.object({ oil: z.array(Box), coal: z.array(Box), iron: z.array(Box) });
export const StartPopsFile = z.object({
  cultures: z.array(z.string()), religions: z.array(z.string()),
  // [province, culture, religion, stratum, a0, a1, a2, literacy, health, cashCents]
  pops: z.array(z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])),
  // [province, buildingIndex, level]
  buildings: z.array(z.tuple([z.number().int(), z.number().int(), z.number().int()])),
});
export type CountryDef = z.infer<typeof CountrySchemaV2>;
export type ProvinceDef = z.infer<typeof ProvinceSchema>;

export const DATA_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "countries.json": CountriesFile,
  "map_1936.json": Map1936File,
  "generated/provinces.json": ProvincesFile,
  "generated/map-geometry.json": z.array(z.array(z.array(z.number()))),
  "generated/pops-1936.json": StartPopsFile,
  "start/countries-1936.json": CountriesStartFile,
  "start/resources.json": ResourcesFile,
  "goods.json": GoodsFile,
  "needs.json": NeedsFile,
  "buildings.json": BuildingsFile,
};

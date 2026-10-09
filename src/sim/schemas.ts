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
export type CountryDef = z.infer<typeof CountrySchemaV2>;
export type ProvinceDef = z.infer<typeof ProvinceSchema>;

export const DATA_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "countries.json": CountriesFile,
  "map_1936.json": Map1936File,
  "generated/provinces.json": ProvincesFile,
  "generated/map-geometry.json": z.array(z.array(z.array(z.number()))),
};

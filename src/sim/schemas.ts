// Zod schemas for all data/ files.
import { z } from "zod";

export const CountrySchema = z.object({
  tag: z.string().regex(/^[A-Z]{3}$/),
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});
export const CountriesFile = z.array(CountrySchema);

export const DATA_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "countries.json": CountriesFile,
};

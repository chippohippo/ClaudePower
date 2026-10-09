// Loads and validates bundled content (works in Node, worker, and Vite).
import countriesJson from "../../data/countries.json";
import provincesJson from "../../data/generated/provinces.json";
import { CountriesFile, ProvincesFile } from "./schemas";
import type { StartData } from "./setup";

export function loadContent(): StartData {
  const countries = CountriesFile.parse(countriesJson);
  const { provinces, capitals } = ProvincesFile.parse(provincesJson);
  return { countries, provinces, capitals };
}

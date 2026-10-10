// Loads and validates bundled content (works in Node, worker, and Vite).
import countriesJson from "../../data/countries.json";
import provincesJson from "../../data/generated/provinces.json";
import popsJson from "../../data/generated/pops-1936.json";
import startJson from "../../data/start/countries-1936.json";
import resourcesJson from "../../data/start/resources.json";
import lawsJson from "../../data/start/laws-1936.json";
import govJson from "../../data/start/governments-1936.json";
import charsJson from "../../data/start/characters-1936.json";
import { CountriesFile, CountriesStartFile, GovernmentsFile, ProvincesFile, ResourcesFile, StartCharactersFile, StartLawsFile, StartPopsFile } from "./schemas";
import type { StartData } from "./setup";

let cached: StartData | null = null;
export function loadContent(): StartData {
  if (cached) return cached;
  const countries = CountriesFile.parse(countriesJson);
  const { provinces, capitals } = ProvincesFile.parse(provincesJson);
  cached = {
    countries, provinces, capitals,
    pops: StartPopsFile.parse(popsJson),
    start: CountriesStartFile.parse(startJson),
    resources: ResourcesFile.parse(resourcesJson),
    laws: StartLawsFile.parse(lawsJson),
    politics: { governments: GovernmentsFile.parse(govJson), characters: StartCharactersFile.parse(charsJson) },
  };
  return cached;
}

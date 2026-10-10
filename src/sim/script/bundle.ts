// Compiled content bundle (scripts/build-content.ts → data/generated/content.json), validated at load.
import bundleJson from "../../../data/generated/content.json";
import { z } from "zod";
import { AmbitionsFile, EventsFile, FlagsFile, FocusTreeSchema, HeadlinesFile } from "./content";

export const BundleSchema = z.object({
  trees: z.array(FocusTreeSchema.extend({ layout: z.record(z.string(), z.tuple([z.number(), z.number()])) })),
  events: EventsFile, flags: FlagsFile, ambitions: AmbitionsFile, headlines: HeadlinesFile,
});
export const CONTENT = BundleSchema.parse(bundleJson);
export const TREES = CONTENT.trees;
export const EVENTS = CONTENT.events;
export const EVENT_BY_ID = new Map(EVENTS.map((e) => [e.id, e]));
export const AMBITIONS = CONTENT.ambitions;
export const treeById = (id: string) => TREES.find((t) => t.id === id);
export const focusById = (tree: string, id: string) => treeById(tree)?.focuses.find((f) => f.id === id);

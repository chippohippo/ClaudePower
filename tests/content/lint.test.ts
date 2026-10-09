import { expect, test } from "vitest";
import { lintContent } from "../../scripts/lint-content";

test("all data files validate", () => expect(lintContent()).toEqual([]));

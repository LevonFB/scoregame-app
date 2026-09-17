import { describe, expect, it } from "vitest";
import {
  APP_SECTION_KEYS,
  APP_SECTION_VISIBILITY_VALUES,
  APP_SUBSECTIONS,
  APP_SUBSECTIONS_BY_DEPTH,
  isSectionVisible,
  isSubsectionVisible,
  isValidSectionKey,
  isValidSubsectionKey,
  isValidVisibility,
  subsectionDepth,
  subsectionParent,
} from "../appSectionVisibility";

describe("app section visibility", () => {
  it("visible_to_all is visible for regular users and admins", () => {
    expect(isSectionVisible("visible_to_all", false)).toBe(true);
    expect(isSectionVisible("visible_to_all", true)).toBe(true);
  });

  it("admin_only is hidden from regular users, visible to admins", () => {
    expect(isSectionVisible("admin_only", false)).toBe(false);
    expect(isSectionVisible("admin_only", true)).toBe(true);
  });

  it("hidden is hidden from everyone (including admins) in the public menu", () => {
    expect(isSectionVisible("hidden", false)).toBe(false);
    expect(isSectionVisible("hidden", true)).toBe(false);
  });

  it("disabled section is never visible to regular users", () => {
    expect(isSectionVisible("visible_to_all", false, false)).toBe(false);
    expect(isSectionVisible("admin_only", true, false)).toBe(false);
  });

  it("validates section keys", () => {
    expect(isValidSectionKey("weekly_challenge")).toBe(true);
    expect(isValidSectionKey("season_predictions")).toBe(true);
    expect(isValidSectionKey("not_a_section")).toBe(false);
    expect(isValidSectionKey(42)).toBe(false);
  });

  it("validates visibility values", () => {
    expect(isValidVisibility("visible_to_all")).toBe(true);
    expect(isValidVisibility("admin_only")).toBe(true);
    expect(isValidVisibility("hidden")).toBe(true);
    expect(isValidVisibility("invisible")).toBe(false);
    expect(isValidVisibility(null)).toBe(false);
  });

  it("includes weekly_challenge as a known section", () => {
    expect(APP_SECTION_KEYS).toContain("weekly_challenge");
    expect(APP_SECTION_KEYS).toContain("season_predictions");
  });
});

describe("app subsection visibility", () => {
  it("validates subsection keys", () => {
    expect(isValidSubsectionKey("season_predictions.european_cups")).toBe(true);
    expect(isValidSubsectionKey("season_predictions.top_leagues")).toBe(true);
    expect(isValidSubsectionKey("season_predictions")).toBe(false);
    expect(isValidSubsectionKey("season_predictions.nope")).toBe(false);
    expect(isValidSubsectionKey(42)).toBe(false);
  });

  it("resolves the parent section of a subsection", () => {
    expect(subsectionParent("season_predictions.european_cups")).toBe("season_predictions");
    expect(subsectionParent("shop.exchange")).toBe("shop");
    expect(subsectionParent("not_a_key")).toBe(null);
  });

  it("every subsection points at a known parent and is namespaced under it", () => {
    const subsectionKeys = new Set(APP_SUBSECTIONS.map((s) => s.key));
    for (const def of APP_SUBSECTIONS) {
      // The parent is either a top-level section or another subsection.
      const knownParent = (APP_SECTION_KEYS as readonly string[]).includes(def.parent) || subsectionKeys.has(def.parent);
      expect(knownParent).toBe(true);
      expect(def.key.startsWith(def.parent + ".")).toBe(true);
      expect(def.title.length).toBeGreaterThan(0);
    }
  });

  it("nests the season task groups under the season tasks tab", () => {
    for (const key of ["tasks.season.start", "tasks.season.top5", "tasks.season.europe"]) {
      expect(isValidSubsectionKey(key)).toBe(true);
      expect(subsectionParent(key)).toBe("tasks.season");
      expect(subsectionDepth(key)).toBe(2);
    }
    expect(subsectionDepth("tasks.season")).toBe(1);
  });

  it("depth order puts every parent before its children", () => {
    const seen = new Set<string>();
    for (const def of APP_SUBSECTIONS_BY_DEPTH) {
      // A subsection parent must already be resolved when this row is reached.
      if (subsectionDepth(def.key) > 1) expect(seen.has(def.parent)).toBe(true);
      seen.add(def.key);
    }
    expect(APP_SUBSECTIONS_BY_DEPTH.length).toBe(APP_SUBSECTIONS.length);
  });

  it("subsection keys are unique", () => {
    const keys = APP_SUBSECTIONS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a hidden parent hides the subsection whatever its own setting is", () => {
    for (const visibility of APP_SECTION_VISIBILITY_VALUES) {
      expect(isSubsectionVisible(visibility, false, true, false)).toBe(false);
      expect(isSubsectionVisible(visibility, true, true, false)).toBe(false);
    }
  });

  it("with a visible parent the subsection follows its own rule", () => {
    expect(isSubsectionVisible("visible_to_all", false, true, true)).toBe(true);
    expect(isSubsectionVisible("admin_only", false, true, true)).toBe(false);
    expect(isSubsectionVisible("admin_only", true, true, true)).toBe(true);
    expect(isSubsectionVisible("hidden", true, true, true)).toBe(false);
    expect(isSubsectionVisible("visible_to_all", true, false, true)).toBe(false);
  });
});

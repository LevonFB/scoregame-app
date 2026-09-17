import { describe, expect, it } from "vitest";
import { parseBoolFlag, parseIntFlag, resolveApiFlags } from "../featureFlags";

describe("parseBoolFlag (explicit, typo-safe)", () => {
  it("missing value (undefined/null) returns the default", () => {
    expect(parseBoolFlag(undefined, false)).toBe(false);
    expect(parseBoolFlag(undefined, true)).toBe(true);
    expect(parseBoolFlag(null, true)).toBe(true);
  });

  it('empty / whitespace string returns the default', () => {
    expect(parseBoolFlag("", true)).toBe(true);
    expect(parseBoolFlag("   ", false)).toBe(false);
  });

  it('recognized true tokens parse to true', () => {
    for (const v of ["true", "1", "yes", "on"]) {
      expect(parseBoolFlag(v, false)).toBe(true);
    }
  });

  it('recognized false tokens parse to false (this is the Boolean(env.X) trap)', () => {
    for (const v of ["false", "0", "no", "off"]) {
      expect(parseBoolFlag(v, true)).toBe(false);
    }
  });

  it('is case-insensitive and trims', () => {
    expect(parseBoolFlag("  TRUE ", false)).toBe(true);
    expect(parseBoolFlag("False", true)).toBe(false);
    expect(parseBoolFlag("On", false)).toBe(true);
  });

  it('unknown value cannot accidentally flip a flag — returns default', () => {
    expect(parseBoolFlag("enabled", false)).toBe(false);
    expect(parseBoolFlag("yep", false)).toBe(false);
    expect(parseBoolFlag("2", false)).toBe(false);
    expect(parseBoolFlag("truthy", true)).toBe(true);
  });
});

describe("parseIntFlag (NaN + bounds safe)", () => {
  const opts = { def: 2, min: 1, max: 60 };

  it("missing / empty returns default", () => {
    expect(parseIntFlag(undefined, opts)).toBe(2);
    expect(parseIntFlag("", opts)).toBe(2);
    expect(parseIntFlag("   ", opts)).toBe(2);
  });

  it("valid integer within range is returned", () => {
    expect(parseIntFlag("5", opts)).toBe(5);
    expect(parseIntFlag(" 10 ", opts)).toBe(10);
    expect(parseIntFlag("1", opts)).toBe(1);
    expect(parseIntFlag("60", opts)).toBe(60);
  });

  it("NaN / non-numeric returns default", () => {
    expect(parseIntFlag("abc", opts)).toBe(2);
    expect(parseIntFlag("2x", opts)).toBe(2);
    expect(parseIntFlag("2.5", opts)).toBe(2);
    expect(parseIntFlag("NaN", opts)).toBe(2);
  });

  it("below min / above max is rejected to default (not clamped)", () => {
    expect(parseIntFlag("0", opts)).toBe(2);
    expect(parseIntFlag("-3", opts)).toBe(2);
    expect(parseIntFlag("61", opts)).toBe(2);
    expect(parseIntFlag("100000", opts)).toBe(2);
  });
});

describe("resolveApiFlags defaults preserve current behavior", () => {
  it("with no env, defaults match documented current behavior", () => {
    const f = resolveApiFlags(undefined);
    // V2 / new paths OFF
    expect(f.useScopedLeaderboardOnStartup).toBe(false);
    expect(f.dailyCaseBackfillV2).toBe(false);
    expect(f.questEventSyncV2).toBe(false);
    expect(f.questEventSyncShadow).toBe(false);
    expect(f.weeklyFinalizerV2).toBe(false);
    // current-behavior flags ON
    expect(f.dailyCaseLazyFallback).toBe(true);
    expect(f.weeklyGetFallback).toBe(true);
  });

  it("empty object env yields the same safe defaults", () => {
    expect(resolveApiFlags({})).toEqual(resolveApiFlags(undefined));
  });

  it("a garbage string cannot enable a V2 flag", () => {
    const f = resolveApiFlags({ QUEST_EVENT_SYNC_V2_ENABLED: "enable-please" });
    expect(f.questEventSyncV2).toBe(false);
  });

  it("shadow mode stays off by default even if set to a bad value", () => {
    const f = resolveApiFlags({ QUEST_EVENT_SYNC_SHADOW_MODE: "maybe" });
    expect(f.questEventSyncShadow).toBe(false);
  });

  it("an explicit valid true enables exactly one flag and nothing else", () => {
    const f = resolveApiFlags({ USE_SCOPED_LEADERBOARD_ON_STARTUP: "true" });
    expect(f.useScopedLeaderboardOnStartup).toBe(true);
    expect(f.weeklyFinalizerV2).toBe(false);
  });

  it("explicit false can turn off a current-behavior flag", () => {
    const f = resolveApiFlags({ WEEKLY_GET_FALLBACK_ENABLED: "false" });
    expect(f.weeklyGetFallback).toBe(false);
  });
});

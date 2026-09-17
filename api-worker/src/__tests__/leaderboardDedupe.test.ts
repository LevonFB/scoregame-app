// Stage 9 — unit tests for the leaderboard in-flight deduper + key builders.

import { describe, expect, it } from "vitest";
import { InFlightDeduper, buildGlobalLeaderboardKey, buildLeagueLeaderboardKey } from "../leaderboardDedupe";
import { resolveApiFlags } from "../featureFlags";

describe("Stage 9 — flag defaults", () => {
  it("home flags default to current behavior (off)", () => {
    const f = resolveApiFlags({});
    expect(f.homeRatingDedupeV2).toBe(false);
    expect(f.homeLeaguesLazyLoadV2).toBe(false);
  });
  it("garbage cannot enable a home flag", () => {
    expect(resolveApiFlags({ HOME_RATING_DEDUPE_V2_ENABLED: "maybe" }).homeRatingDedupeV2).toBe(false);
    expect(resolveApiFlags({ HOME_RATING_DEDUPE_V2_ENABLED: "true" }).homeRatingDedupeV2).toBe(true);
    expect(resolveApiFlags({ HOME_LEAGUES_LAZY_LOAD_V2_ENABLED: "1" }).homeLeaguesLazyLoadV2).toBe(true);
  });
});

describe("Stage 9 — dedupe keys", () => {
  it("global key isolates period / season / viewer", () => {
    expect(buildGlobalLeaderboardKey("season", 1, 5)).toBe("global|season|1|5");
    expect(buildGlobalLeaderboardKey("day:2026-06-18", 1, 5)).not.toBe(buildGlobalLeaderboardKey("season", 1, 5));
    expect(buildGlobalLeaderboardKey("season", 1, 5)).not.toBe(buildGlobalLeaderboardKey("season", 1, 6)); // different viewer
    expect(buildGlobalLeaderboardKey("season", 1, null)).toBe("global|season|1|anon");
  });
  it("league key isolates league / period / viewer", () => {
    expect(buildLeagueLeaderboardKey("L1", "season", 1, 5)).toBe("league|L1|season|1|5");
    expect(buildLeagueLeaderboardKey("L1", "season", 1, 5)).not.toBe(buildLeagueLeaderboardKey("L2", "season", 1, 5));
  });
});

describe("Stage 9 — InFlightDeduper", () => {
  it("default (no dedupe) is not exercised here; deduper coalesces concurrent same-key", async () => {
    const d = new InFlightDeduper();
    let calls = 0;
    let resolveFn: (v: number) => void = () => {};
    const fn = () => { calls++; return new Promise<number>((res) => { resolveFn = res; }); };
    const p1 = d.run("k", fn);
    const p2 = d.run("k", fn); // attaches to in-flight
    expect(d.size()).toBe(1);
    resolveFn(42);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(calls).toBe(1);              // computed once
    expect(r1.value).toBe(42);
    expect(r2.value).toBe(42);
    expect(r1.coalesced).toBe(false);
    expect(r2.coalesced).toBe(true);   // second attached
    expect(d.size()).toBe(0);          // cleared after settle
  });

  it("different keys do NOT coalesce (different viewers/scopes)", async () => {
    const d = new InFlightDeduper();
    let calls = 0;
    const fn = () => { calls++; return Promise.resolve(1); };
    await Promise.all([d.run("a", fn), d.run("b", fn)]);
    expect(calls).toBe(2);
  });

  it("error clears the in-flight entry → retry recomputes", async () => {
    const d = new InFlightDeduper();
    let calls = 0;
    const failing = () => { calls++; return Promise.reject(new Error("boom")); };
    await expect(d.run("k", failing)).rejects.toThrow("boom");
    expect(d.size()).toBe(0);
    const ok = () => { calls++; return Promise.resolve(7); };
    const r = await d.run("k", ok);
    expect(r.value).toBe(7);
    expect(calls).toBe(2); // recomputed after error
  });

  it("sequential (non-overlapping) calls recompute (no time cache)", async () => {
    const d = new InFlightDeduper();
    let calls = 0;
    const fn = () => { calls++; return Promise.resolve(1); };
    await d.run("k", fn);
    await d.run("k", fn);
    expect(calls).toBe(2);
  });
});

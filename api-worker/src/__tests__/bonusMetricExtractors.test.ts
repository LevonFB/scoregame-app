// Cards used to be readable only from the /incidents shape, so a card question on a
// match whose goals were already known (=> /incidents never fetched) could not
// auto-resolve even though /statistics had been fetched for corners. Both shapes must
// work, and neither metric may pick up a single half instead of the full match.

import { describe, expect, it } from "vitest";
import { extractAllSportsCardCount, extractAllSportsCornerCount, goalCannotHaveAssist } from "../index";

// footapi7 /api/match/{id}/statistics: the same metric repeats per period.
const statistics = {
  statistics: [
    {
      period: "ALL",
      groups: [
        { groupName: "Match overview", statisticsItems: [{ name: "Corner kicks", home: "7", away: "4" }] },
        {
          groupName: "Discipline",
          statisticsItems: [
            { name: "Yellow cards", home: "3", away: "2" },
            { name: "Red cards", home: "1", away: "0" },
          ],
        },
      ],
    },
    {
      period: "1ST",
      groups: [
        { groupName: "Match overview", statisticsItems: [{ name: "Corner kicks", home: "3", away: "1" }] },
        { groupName: "Discipline", statisticsItems: [{ name: "Yellow cards", home: "1", away: "0" }] },
      ],
    },
    {
      period: "2ND",
      groups: [
        { groupName: "Match overview", statisticsItems: [{ name: "Corner kicks", home: "4", away: "3" }] },
        { groupName: "Discipline", statisticsItems: [{ name: "Yellow cards", home: "2", away: "2" }] },
      ],
    },
  ],
};

// footapi7 /api/match/{id}/incidents: one object per card. The live feed puts the
// colour in `incidentClass` — the same field that carries "penalty"/"ownGoal" on goals.
const incidents = {
  incidents: [
    { incidentType: "card", incidentClass: "yellow", playerName: "A", reason: "Foul" },
    { incidentType: "card", incidentClass: "yellow", playerName: "B", reason: "Foul" },
    { incidentType: "card", incidentClass: "red", playerName: "C", reason: "Violent conduct" },
    { incidentType: "goal", player: { name: "D" } },
  ],
};

describe("card counts from provider statistics", () => {
  it("sums home and away for yellow cards", () => {
    expect(extractAllSportsCardCount(statistics, "yellow")).toBe(5);
  });

  it("sums home and away for red cards without counting yellows", () => {
    expect(extractAllSportsCardCount(statistics, "red")).toBe(1);
  });

  it("takes the full match, not the last period walked", () => {
    // 2ND alone would be 4 yellows and 7 corners — the halves must not win.
    expect(extractAllSportsCardCount(statistics, "yellow")).toBe(5);
    expect(extractAllSportsCornerCount(statistics)).toBe(11);
  });

  it("falls back to the largest total when periods are unlabelled", () => {
    const unlabelled = {
      groups: [
        { statisticsItems: [{ name: "Yellow cards", home: "1", away: "0" }] },
        { statisticsItems: [{ name: "Yellow cards", home: "3", away: "2" }] },
      ],
    };
    expect(extractAllSportsCardCount(unlabelled, "yellow")).toBe(5);
  });
});

describe("card counts from provider incidents", () => {
  it("still counts card incidents when no statistics are present", () => {
    expect(extractAllSportsCardCount(incidents, "yellow")).toBe(2);
    expect(extractAllSportsCardCount(incidents, "red")).toBe(1);
  });

  it("returns null when the provider carries no card data at all", () => {
    // null keeps the question open for a later pass instead of resolving a false "no".
    expect(extractAllSportsCardCount({ incidents: [{ incidentType: "goal" }] }, "yellow")).toBeNull();
    expect(extractAllSportsCardCount({}, "yellow")).toBeNull();
  });

  it("does not report zero cards as absent data", () => {
    // A match with a red card but no yellows must answer 0, not null.
    const redOnly = { incidents: [{ incidentType: "card", incidentClass: "red", playerName: "A" }] };
    expect(extractAllSportsCardCount(redOnly, "yellow")).toBe(0);
  });

  it("still reads the legacy cardType shape", () => {
    const legacy = { incidents: [{ incidentType: "card", cardType: "yellow", player: { name: "A" } }] };
    expect(extractAllSportsCardCount(legacy, "yellow")).toBe(1);
  });

  it("counts a second yellow as a red, not as a yellow", () => {
    const secondYellow = { incidents: [{ incidentType: "card", incidentClass: "yellowRed", playerName: "A" }] };
    expect(extractAllSportsCardCount(secondYellow, "red")).toBe(1);
    expect(extractAllSportsCardCount(secondYellow, "yellow")).toBe(0);
  });

  it("returns null when card incidents are present but their colour is unreadable", () => {
    // The Newcastle - Liverpool 2026-08-23 regression: cards were in the feed under a
    // field we did not read, so every one counted as zero and "5+ yellows?" resolved to
    // a false "no". Unknown colour must read as "no answer yet" so the caller falls back
    // to /statistics, never as zero.
    const unreadable = {
      incidents: [
        { incidentType: "card", playerName: "A", reason: "Foul" },
        { incidentType: "card", playerName: "B", reason: "Foul" },
      ],
    };
    expect(extractAllSportsCardCount(unreadable, "yellow")).toBeNull();
    expect(extractAllSportsCardCount(unreadable, "red")).toBeNull();
  });

  it("prefers the statistics total even when incidents are unreadable", () => {
    const both = { ...statistics, incidents: [{ incidentType: "card", playerName: "A" }] };
    expect(extractAllSportsCardCount(both, "yellow")).toBe(5);
  });
});

describe("goals that rule an assist out", () => {
  it("recognises penalties and own goals in the shapes the provider uses", () => {
    expect(goalCannotHaveAssist({ incidentClass: "penalty" })).toBe(true);
    expect(goalCannotHaveAssist({ incidentClass: "ownGoal" })).toBe(true);
    expect(goalCannotHaveAssist({ incident_class: "own_goal" })).toBe(true);
    expect(goalCannotHaveAssist({ goalType: "Penalty" })).toBe(true);
  });

  it("treats a regular or unlabelled goal as one that could have had an assist", () => {
    // The absent-field case is what keeps an unknown feed from resolving a false "no".
    expect(goalCannotHaveAssist({ incidentClass: "regular" })).toBe(false);
    expect(goalCannotHaveAssist({ player: { name: "A" } })).toBe(false);
    expect(goalCannotHaveAssist({})).toBe(false);
  });
});

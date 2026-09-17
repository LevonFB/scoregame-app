import { describe, expect, it } from "vitest";
import {
  extractPlayerPositionFromRow,
  isEligibleForAward,
  normalizePlayerNameForSearch,
  normalizePlayerPosition,
} from "../seasonPredictionPlayers";

describe("season prediction player catalog helpers", () => {
  it("normalizes common player positions", () => {
    expect(normalizePlayerPosition("GK")).toBe("goalkeeper");
    expect(normalizePlayerPosition("G")).toBe("goalkeeper");
    expect(normalizePlayerPosition("Вратарь")).toBe("goalkeeper");
    expect(normalizePlayerPosition("Centre-Back")).toBe("defender");
    expect(normalizePlayerPosition("CB")).toBe("defender");
    expect(normalizePlayerPosition("D")).toBe("defender");
    expect(normalizePlayerPosition("DM")).toBe("midfielder");
    expect(normalizePlayerPosition("CM")).toBe("midfielder");
    expect(normalizePlayerPosition("M")).toBe("midfielder");
    expect(normalizePlayerPosition("Attacking Midfield")).toBe("midfielder");
    expect(normalizePlayerPosition("Winger")).toBe("forward");
    expect(normalizePlayerPosition("ST")).toBe("forward");
    expect(normalizePlayerPosition("LW")).toBe("forward");
    expect(normalizePlayerPosition("RW")).toBe("forward");
    expect(normalizePlayerPosition("F")).toBe("forward");
    expect(normalizePlayerPosition("Mystery")).toBe("unknown");
  });

  it("normalizes the Football-Data full position strings that caused unknowns", () => {
    // These are exactly the values that previously fell through to "unknown".
    expect(normalizePlayerPosition("Central Midfield")).toBe("midfielder");
    expect(normalizePlayerPosition("Defensive Midfield")).toBe("midfielder");
    expect(normalizePlayerPosition("Centre-Forward")).toBe("forward");
    expect(normalizePlayerPosition("Centre-Back")).toBe("defender");
    expect(normalizePlayerPosition("Left-Back")).toBe("defender");
    expect(normalizePlayerPosition("Right Winger")).toBe("forward");
    expect(normalizePlayerPosition("Goalkeeper")).toBe("goalkeeper");
    expect(normalizePlayerPosition("Offence")).toBe("forward");
    expect(normalizePlayerPosition("Defence")).toBe("defender");
    expect(normalizePlayerPosition("Midfield")).toBe("midfielder");
  });

  it("keeps a goalkeeper from ever becoming an outfielder", () => {
    expect(normalizePlayerPosition("Goalkeeper")).toBe("goalkeeper");
    expect(normalizePlayerPosition("вратарь")).toBe("goalkeeper");
    // Wing-back is a defender, not a forward, despite containing "wing".
    expect(normalizePlayerPosition("Wing-Back")).toBe("defender");
  });

  it("recognizes Russian position labels", () => {
    expect(normalizePlayerPosition("Защитник")).toBe("defender");
    expect(normalizePlayerPosition("Полузащитник")).toBe("midfielder");
    expect(normalizePlayerPosition("Нападающий")).toBe("forward");
    expect(normalizePlayerPosition("Форвард")).toBe("forward");
    expect(normalizePlayerPosition("Голкипер")).toBe("goalkeeper");
  });

  it("extractPlayerPositionFromRow prefers explicit Position field", () => {
    expect(extractPlayerPositionFromRow({ Position: "Goalkeeper", role: "x" })).toBe("Goalkeeper");
    expect(extractPlayerPositionFromRow({ position: "Striker" })).toBe("Striker");
  });

  it("extractPlayerPositionFromRow falls back to role/type when position empty", () => {
    expect(extractPlayerPositionFromRow({ position: "", role: "Midfielder" })).toBe("Midfielder");
    expect(extractPlayerPositionFromRow({ player_type: "Defender" })).toBe("Defender");
    expect(extractPlayerPositionFromRow({ pos: "GK" })).toBe("GK");
  });

  it("extractPlayerPositionFromRow reads nested metadata", () => {
    expect(extractPlayerPositionFromRow({ metadata: { position: "Centre-Back" } })).toBe("Centre-Back");
    expect(extractPlayerPositionFromRow({ metadata: { statistics: { position: "Right Winger" } } })).toBe("Right Winger");
    expect(extractPlayerPositionFromRow({ metadata_json: { player: { type: "Goalkeeper" } } })).toBe("Goalkeeper");
    expect(extractPlayerPositionFromRow({ position: { name: "Forward" } })).toBe("Forward");
  });

  it("extractPlayerPositionFromRow returns null when nothing usable is present", () => {
    expect(extractPlayerPositionFromRow({ player_name: "John" })).toBeNull();
    expect(extractPlayerPositionFromRow({ position: "", role: "" })).toBeNull();
    expect(extractPlayerPositionFromRow(null)).toBeNull();
  });

  it("checks award eligibility by position group", () => {
    expect(isEligibleForAward("top_scorer", { position_group: "forward" })).toBe(true);
    expect(isEligibleForAward("top_assistant", { position_group: "midfielder" })).toBe(true);
    expect(isEligibleForAward("top_assister", { position_group: "goalkeeper" })).toBe(false);
    expect(isEligibleForAward("golden_glove", { position_group: "goalkeeper" })).toBe(true);
    expect(isEligibleForAward("golden_glove", { position_group: "defender" })).toBe(false);
    expect(isEligibleForAward("top_scorer", { position_group: "unknown" })).toBe(false);
    expect(isEligibleForAward("golden_glove", { position_group: "unknown" })).toBe(false);
  });

  it("does not let a goalkeeper into scorer/assister, only golden_glove", () => {
    expect(isEligibleForAward("top_scorer", { position_group: "goalkeeper" })).toBe(false);
    expect(isEligibleForAward("top_assister", { position_group: "goalkeeper" })).toBe(false);
    expect(isEligibleForAward("golden_glove", { position_group: "forward" })).toBe(false);
  });

  it("normalizes player names for matching and search", () => {
    expect(normalizePlayerNameForSearch("  João  Félix ")).toBe("joao felix");
  });
});

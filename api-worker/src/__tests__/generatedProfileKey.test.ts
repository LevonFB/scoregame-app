import { describe, expect, it } from "vitest";
import { parseGeneratedProfileKeyUserId } from "../generatedProfileKey";

// Mirrors buildGeneratedNickname + normalizeNicknameKey from index.ts:
// `Player${id.toString(36).toUpperCase()}` normalized to lowercase.
function generatedKeyFor(userId: number): string {
  return `player${userId.toString(36)}`;
}

describe("parseGeneratedProfileKeyUserId", () => {
  it("round-trips generated keys back to the user id", () => {
    for (const id of [1, 9, 35, 36, 37, 777000, 123456789, 6_500_000_000]) {
      expect(parseGeneratedProfileKeyUserId(generatedKeyFor(id))).toBe(id);
    }
  });

  it("rejects keys that are not in the generated format", () => {
    expect(parseGeneratedProfileKeyUserId("")).toBeNull();
    expect(parseGeneratedProfileKeyUserId("player")).toBeNull();
    expect(parseGeneratedProfileKeyUserId("somebody")).toBeNull();
    expect(parseGeneratedProfileKeyUserId("playerX1")).toBeNull(); // input is pre-lowercased
    expect(parseGeneratedProfileKeyUserId("player-1")).toBeNull();
    expect(parseGeneratedProfileKeyUserId("player 1")).toBeNull();
  });

  it("rejects non-canonical spellings so the mapping stays one-to-one", () => {
    expect(parseGeneratedProfileKeyUserId("player0")).toBeNull();
    expect(parseGeneratedProfileKeyUserId("player01")).toBeNull();
    expect(parseGeneratedProfileKeyUserId("player00z")).toBeNull();
    // Canonical form of the same id still parses.
    expect(parseGeneratedProfileKeyUserId("playerz")).toBe(35);
  });

  it("rejects values that overflow the safe integer range", () => {
    expect(parseGeneratedProfileKeyUserId(`player${"z".repeat(15)}`)).toBeNull();
  });
});

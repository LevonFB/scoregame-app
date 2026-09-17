import { describe, expect, it } from "vitest";
import {
  BALLON_DOR_NOMINEE_COUNT,
  ballonDorPlaceById,
  sanitizeBallonDorRanking,
  sanitizeBallonDorSlots,
  validateBallonDorSubmit,
} from "../ballonDor";

const IDS = Array.from({ length: BALLON_DOR_NOMINEE_COUNT }, (_, i) => String(i + 1));

describe("sanitizeBallonDorRanking", () => {
  it("keeps a full valid ranking in order", () => {
    const result = sanitizeBallonDorRanking({ ranking: IDS }, IDS);
    expect(result.ranking).toEqual(IDS);
  });

  it("accepts a bare array as well as {ranking}", () => {
    expect(sanitizeBallonDorRanking(IDS, IDS).ranking).toEqual(IDS);
    expect(sanitizeBallonDorRanking({ player_ids: IDS }, IDS).ranking).toEqual(IDS);
  });

  it("accepts rows posted back verbatim", () => {
    const rows = IDS.map((id) => ({ id: Number(id), player_name: `p${id}` }));
    expect(sanitizeBallonDorRanking({ ranking: rows }, IDS).ranking).toEqual(IDS);
  });

  it("drops unknown ids, duplicates and empties", () => {
    const result = sanitizeBallonDorRanking({ ranking: ["1", "1", "999", "", null, "2"] }, IDS);
    expect(result.ranking).toEqual(["1", "2"]);
  });

  it("caps the list at the nominee count", () => {
    const tooMany = [...IDS, "1", "2"];
    expect(sanitizeBallonDorRanking({ ranking: tooMany }, IDS).ranking).toHaveLength(BALLON_DOR_NOMINEE_COUNT);
  });

  it("never throws on garbage — a draft may be partial or absent", () => {
    expect(sanitizeBallonDorRanking(null, IDS).ranking).toEqual([]);
    expect(sanitizeBallonDorRanking({ ranking: "nope" }, IDS).ranking).toEqual([]);
    expect(sanitizeBallonDorRanking({ ranking: ["3"] }, IDS).ranking).toEqual(["3"]);
  });
});

describe("validateBallonDorSubmit", () => {
  it("passes a complete ballot", () => {
    expect(() => validateBallonDorSubmit({ ranking: IDS }, IDS)).not.toThrow();
  });

  it("rejects an incomplete ballot", () => {
    expect(() => validateBallonDorSubmit({ ranking: IDS.slice(0, 29) }, IDS))
      .toThrow("BALLON_DOR_RANKING_INCOMPLETE");
  });

  it("rejects when nominees are not configured", () => {
    expect(() => validateBallonDorSubmit({ ranking: [] }, []))
      .toThrow("BALLON_DOR_NOMINEES_NOT_CONFIGURED");
  });

  it("rejects a ballot that misses a nominee even at full length", () => {
    // Same length, but "30" was replaced by a repeat — sanitize would have
    // dropped it, so this guards the direct-call path.
    const broken = [...IDS.slice(0, 29), "1"];
    expect(() => validateBallonDorSubmit({ ranking: broken }, IDS))
      .toThrow("BALLON_DOR_RANKING_DUPLICATE");
  });
});

describe("ballonDorPlaceById", () => {
  it("maps the first entry to 1st place", () => {
    const places = ballonDorPlaceById({ ranking: ["7", "3", "9"] });
    expect(places.get("7")).toBe(1);
    expect(places.get("9")).toBe(3);
    expect(places.has("1")).toBe(false);
  });
});

describe("sanitizeBallonDorSlots", () => {
  it("сохраняет пропуски: игрок на 2-м месте не съезжает на 1-е", () => {
    const slots = sanitizeBallonDorSlots({ slots: [null, "7"] }, IDS);
    expect(slots).toHaveLength(BALLON_DOR_NOMINEE_COUNT);
    expect(slots[0]).toBeNull();
    expect(slots[1]).toBe("7");
    expect(slots[2]).toBeNull();
  });

  it("длина всегда равна числу мест, чем бы ни кормили", () => {
    expect(sanitizeBallonDorSlots(null, IDS)).toHaveLength(BALLON_DOR_NOMINEE_COUNT);
    expect(sanitizeBallonDorSlots({ slots: "мусор" }, IDS)).toHaveLength(BALLON_DOR_NOMINEE_COUNT);
    expect(sanitizeBallonDorSlots({ slots: IDS.concat(IDS) }, IDS)).toHaveLength(BALLON_DOR_NOMINEE_COUNT);
  });

  it("повтор и неизвестный id гасятся в пустое место, а не роняют черновик", () => {
    const slots = sanitizeBallonDorSlots({ slots: ["3", "3", "999", "4"] }, IDS);
    expect(slots[0]).toBe("3");
    expect(slots[1]).toBeNull();
    expect(slots[2]).toBeNull();
    expect(slots[3]).toBe("4");
  });

  it("принимает голый массив и строки-объекты", () => {
    expect(sanitizeBallonDorSlots([null, { id: 5 }], IDS)[1]).toBe("5");
  });

  it("полный бюллетень переживает круг сериализации без сдвигов", () => {
    expect(sanitizeBallonDorSlots({ slots: IDS }, IDS)).toEqual(IDS);
  });
});

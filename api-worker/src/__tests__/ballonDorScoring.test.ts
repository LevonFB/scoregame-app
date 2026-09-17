import { describe, expect, it } from "vitest";
import {
  BALLON_DOR_V1_CONFIG,
  computeBallonDorMaxPoints,
  scoreBallonDorEntry,
} from "../ballonDorScoring";

const OFFICIAL = Array.from({ length: 30 }, (_, i) => String(i + 1));
const C = BALLON_DOR_V1_CONFIG;

function score(userRanking: string[]) {
  return scoreBallonDorEntry({ userRanking, officialRanking: OFFICIAL });
}

/** Меняет местами элементы i и j (1-based позиции). */
function swap(list: string[], i: number, j: number): string[] {
  const next = [...list];
  [next[i - 1], next[j - 1]] = [next[j - 1], next[i - 1]];
  return next;
}

describe("scoreBallonDorEntry — база", () => {
  it("3 очка за каждое совпавшее место", () => {
    // Меняем местами 29-е и 30-е: 28 мест угаданы.
    const res = score(swap(OFFICIAL, 29, 30));
    expect(res.exact_places).toBe(28);
    expect(res.place_points).toBe(28 * C.pointsPerExactPlace);
  });

  it("полностью обратный порядок не даёт ни одного места", () => {
    const res = score([...OFFICIAL].reverse());
    expect(res.exact_places).toBe(0);
    expect(res.place_points).toBe(0);
    expect(res.total_points).toBe(0);
  });

  it("идеальный бюллетень берёт потолок", () => {
    const res = score(OFFICIAL);
    expect(res.total_points).toBe(computeBallonDorMaxPoints(30));
    expect(res.points_pct).toBe(1);
    expect(res.top30_exact).toBe(1);
  });
});

describe("scoreBallonDorEntry — бонусы", () => {
  it("обладатель засчитывается по первой позиции", () => {
    const res = score([...OFFICIAL].slice(0, 1).concat([...OFFICIAL].slice(1).reverse()));
    expect(res.winner_correct).toBe(1);
    expect(res.breakdown).toMatchObject({ bonuses: { winner: C.winnerBonus } });
  });

  it("топ-3 засчитывается по именам, порядок внутри тройки не важен", () => {
    // Тройка переставлена внутри себя, дальше всё на местах.
    const user = swap(swap(OFFICIAL, 1, 3), 1, 2);
    const res = score(user);
    expect(res.top3_names_correct).toBe(1);
    // Порядок внутри тройки сломан ⇒ ни обладателя, ни точных тиров.
    expect(res.winner_correct).toBe(0);
    expect(res.top5_exact).toBe(0);
  });

  it("чужое имя в тройке снимает бонус топ-3", () => {
    const res = score(swap(OFFICIAL, 3, 4));
    expect(res.top3_names_correct).toBe(0);
  });

  it("тиры по местам вложены и складываются", () => {
    // Точны первые 10, дальше 11 и 12 переставлены.
    const res = score(swap(OFFICIAL, 11, 12));
    expect(res.top5_exact).toBe(1);
    expect(res.top10_exact).toBe(1);
    expect(res.top30_exact).toBe(0);
    expect(res.bonus_points).toBe(C.winnerBonus + C.top3NamesBonus + C.top5ExactBonus + C.top10ExactBonus);
  });

  it("сломанное 5-е место снимает топ-5 и топ-10, но не топ-3", () => {
    const res = score(swap(OFFICIAL, 5, 6));
    expect(res.top3_names_correct).toBe(1);
    expect(res.winner_correct).toBe(1);
    expect(res.top5_exact).toBe(0);
    expect(res.top10_exact).toBe(0);
  });
});

describe("scoreBallonDorEntry — неполные и битые данные", () => {
  it("неполный бюллетень не берёт тир, до которого не дотянулся", () => {
    const res = score(OFFICIAL.slice(0, 3));
    expect(res.exact_places).toBe(3);
    expect(res.top3_names_correct).toBe(1);
    expect(res.winner_correct).toBe(1);
    expect(res.top5_exact).toBe(0);
    expect(res.top30_exact).toBe(0);
  });

  it("пустой официальный результат не начисляет ничего", () => {
    const res = scoreBallonDorEntry({ userRanking: OFFICIAL, officialRanking: [] });
    expect(res.total_points).toBe(0);
    expect(res.top30_exact).toBe(0);
    expect(res.warnings).toContain("OFFICIAL_RANKING_EMPTY");
  });

  it("принимает обёртку {ranking} и строки объектов", () => {
    const rows = OFFICIAL.map((id) => ({ id: Number(id) }));
    const res = scoreBallonDorEntry({ userRanking: { ranking: rows }, officialRanking: { ranking: OFFICIAL } });
    expect(res.top30_exact).toBe(1);
  });

  it("дубликаты в бюллетене схлопываются и не накручивают места", () => {
    const res = score(["1", "1", "2", "3"]);
    expect(res.exact_places).toBe(3);
  });
});

describe("разброс очков", () => {
  it("случайная расстановка далеко позади осмысленной", () => {
    // Ни одного совпадения — то, что даёт полностью незнающий игрок.
    const blind = scoreBallonDorEntry({ userRanking: [...OFFICIAL].reverse(), officialRanking: OFFICIAL });
    // Угадал обладателя и состав тройки, дальше порядок случаен.
    const informed = score(["1", "3", "2", ...[...OFFICIAL].slice(3).reverse()]);
    expect(informed.total_points).toBeGreaterThan(blind.total_points + 20);
    expect(informed.winner_correct).toBe(1);
    expect(informed.top3_names_correct).toBe(1);
  });
});

// «Минута первого гола» резолвится только из footapi7 /api/match/{id}/incidents: в отличие
// от «кто откроет счёт», минуту нельзя вывести из финального счёта. Фикстуры ниже — форма,
// снятая с живого фида 19.08.2026 (матчи Пиза — Эмполи, Бёрнли — Вест Хэм, Утрехт — АЗ):
//   - массив приходит в ОБРАТНОМ хронологическом порядке;
//   - `time` есть у каждого гола, `addedTime` — только у событий в компенсированное время;
//   - серия пенальти лежит отдельным incidentType и в голы попадать не должна.

import { describe, expect, it } from "vitest";
import { firstGoalMinuteBandKey, FIRST_GOAL_MINUTE_NONE_ANSWER } from "../index";

// Повторяет отбор и сортировку голов из fetchAllSportsMatchIncidents.
function firstGoal(incidents: any[]) {
  return incidents
    .filter((i) => String(i?.incidentType || "").toLowerCase() === "goal")
    .sort((a, b) =>
      (Number(a?.time ?? 999) - Number(b?.time ?? 999))
      || (Number(a?.addedTime ?? 0) - Number(b?.addedTime ?? 0))
    )[0];
}

describe("firstGoalMinuteBandKey", () => {
  it("раскладывает минуты основного времени по интервалам", () => {
    expect(firstGoalMinuteBandKey(1)).toBe("1_30");
    expect(firstGoalMinuteBandKey(30)).toBe("1_30");
    expect(firstGoalMinuteBandKey(31)).toBe("31_60");
    expect(firstGoalMinuteBandKey(60)).toBe("31_60");
    expect(firstGoalMinuteBandKey(61)).toBe("61_90");
    expect(firstGoalMinuteBandKey(90)).toBe("61_90");
  });

  it("относит компенсированное время к своему тайму, а не к следующему интервалу", () => {
    // Провайдер отдаёт 45+2 как time=45, 90+4 как time=90 — базовая минута уже указывает
    // на нужный интервал, поэтому addedTime в расчёте интервала не участвует.
    expect(firstGoalMinuteBandKey(45)).toBe("31_60");
    expect(firstGoalMinuteBandKey(90)).toBe("61_90");
  });

  it("считает гол в дополнительное время как «гола не было»", () => {
    // results хранит счёт основного времени (strict-90min), и вопрос обязан отвечать
    // по той же границе — иначе ответ разойдётся с видимым в игре счётом.
    expect(firstGoalMinuteBandKey(91)).toBe(FIRST_GOAL_MINUTE_NONE_ANSWER);
    expect(firstGoalMinuteBandKey(105)).toBe(FIRST_GOAL_MINUTE_NONE_ANSWER);
    expect(firstGoalMinuteBandKey(120)).toBe(FIRST_GOAL_MINUTE_NONE_ANSWER);
  });

  it("не выдумывает ответ, когда минуты нет", () => {
    expect(firstGoalMinuteBandKey(null)).toBeNull();
    expect(firstGoalMinuteBandKey(undefined)).toBeNull();
    expect(firstGoalMinuteBandKey("")).toBeNull();
    expect(firstGoalMinuteBandKey(0)).toBeNull();
  });
});

describe("выбор первого гола из фида", () => {
  it("берёт самый ранний гол, а не первый элемент обратного массива", () => {
    // Пиза — Эмполи: 44' (хозяева) и 61' (гости), в фиде 61 идёт первым.
    const first = firstGoal([
      { incidentType: "period", text: "PEN", homeScore: 4, awayScore: 3, time: 999 },
      { incidentType: "goal", time: 61, isHome: false, incidentClass: "regular" },
      { incidentType: "period", text: "FT", homeScore: 1, awayScore: 1, time: 90 },
      { incidentType: "goal", time: 44, isHome: true, incidentClass: "regular" },
    ]);
    expect(first.time).toBe(44);
    expect(first.isHome).toBe(true);
    expect(firstGoalMinuteBandKey(first.time)).toBe("31_60");
  });

  it("различает гол на 45-й и гол на 45+2 в одну минуту", () => {
    // Без addedTime вторым ключом сортировки первым считался бы более поздний гол,
    // потому что фид отдаёт события в обратном порядке.
    const first = firstGoal([
      { incidentType: "goal", time: 45, addedTime: 2, isHome: false },
      { incidentType: "goal", time: 45, isHome: true },
    ]);
    expect(first.isHome).toBe(true);
    expect(first.addedTime).toBeUndefined();
  });

  it("не принимает удары серии пенальти за голы", () => {
    // Пиза — Эмполи ушла в серию: 9 инцидентов penaltyShootout при двух голах в матче.
    const first = firstGoal([
      { incidentType: "penaltyShootout", time: 999, isHome: true },
      { incidentType: "penaltyShootout", time: 999, isHome: false },
      { incidentType: "goal", time: 61, isHome: false },
      { incidentType: "goal", time: 44, isHome: true },
    ]);
    expect(first.time).toBe(44);
  });

  it("на матче без голов не даёт минуты вовсе", () => {
    const first = firstGoal([{ incidentType: "period", text: "FT", homeScore: 0, awayScore: 0, time: 90 }]);
    expect(first).toBeUndefined();
    expect(firstGoalMinuteBandKey(first?.time)).toBeNull();
  });
});

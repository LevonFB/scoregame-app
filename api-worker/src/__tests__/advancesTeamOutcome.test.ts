// Формы взяты из живых ответов footapi7 /api/match/{id} 26.08.2026 — см. проверку на
// 28 матчах (ЛЧ 24/25, квалификация ЛЧ 26/27, EFL Cup 24/25 и 25/26). Главное, что здесь
// закреплено: winnerCode в матче по пенальти врёт («ничья»), а первая нога пары не должна
// резолвиться вообще — иначе вопрос закроется за неделю до того, как ответ существует.

import { describe, expect, it } from "vitest";
import { extractAdvancesTeamOutcome } from "../index";

const finished = { code: 100, description: "Ended", type: "finished" };
const afterPens = { code: 120, description: "AP", type: "finished" };
const afterEt = { code: 110, description: "AET", type: "finished" };

describe("двухматчевая пара", () => {
  it("резолвит ответную ногу по aggregatedWinnerCode", () => {
    // 16707701 Bodø/Glimt — NEC Nijmegen, 25.08.2026
    expect(extractAdvancesTeamOutcome({
      status: finished,
      cupMatchesInRound: 2,
      previousLegEventId: 16707697,
      winnerCode: 1,
      aggregatedWinnerCode: 1,
      homeScore: { current: 3, normaltime: 3, aggregated: 3 },
      awayScore: { current: 1, normaltime: 1, aggregated: 2 },
    })).toBe("home");
  });

  it("верит aggregatedWinnerCode, а не сумме голов, когда пару решили пенальти", () => {
    // 13511924 Атлетико — Реал 24/25: aggregated 2:2, прошёл Реал (гости) 4:2 по пенальти.
    // Сравнение homeScore.aggregated с awayScore.aggregated дало бы ничью и null.
    expect(extractAdvancesTeamOutcome({
      status: afterPens,
      cupMatchesInRound: 2,
      previousLegEventId: 13511923,
      winnerCode: 1,
      aggregatedWinnerCode: 2,
      homeScore: { current: 3, normaltime: 1, penalties: 2, aggregated: 2 },
      awayScore: { current: 4, normaltime: 0, penalties: 4, aggregated: 2 },
    })).toBe("away");
  });

  it("резолвит ответную ногу, выигранную в дополнительное время", () => {
    // 16707696 Sabah — Hapoel Be'er Sheva, AET, агрегат 6:4
    expect(extractAdvancesTeamOutcome({
      status: afterEt,
      cupMatchesInRound: 2,
      previousLegEventId: 16707694,
      winnerCode: 1,
      aggregatedWinnerCode: 1,
      homeScore: { current: 5, normaltime: 3, overtime: 2, aggregated: 6 },
      awayScore: { current: 2, normaltime: 2, overtime: 0, aggregated: 4 },
    })).toBe("home");
  });

  it("НЕ резолвит первую ногу: ответа ещё не существует", () => {
    // 16707694 Hapoel Be'er Sheva — Sabah: хозяева выиграли 1:0, но прошли в итоге гости.
    // winnerCode=1 здесь описывает матч, а не пару, и принимать его за ответ нельзя.
    expect(extractAdvancesTeamOutcome({
      status: finished,
      cupMatchesInRound: 2,
      previousLegEventId: null,
      winnerCode: 1,
      homeScore: { current: 1, normaltime: 1 },
      awayScore: { current: 0, normaltime: 0 },
    })).toBeNull();
  });

  it("НЕ резолвит первую ногу даже при разгроме", () => {
    // 13513402 Бавария — Интер 24/25, первая нога четвертьфинала
    expect(extractAdvancesTeamOutcome({
      status: finished,
      cupMatchesInRound: 2,
      previousLegEventId: null,
      winnerCode: 2,
      homeScore: { current: 1, normaltime: 1 },
      awayScore: { current: 2, normaltime: 2 },
    })).toBeNull();
  });
});

describe("одиночный матч на вылет", () => {
  it("резолвит финал по winnerCode", () => {
    // 13516694 ПСЖ — Интер 5:0, финал ЛЧ 24/25
    expect(extractAdvancesTeamOutcome({
      status: finished,
      cupMatchesInRound: 1,
      previousLegEventId: null,
      winnerCode: 1,
      homeScore: { current: 5, normaltime: 5 },
      awayScore: { current: 0, normaltime: 0 },
    })).toBe("home");
  });

  it("читает серию пенальти, когда winnerCode называет ничью", () => {
    // 12785378 Walsall — Leicester, EFL Cup: winnerCode=3 при 0:3 по пенальти.
    // Ровно этот случай ломает наивную реализацию на одном winnerCode.
    expect(extractAdvancesTeamOutcome({
      status: afterPens,
      cupMatchesInRound: 1,
      previousLegEventId: null,
      winnerCode: 3,
      homeScore: { current: 0, normaltime: 0, penalties: 0 },
      awayScore: { current: 3, normaltime: 0, penalties: 3 },
    })).toBe("away");
  });

  it("читает серию пенальти при равном счёте основного времени", () => {
    // 12904463 Brentford — Sheffield Wednesday: 1:1, пенальти 5:4, winnerCode=3
    expect(extractAdvancesTeamOutcome({
      status: afterPens,
      cupMatchesInRound: 1,
      previousLegEventId: null,
      winnerCode: 3,
      homeScore: { current: 6, normaltime: 1, penalties: 5 },
      awayScore: { current: 5, normaltime: 1, penalties: 4 },
    })).toBe("home");
  });

  it("совпадает с winnerCode там, где провайдер его всё же заполнил", () => {
    // 12694085 Barrow — Derby: пенальти 3:2 и winnerCode=1 — источники не расходятся
    expect(extractAdvancesTeamOutcome({
      status: afterPens,
      cupMatchesInRound: 1,
      previousLegEventId: null,
      winnerCode: 1,
      homeScore: { current: 4, normaltime: 1, penalties: 3 },
      awayScore: { current: 3, normaltime: 1, penalties: 2 },
    })).toBe("home");
  });
});

describe("гейты", () => {
  it("не резолвит незавершённый матч", () => {
    expect(extractAdvancesTeamOutcome({
      status: { code: 7, description: "2nd half", type: "inprogress" },
      cupMatchesInRound: 1,
      winnerCode: 1,
      homeScore: { current: 2 },
      awayScore: { current: 0 },
    })).toBeNull();
  });

  it("не резолвит обычный матч лиги без cupMatchesInRound", () => {
    // Вопрос «кто пройдёт дальше» на таком матче смысла не имеет — и выдумывать ответ
    // из winnerCode нельзя: пройти там некуда.
    expect(extractAdvancesTeamOutcome({
      status: finished,
      winnerCode: 1,
      homeScore: { current: 2, normaltime: 2 },
      awayScore: { current: 0, normaltime: 0 },
    })).toBeNull();
  });

  it("не резолвит одиночный матч, где winnerCode=3 и серии не было", () => {
    expect(extractAdvancesTeamOutcome({
      status: finished,
      cupMatchesInRound: 1,
      winnerCode: 3,
      homeScore: { current: 1, normaltime: 1 },
      awayScore: { current: 1, normaltime: 1 },
    })).toBeNull();
  });

  it("не спотыкается о пустой ответ", () => {
    expect(extractAdvancesTeamOutcome(null)).toBeNull();
    expect(extractAdvancesTeamOutcome({})).toBeNull();
  });
});

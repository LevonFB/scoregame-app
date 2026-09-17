// Чистая логика четырёх вопросов, добавленных поверх подтверждённых фидов:
// «кто на ноль» и индивидуальный тотал считаются из счёта, «будет ли пенальти» — из
// /incidents, «у кого больше» — из /statistics. Ловушка у всех одна и та же: молчащий
// фид не должен превращаться в ложный ответ, поэтому «неизвестно» обязано быть null.

import { describe, expect, it } from "vitest";
import {
  BONUS_QUESTION_TYPES,
  buildTotalTitle,
  cleanSheetAnswer,
  defaultBonusAnswerOptions,
  extractPenaltyAwarded,
  extractStatLeaderSides,
  normalizeBonusQuestionAnswer,
} from "../index";

describe("cleanSheetAnswer", () => {
  it("отдаёт сторону, которая не пропустила", () => {
    expect(cleanSheetAnswer(2, 0)).toBe("home");
    expect(cleanSheetAnswer(0, 3)).toBe("away");
  });

  it("на 0:0 обе команды на ноль", () => {
    expect(cleanSheetAnswer(0, 0)).toBe("both");
  });

  it("при голах с обеих сторон верного «на ноль» нет", () => {
    expect(cleanSheetAnswer(1, 1)).toBe("none");
  });
});

// Формы инцидентов ниже — не гипотезы: они сняты с живого фида /incidents 29.08.2026
// по 150 сыгранным матчам, 48 из которых содержали пенальти-инциденты. Две последние
// проверки — регрессии на реальных ложных срабатываниях, найденных этой сверкой.
describe("extractPenaltyAwarded", () => {
  it("забитый пенальти: goal / penalty", () => {
    expect(extractPenaltyAwarded([
      { incidentType: "goal", incidentClass: "regular", time: 12 },
      { incidentType: "goal", incidentClass: "penalty", time: 55 },
    ])).toBe("yes");
  });

  it("незабитый пенальти: inGamePenalty / missed", () => {
    expect(extractPenaltyAwarded([
      { incidentType: "inGamePenalty", incidentClass: "missed", time: 51 },
    ])).toBe("yes");
  });

  it("назначенный по VAR: varDecision / penaltyAwarded", () => {
    expect(extractPenaltyAwarded([
      { incidentType: "varDecision", incidentClass: "penaltyAwarded", confirmed: false, time: 62 },
    ])).toBe("yes");
  });

  it("VAR отменил пенальти: varDecision / penaltyNotAwarded — это «нет»", () => {
    // SC Freiburg - Motherwell, 27.08.2026: слово penalty в классе есть, а пенальти нет.
    expect(extractPenaltyAwarded([
      { incidentType: "varDecision", incidentClass: "penaltyNotAwarded", confirmed: true, time: 30 },
      { incidentType: "goal", incidentClass: "regular", time: 70 },
    ])).toBe("no");
  });

  it("серия пенальти не считается пенальти в матче", () => {
    expect(extractPenaltyAwarded([
      { incidentType: "penaltyShootout", incidentClass: "scored" },
      { incidentType: "penaltyShootout", incidentClass: "missed" },
      { incidentType: "period", text: "FT" },
    ])).toBe("no");
  });

  it("заголовок серии (period=\"penalties\") не считается пенальти в матче", () => {
    expect(extractPenaltyAwarded([
      { incidentType: "period", text: "PEN", period: "penalties", time: 999, homeScore: 4, awayScore: 3 },
      { incidentType: "goal", incidentClass: "regular", time: 70 },
    ])).toBe("no");
  });

  it("непустой фид без пенальти — это «нет»", () => {
    expect(extractPenaltyAwarded([
      { incidentType: "goal", incidentClass: "regular", time: 12 },
      { incidentType: "card", incidentClass: "yellow", time: 30 },
    ])).toBe("no");
  });

  it("пустой фид — «неизвестно», а не «нет»", () => {
    expect(extractPenaltyAwarded([])).toBeNull();
    expect(extractPenaltyAwarded(undefined as any)).toBeNull();
  });
});

describe("extractStatLeaderSides", () => {
  const statistics = {
    statistics: [
      {
        period: "ALL",
        groups: [
          {
            groupName: "Match overview",
            statisticsItems: [
              { name: "Ball possession", home: "58%", away: "42%" },
              { name: "Total shots", home: "14", away: "9" },
              { name: "Shots on target", home: "5", away: "5" },
              { name: "Corner kicks", home: "7", away: "4" },
              { name: "Fouls", home: "11", away: "13" },
            ],
          },
        ],
      },
      {
        period: "1ST",
        groups: [
          { groupName: "Match overview", statisticsItems: [{ name: "Total shots", home: "8", away: "3" }] },
        ],
      },
    ],
  };

  it("берёт полный матч, а не отдельный тайм", () => {
    expect(extractStatLeaderSides(statistics).shots).toEqual({ home: 14, away: 9 });
  });

  it("не складывает стороны — сравнение требует их по отдельности", () => {
    expect(extractStatLeaderSides(statistics).corners).toEqual({ home: 7, away: 4 });
  });

  it("владение читается вместе с процентом", () => {
    expect(extractStatLeaderSides(statistics).possession).toEqual({ home: 58, away: 42 });
  });

  it("удары в створ не путаются с ударами", () => {
    expect(extractStatLeaderSides(statistics).shots_on_target).toEqual({ home: 5, away: 5 });
  });

  it("отсутствующий показатель — null, чтобы вопрос остался открытым", () => {
    const partial = {
      statistics: [
        { period: "ALL", groups: [{ statisticsItems: [{ name: "Corner kicks", home: "3", away: "3" }] }] },
      ],
    };
    expect(extractStatLeaderSides(partial).possession).toBeNull();
    expect(extractStatLeaderSides(partial).corners).toEqual({ home: 3, away: 3 });
  });
});

// Инвариант через все типы разом. Вариант ответа, который бэкенд предлагает игроку, обязан
// проходить валидацию ответа — иначе выбор не сохранится, а на резолве не совпадёт с
// correct_answer, и награда не выдастся ни за один ответ. Ровно так «минута первого гола»
// получила дефолтные «Да/Нет» вместо интервалов, поэтому проверка идёт по всему списку
// типов, а не только по новым: следующий добавленный тип попадёт под неё сам.
describe("варианты ответа согласованы с валидацией", () => {
  const typesWithOwnOptions = BONUS_QUESTION_TYPES.filter((type) => type !== "user_goalscorer");

  it.each(typesWithOwnOptions)("%s: каждый предлагаемый вариант — валидный ответ", (questionType) => {
    const options = defaultBonusAnswerOptions(questionType, 3);
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(normalizeBonusQuestionAnswer(questionType, option.key)).toBe(option.key);
    }
  });

  it("«обе на ноль» принимается только вопросом про сухой матч", () => {
    expect(normalizeBonusQuestionAnswer("clean_sheet", "both")).toBe("both");
    expect(normalizeBonusQuestionAnswer("both_teams_score", "both")).toBeNull();
    expect(normalizeBonusQuestionAnswer("stat_leader", "both")).toBeNull();
  });

  it("«поровну» у вопроса про статистику — это ключ none", () => {
    expect(normalizeBonusQuestionAnswer("stat_leader", "none")).toBe("none");
    expect(normalizeBonusQuestionAnswer("penalty_awarded", "none")).toBeNull();
  });
});

// Заголовок вопроса — то, что игрок читает в мини-аппе, поэтому число обязано быть
// согласовано с метрикой: «В матче будет 3+ голов?» выглядело ошибкой вёрстки.
describe("buildTotalTitle", () => {
  const rule = (over: Partial<Parameters<typeof buildTotalTitle>[0]>) =>
    buildTotalTitle({ metric: "goals", operator: "gte", threshold: 3, ...over } as any);

  it("согласует форму метрики с числом", () => {
    expect(rule({ threshold: 1 })).toBe("В матче будет 1+ гол?");
    expect(rule({ threshold: 3 })).toBe("В матче будет 3+ гола?");
    expect(rule({ threshold: 5 })).toBe("В матче будет 5+ голов?");
    expect(rule({ threshold: 11 })).toBe("В матче будет 11+ голов?");
    expect(rule({ threshold: 21 })).toBe("В матче будет 21+ гол?");
  });

  it("карточки и угловые склоняются по своим формам", () => {
    expect(rule({ metric: "yellow_cards", threshold: 4 })).toBe("В матче будет 4+ жёлтые карточки?");
    expect(rule({ metric: "yellow_cards", threshold: 5 })).toBe("В матче будет 5+ жёлтых карточек?");
    expect(rule({ metric: "corners", threshold: 10 })).toBe("В матче будет 10+ угловых?");
  });

  it("индивидуальный тотал — предложение, а не ярлык с двоеточием", () => {
    expect(rule({ side: "home", threshold: 2 })).toBe("Хозяева забьют 2+ гола?");
    expect(rule({ side: "away", threshold: 1 })).toBe("Гости забьют 1+ гол?");
    expect(rule({ side: "home", threshold: 2, operator: "eq" })).toBe("Хозяева забьют ровно 2 гола?");
  });

  it("«или меньше» берёт родительную форму независимо от числа", () => {
    expect(rule({ operator: "lte", threshold: 2 })).toBe("В матче будет 2 или меньше голов?");
  });

  it("ни один заголовок не содержит двоеточия", () => {
    for (const threshold of [1, 2, 5, 11]) {
      for (const side of ["total", "home", "away"] as const) {
        expect(rule({ threshold, side })).not.toContain(":");
      }
    }
  });
});

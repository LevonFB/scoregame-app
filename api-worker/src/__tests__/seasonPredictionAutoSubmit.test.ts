// Автоподтверждение черновиков прогнозов сезона (runSeasonPredictionAutoSubmit).
//
// Черновик никогда не участвует в подсчёте очков — каждый пересчёт отбирает записи по
// `status IN ('submitted','locked','scoring','completed')`. Свип после дедлайна переводит
// последний сохранённый черновик в 'submitted', но только если он проходит ровно ту же
// валидацию, что и кнопка «Подтвердить». Здесь проверяются две вещи, от которых зависит,
// потеряет пользователь сезон или нет: граница окна и совпадение валидации с ручной.

import { describe, expect, it } from "vitest";
import { seasonPredictionAutoSubmitWindowOpen } from "../index";
import {
  scoreSeasonPredictionEurocupLeagueStageEntry,
} from "../seasonPredictionEurocupScoring";

const HOUR = 3600;
const GRACE = 168 * HOUR; // дефолт: 7 суток
const DEADLINE = 1_756_000_000;

describe("seasonPredictionAutoSubmitWindowOpen — граница дедлайна", () => {
  it("до дедлайна окно закрыто: пользователь ещё может подтвердить сам", () => {
    expect(seasonPredictionAutoSubmitWindowOpen(DEADLINE, DEADLINE - 1, GRACE)).toBe(false);
  });

  it("ровно в момент дедлайна окно уже открыто — как и лок в isSeasonPredictionLocked (>=)", () => {
    expect(seasonPredictionAutoSubmitWindowOpen(DEADLINE, DEADLINE, GRACE)).toBe(true);
  });

  it("в пределах grace-окна свип работает (крон часовой, дедлайн точный)", () => {
    expect(seasonPredictionAutoSubmitWindowOpen(DEADLINE, DEADLINE + HOUR, GRACE)).toBe(true);
    expect(seasonPredictionAutoSubmitWindowOpen(DEADLINE, DEADLINE + GRACE, GRACE)).toBe(true);
  });

  it("после grace-окна свип больше не трогает старые черновики", () => {
    expect(seasonPredictionAutoSubmitWindowOpen(DEADLINE, DEADLINE + GRACE + 1, GRACE)).toBe(false);
  });

  it("дедлайн не задан (0 / null) — окно никогда не открывается", () => {
    expect(seasonPredictionAutoSubmitWindowOpen(0, DEADLINE, GRACE)).toBe(false);
    expect(seasonPredictionAutoSubmitWindowOpen(Number(null), DEADLINE, GRACE)).toBe(false);
  });
});

// Причина, по которой неполные черновики принципиально пропускаются: скоринг еврокубков
// бросает на неполной пользовательской таблице, и автоподтверждение такого черновика
// превратило бы его в failed-запись при пересчёте.
describe("почему неполный черновик нельзя подтверждать автоматически", () => {
  const OFFICIAL = Array.from({ length: 36 }, (_, i) => `t${i + 1}`);

  it("неполный топ-8 ломает скоринг — такой черновик обязан остаться черновиком", () => {
    expect(() => scoreSeasonPredictionEurocupLeagueStageEntry({
      userTable: {
        league_stage: {
          top8_team_ids: OFFICIAL.slice(0, 5), // 5 вместо 8 — пользователь не доделал
          zone_9_24_team_ids: OFFICIAL.slice(8, 24),
        },
      },
      officialOrderedIds: OFFICIAL,
    })).toThrow("EUROCUP_USER_TOP8_INVALID");
  });

  it("полный черновик проходит тот же путь без ошибок", () => {
    const res = scoreSeasonPredictionEurocupLeagueStageEntry({
      userTable: {
        league_stage: {
          top8_team_ids: OFFICIAL.slice(0, 8),
          zone_9_24_team_ids: OFFICIAL.slice(8, 24),
        },
      },
      officialOrderedIds: OFFICIAL,
    });
    expect(res.total_points).toBeGreaterThan(0);
  });
});

// Пошаговый режим «Золотого мяча»: стартовый экран → расстановка 30 → 1 →
// прежний полный расклад. Данные целиком мокаются, живой api-worker не нужен.
import { test, expect, Page } from "@playwright/test";
import { telegramInitScript } from "./telegram";

const NOMINEE_COUNT = 30;

function nominees() {
  return Array.from({ length: NOMINEE_COUNT }, (_, i) => ({
    id: i + 1,
    player_name: `Игрок ${String(i + 1).padStart(2, "0")}`,
    player_name_normalized: `igrok ${i + 1}`,
    team_name: `Клуб ${i + 1}`,
    nationality: null,
    photo_url: null,
    position: null,
    position_group: "forward",
  }));
}

function entryFrom(table: unknown, status = "draft") {
  return {
    id: 1,
    season_prediction_season_id: 1,
    tournament_code: "ballon_dor",
    status,
    table,
    awards: null,
    submitted_at: null,
    last_submitted_at: null,
    locked_at: null,
  };
}

function ballonDorBody(entry: unknown) {
  return {
    ok: true,
    season: { id: 1, code: "2026-27", title: "Сезон 2026/27", status: "active" },
    tournament: {
      id: 42,
      season_prediction_season_id: 1,
      tournament_code: "ballon_dor",
      tournament_type: "ballon_dor",
      title: "Золотой мяч",
      country: null,
      team_count: 0,
      configured_team_count: 0,
      status: "open",
      open_at: null,
      deadline_at: null,
      sort_order: 0,
      settings: {},
      rules: { zones: {}, playoff: {} },
    },
    nominees: nominees(),
    nominee_count: NOMINEE_COUNT,
    entry,
  };
}

/**
 * Поднимает экран с мокнутым бэкендом. `savedTable` — черновик, который сервер
 * отдаёт при входе; `drafts` копит всё, что улетело в PUT /draft.
 */
async function openBallonDor(page: Page, savedTable: unknown | null, drafts: any[]) {
  await page.route(/telegram-web-app\.js/, (r) => r.abort());
  await page.addInitScript(telegramInitScript);
  let entry = savedTable === null ? null : entryFrom(savedTable);

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/ballon-dor/draft")) {
      const body = JSON.parse(route.request().postData() || "{}");
      drafts.push(body.table_json);
      entry = entryFrom(body.table_json);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, entry }) });
    }
    if (path.endsWith("/ballon-dor/submit")) {
      entry = entryFrom(entry ? (entry as any).table : null, "submitted");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, entry }) });
    }
    if (path.endsWith("/season-predictions/ballon-dor")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ballonDorBody(entry)) });
    }
    if (path.endsWith("/season-predictions/config")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, season: { id: 1, code: "2026-27", title: "Сезон 2026/27", status: "active" }, top_leagues: [], european_tournaments: [] }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, items: [] }) });
  });

  await page.goto("/season-predictions", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Золотой мяч" }).click();
}

/** Черновик сервера: слоты с пропусками, места от `from` до 30 заполнены. */
function savedSlots(from: number) {
  const slots: Array<string | null> = Array.from({ length: NOMINEE_COUNT }, () => null);
  for (let place = from; place <= NOMINEE_COUNT; place++) slots[place - 1] = String(place);
  return { ranking: slots.filter(Boolean) as string[], slots };
}

test("ballon-dor: стартовый экран, шаг 30 → 29 и автосохранение черновика", async ({ page }) => {
  const drafts: any[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openBallonDor(page, null, drafts);

  // Сценарий A: до «Начать» ни колоды, ни пустых мест.
  await expect(page.getByRole("button", { name: "Начать расстановку" })).toBeVisible();
  await expect(page.getByText("Кандидаты ·")).toHaveCount(0);
  await expect(page.getByText("Места 11–30")).toHaveCount(0);

  await page.getByRole("button", { name: "Начать расстановку" }).click();

  // Открылось место 30, колода полная, прогресс 0 / 30.
  await expect(page.getByText("0 / 30")).toBeVisible();
  await expect(page.getByText("Кандидаты · 30")).toBeVisible();
  await expect(page.getByText("Кто займёт это место?")).toBeVisible();

  await page.getByRole("button", { name: "Поставить Игрок 01 на 30 место" }).click();

  // Тап = выбор: прогресс, следующее место и колода без выбранного.
  await expect(page.getByText("1 / 30")).toBeVisible();
  await expect(page.getByText("Кандидаты · 29")).toBeVisible();
  await expect(page.getByRole("button", { name: "Поставить Игрок 02 на 29 место" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Игрок 01 на/ })).toHaveCount(0);
  // Выбранный уехал вниз по треку и виден на своей строке.
  await expect(page.getByText("Игрок 01", { exact: true })).toBeVisible();

  // Сценарий B готовится сам: черновик уходит на сервер без нажатия «Сохранить».
  await expect.poll(() => drafts.length).toBeGreaterThan(0);
  expect(drafts[drafts.length - 1].slots[29]).toBe("1");
  expect(drafts[drafts.length - 1].ranking).toEqual(["1"]);

  // Поиск сужает колоду.
  await page.getByRole("button", { name: "Найти кандидата" }).click();
  await page.getByLabel("Поиск кандидата").fill("Игрок 17");
  await expect(page.getByRole("button", { name: /Поставить Игрок 17/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Поставить Игрок 18/ })).toHaveCount(0);

  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("ballon-dor: частичный черновик продолжается без стартового экрана", async ({ page }) => {
  const drafts: any[] = [];
  // Заполнены места 28, 29, 30 — продолжаем с 27-го.
  await openBallonDor(page, savedSlots(28), drafts);

  await expect(page.getByRole("button", { name: "Начать расстановку" })).toHaveCount(0);
  await expect(page.getByText("3 / 30")).toBeVisible();
  await expect(page.getByRole("button", { name: /Поставить Игрок 01 на 27 место/ })).toBeVisible();
  await expect(page.getByText("Кандидаты · 27")).toBeVisible();

  // Трек: занятые места видны под активной строкой, будущие — над ней.
  await expect(page.getByText("Игрок 28", { exact: true })).toBeVisible();
  await expect(page.getByText("Игрок 29", { exact: true })).toBeVisible();
  await expect(page.getByText("?", { exact: true }).first()).toBeVisible();

  // Промежуточный расклад: замена уже занятого места возвращает игрока в колоду.
  await page.getByRole("button", { name: "Посмотреть текущий расклад" }).click();
  await page.getByRole("button", { name: "Заменить игрока на 30 месте" }).click();
  const pickSheet = page.getByRole("dialog", { name: "Выбрать игрока на 30 место" });
  await pickSheet.getByRole("button").filter({ hasText: "Игрок 05" }).click();
  await expect(page.getByText("3 / 30")).toBeVisible();
  await expect(page.getByRole("button", { name: /Поставить Игрок 30/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Поставить Игрок 05/ })).toHaveCount(0);
});

test("ballon-dor: на 29/30 последний кандидат коронуется сам", async ({ page }) => {
  const drafts: any[] = [];
  // 29 / 30: свободно только первое место, в колоде остался один кандидат.
  await openBallonDor(page, savedSlots(2), drafts);

  // Выбирать не из чего — сразу коронация, без тапа по последнему кандидату.
  await expect(page.getByText("Твой обладатель Золотого мяча")).toBeVisible();
  await expect(page.getByText("Игрок 01", { exact: true })).toBeVisible();

  // Полный бюллетень уходит на сервер сам.
  await expect.poll(() => drafts.length).toBeGreaterThan(0);
  expect(drafts[drafts.length - 1].slots[0]).toBe("1");
  expect(drafts[drafts.length - 1].ranking).toHaveLength(30);

  await page.getByRole("button", { name: "Открыть полный расклад" }).click();

  // Дальше прежний экран проверки.
  await expect(page.getByText("Все места расставлены")).toBeVisible();
  await expect(page.getByText("Места 11–30")).toBeVisible();
  await expect(page.getByRole("button", { name: "Подтвердить прогноз" })).toBeEnabled();
});

test("ballon-dor: подтверждённый прогноз открывается прежним экраном", async ({ page }) => {
  const drafts: any[] = [];
  await page.route(/telegram-web-app\.js/, (r) => r.abort());
  await page.addInitScript(telegramInitScript);
  const full = savedSlots(1);
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/season-predictions/ballon-dor")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ballonDorBody(entryFrom(full, "submitted"))) });
    }
    if (path.endsWith("/season-predictions/config")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, season: { id: 1, code: "2026-27", title: "Сезон 2026/27", status: "active" }, top_leagues: [], european_tournaments: [] }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, items: [] }) });
  });
  await page.goto("/season-predictions", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Золотой мяч" }).click();

  await expect(page.getByRole("button", { name: "Начать расстановку" })).toHaveCount(0);
  await expect(page.getByText("Все места расставлены")).toBeVisible();
  await expect(page.getByRole("button", { name: "Подтвердить заново" })).toBeVisible();
  expect(drafts).toHaveLength(0);
});

test("ballon-dor: случайный выбор снимается и место возвращается", async ({ page }) => {
  const drafts: any[] = [];
  await openBallonDor(page, null, drafts);
  await page.getByRole("button", { name: "Начать расстановку" }).click();

  await page.getByRole("button", { name: "Поставить Игрок 01 на 30 место" }).click();
  await expect(page.getByText("1 / 30")).toBeVisible();

  // Кнопка отмены возвращает последний выбор в колоду и активное место.
  await page.getByRole("button", { name: "Отменить последний выбор" }).click();
  await expect(page.getByText("0 / 30")).toBeVisible();
  await expect(page.getByRole("button", { name: "Поставить Игрок 01 на 30 место" })).toBeVisible();

  // Тап по занятой строке трека снимает игрока с этого места.
  await page.getByRole("button", { name: "Поставить Игрок 01 на 30 место" }).click();
  await page.getByRole("button", { name: "Поставить Игрок 02 на 29 место" }).click();
  await expect(page.getByText("2 / 30")).toBeVisible();
  await page.getByRole("button", { name: "Убрать Игрок 01 с 30 места" }).click();
  await expect(page.getByText("1 / 30")).toBeVisible();
  await expect(page.getByRole("button", { name: "Поставить Игрок 01 на 30 место" })).toBeVisible();
});

test("ballon-dor: коронацию можно отменить и выбрать заново", async ({ page }) => {
  const drafts: any[] = [];
  await openBallonDor(page, savedSlots(2), drafts);
  await expect(page.getByText("Твой обладатель Золотого мяча")).toBeVisible();

  await page.getByRole("button", { name: "Вернуться к выбору второго места" }).click();

  // Снялись и победитель, и второе место: снова пошаговый режим на 2-м.
  await expect(page.getByText("28 / 30")).toBeVisible();
  await expect(page.getByText("Кто займёт это место?")).toBeVisible();
  await expect(page.getByRole("button", { name: /Поставить Игрок 01 на 2 место/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Поставить Игрок 02 на 2 место/ })).toBeVisible();
});

test("ballon-dor: тап по строке ведёт к месту, снимает только кнопка", async ({ page }) => {
  const drafts: any[] = [];
  // Заполнены 28, 29, 30 — активно 27.
  await openBallonDor(page, savedSlots(28), drafts);
  await expect(page.getByText("3 / 30")).toBeVisible();

  // Тап по занятой строке никого не удаляет, а переводит на её место.
  await page.getByRole("button", { name: "Перейти к 29 месту" }).click();
  await expect(page.getByText("3 / 30")).toBeVisible();
  await expect(page.getByRole("button", { name: /Поставить Игрок 01 на 29 место/ })).toBeVisible();

  // Выбор на этом месте заменяет жильца, прежний возвращается в колоду.
  await page.getByRole("button", { name: /Поставить Игрок 01 на 29 место/ }).click();
  await expect(page.getByText("3 / 30")).toBeVisible();
  await expect(page.getByRole("button", { name: /Поставить Игрок 29/ })).toBeVisible();
  // Очередь вернулась к 27-му месту.
  await expect(page.getByRole("button", { name: /Поставить Игрок 02 на 27 место/ })).toBeVisible();

  // Удаляет только «снять».
  await page.getByRole("button", { name: "Убрать Игрок 30 с 30 места" }).click();
  await expect(page.getByText("2 / 30")).toBeVisible();
});

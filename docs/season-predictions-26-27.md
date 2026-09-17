# Техническое ТЗ: режим "Прогнозы сезона" 2026/27

## 1. Название режима

Режим называется **"Прогнозы сезона"**.

Это отдельный большой режим внутри приложения ScoreGame для долгосрочных прогнозов на клубный сезон 2026/27.

Режим не должен менять текущий игровой цикл обычных прогнозов на матчи, задания, рейтинги, экономику, игровые звезды, мячи, кейсы, бусты и магазин.

## 2. Главная структура режима

Внутри режима должны быть основные разделы:

1. Топ-5 лиг
2. Вызов недели
3. Еврокубки
4. Рейтинг
5. Задания

Награды, игровые звезды, мячи, кейсы и финальный баланс очков пока не фиксируются. Эти правила должны обсуждаться отдельно перед внедрением scoring и экономики.

## 3. Топ-5 лиг

В блок "Топ-5 лиг" входят:

- АПЛ
- Ла Лига
- Серия А
- Бундеслига
- Лига 1

Для каждой лиги сезонный прогноз состоит из двух разделов:

1. Таблица лиги
2. Индивидуальные награды

### 3.1. Таблица лиги

Пользователь расставляет полную итоговую таблицу команд по местам.

Из этой таблицы система автоматически определяет:

- чемпиона;
- зону Лиги чемпионов;
- зону Лиги Европы;
- зону Лиги конференций;
- вылетевших;
- стыковые места, если они есть в конкретной лиге или сезоне.

Отдельных ручных выборов чемпиона, топ-4, еврокубковых мест и вылета быть не должно, чтобы не дублировать ввод. Единственный источник прогноза по лиге — итоговая таблица пользователя.

Для каждой лиги должны быть настраиваемые правила зон. Еврокубковые места могут отличаться по сезону и зависеть от правил конкретной лиги, кубковых квот и регламентов сезона.

Минимальная будущая модель правил зон:

- диапазон мест для Лиги чемпионов;
- диапазон мест для Лиги Европы;
- диапазон мест для Лиги конференций;
- диапазон мест вылета;
- диапазон стыковых мест;
- возможность ручной корректировки правил админом.

### 3.2. Индивидуальные награды

Пользователь отдельно выбирает:

- лучшего бомбардира;
- лучшего ассистента;
- обладателя "Золотой перчатки" / вратаря с наибольшим количеством сухих матчей.

Индивидуальные награды пока не должны быть важной частью рейтинга. На текущем этапе их нужно рассматривать в первую очередь как основу для будущих заданий, игровых наград и дополнительных сезонных активностей.

## 4. Вызов недели

**"Вызов недели"** — еженедельный блок внутри режима "Прогнозы сезона". Он нужен, чтобы пользователь не ждал весь сезон до первых результатов и регулярно возвращался в режим.

В каждом Вызове недели 5 вопросов:

1. Матч недели
2. Лига недели
3. Дуэль недели
4. Сенсация недели
5. Событие недели

Все вопросы считаются только по заранее выбранному админом пулу матчей недели.

### 4.1. Матч недели

Главный матч недели.

Базовый формат:

- кто победит / исход главного матча.

В будущем формат можно расширить, но первая версия должна оставаться простой и понятной.

### 4.2. Лига недели

Вопрос:

- в какой лиге будет самая высокая результативность среди выбранного пула матчей недели.

Считать нужно честно: по среднему количеству голов за матч, а не по общему количеству голов. Это нужно, чтобы лига с большим числом матчей в пуле не получала нечестное преимущество.

Пример расчета:

- АПЛ: 3 матча, 9 голов, среднее 3.0;
- Ла Лига: 2 матча, 7 голов, среднее 3.5;
- правильный ответ — Ла Лига.

### 4.3. Дуэль недели

Дуэль игроков.

Формат:

- кто забьет больше голов на этой неделе.

Варианты ответа:

- Игрок A
- Игрок B
- Одинаково

Правила:

- считаются только матчи из пула недели;
- если оба игрока забили одинаково, включая 0:0 по голам, правильный ответ — "Одинаково";
- если один из игроков не сыграл ни минуты, вопрос аннулируется.

Аннулированный вопрос не должен ломать общий результат Вызова недели. Точное поведение по очкам и наградам фиксируется позже вместе с общей формулой scoring.

### 4.4. Сенсация недели

Формат:

- кто из андердогов не проиграет;
- также должен быть вариант "сенсации не будет".

Андердоги и список вариантов должны задаваться админом заранее в рамках пула недели.

### 4.5. Событие недели

Общее событие по пулу матчей недели.

Примеры:

- будет ли матч с 5+ голами;
- будет ли разгром;
- сколько будет ничьих;
- другое заранее выбранное событие.

Событие недели должно быть конфигурируемым, чтобы админ мог подбирать понятный и интересный вопрос под конкретный календарь.

## 5. Еврокубки

В блок "Еврокубки" входят:

- Лига чемпионов
- Лига Европы
- Лига конференций

Еврокубки должны работать поэтапно, а не одной большой сеткой сразу:

1. стадия лиги;
2. стыки плей-офф;
3. 1/8 финала;
4. 1/4 финала;
5. 1/2 финала;
6. финал.

На первом этапе внедрения еврокубки можно не реализовывать полностью. Однако архитектура режима должна учитывать будущую поэтапную модель:

- отдельные дедлайны по стадиям;
- отдельные статусы подтверждения по стадиям;
- возможность открывать следующий этап только после появления реальных пар;
- возможность считать рейтинг по турниру и суммарно по всем еврокубкам.

## 6. Рейтинги

Пока очки не фиксируются, но структура рейтингов должна быть заложена заранее.

### 6.1. Общий рейтинг "Прогнозы сезона"

Главный рейтинг режима.

В будущем может учитывать:

- Топ-5 лиг;
- Вызовы недели;
- Еврокубки.

Финальная формула вклада каждого блока должна быть согласована отдельно.

### 6.2. Рейтинг "Топ-5 лиг"

Суммарный рейтинг по национальным чемпионатам.

Основной вклад по каждой лиге должна давать "Таблица лиги". Индивидуальные награды пока не делать важной частью рейтинга.

### 6.3. Рейтинг по каждой лиге

Отдельные рейтинги:

- АПЛ
- Ла Лига
- Серия А
- Бундеслига
- Лига 1

### 6.4. Рейтинг "Вызов недели"

Нужны два уровня:

- рейтинг конкретной недели;
- общий рейтинг по Вызовам недели за сезон.

### 6.5. Рейтинг "Еврокубки"

Суммарный рейтинг по Лиге чемпионов, Лиге Европы и Лиге конференций.

Также нужны отдельные рейтинги:

- Лига чемпионов
- Лига Европы
- Лига конференций

### 6.6. Scope рейтингов

Та же система рейтингов должна в будущем работать для:

- глобального рейтинга;
- приватных лиг;
- канальных лиг.

Рейтинги режима "Прогнозы сезона" должны быть отдельными от обычных рейтингов прогнозов на матчи.

## 7. Задания

Задания режима "Прогнозы сезона" должны быть разделены по режимам.

Основные разделы:

1. Старт сезона
2. Топ-5 лиг
3. Вызов недели
4. Еврокубки

Награды за задания пока не фиксируются.

### 7.1. Топ-5 лиг

Внутри раздела "Топ-5 лиг" должны быть подразделы:

- Все топ-5
- АПЛ
- Ла Лига
- Серия А
- Бундеслига
- Лига 1

В подразделе конкретной лиги должны быть задания двух типов.

#### Активность

- заполнить таблицу лиги;
- подтвердить прогноз лиги;
- выбрать индивидуальные награды;
- полностью завершить прогноз по лиге.

#### Угадывания

- угадать чемпиона;
- угадать еврокубковые зоны;
- угадать зону Лиги чемпионов;
- угадать вылетевших;
- угадать точные позиции;
- угадать лучшего бомбардира;
- угадать лучшего ассистента;
- угадать золотую перчатку.

В подразделе "Все топ-5" должны быть кросс-лиговые задания:

- подтвердить прогнозы по нескольким лигам;
- подтвердить прогнозы по всем топ-5 лигам;
- угадать чемпионов нескольких лиг;
- угадать индивидуальные награды в разных лигах;
- суммарные достижения по таблицам всех топ-5 лиг.

### 7.2. Вызов недели

Задания по активности:

- участвовать в Вызове недели;
- ответить на все 5 вопросов;
- участвовать несколько недель подряд.

Задания за угадывания:

- угадать Матч недели;
- угадать Лигу недели;
- угадать Дуэль недели;
- угадать Сенсацию недели;
- угадать Событие недели;
- угадать 3 из 5;
- угадать 4 из 5;
- угадать 5 из 5.

### 7.3. Еврокубки

Внутри раздела "Еврокубки" должны быть подразделы:

- Все еврокубки
- Лига чемпионов
- Лига Европы
- Лига конференций

В подразделе конкретного турнира должны быть задания двух типов.

#### Активность

- подтвердить прогноз стадии лиги;
- подтвердить прогноз стыков;
- подтвердить прогноз 1/8;
- подтвердить прогноз 1/4;
- подтвердить прогноз 1/2;
- подтвердить прогноз финала.

#### Угадывания

- угадать команды топ-8 стадии лиги;
- угадать команды топ-24;
- угадать победителей стыков;
- угадать победителей раундов плей-офф;
- угадать полуфиналистов;
- угадать финалистов;
- угадать чемпиона турнира.

В подразделе "Все еврокубки" должны быть кросс-турнирные задания:

- подтвердить прогнозы по ЛЧ, ЛЕ и ЛК;
- угадать победителя любого еврокубка;
- угадать победителей нескольких еврокубков;
- суммарные достижения по топ-8, топ-24 и плей-офф across ЛЧ, ЛЕ и ЛК.

## 8. Статусы пользовательских прогнозов

Для будущей реализации нужно предусмотреть статусы:

- `draft` — пользователь начал, но не подтвердил;
- `submitted` — пользователь подтвердил прогноз;
- `locked` — дедлайн прошел, редактирование запрещено;
- `scoring` — идет подсчет;
- `completed` — результат посчитан.

До дедлайна пользователь может редактировать и заново подтверждать прогноз.

После дедлайна прогноз должен быть заблокирован.

Важно: `draft` не должен попадать в рейтинги и не должен считаться завершенным заданием подтверждения прогноза. Для рейтингов и будущих наград должен использоваться только явно подтвержденный прогноз.

## 9. Что не внедрять сейчас

На первых этапах не нужно внедрять:

- финальный баланс очков;
- начисление игровых звезд;
- мячи;
- кейсы;
- магазин;
- reward ledger;
- платные бусты;
- финальные награды;
- сложную экономику;
- автоматический scoring без утвержденной формулы.

На текущем шаге также не нужно менять:

- текущие прогнозы на матчи;
- обычный scoring;
- обычные задания;
- обычные рейтинги;
- лиги;
- магазин;
- кейсы;
- бусты;
- Telegram Stars;
- bot summaries;
- текущую экономику приложения.

## 10. План внедрения по этапам

### Этап 1

- создать каркас режима "Прогнозы сезона";
- добавить раздел/страницу на frontend;
- добавить блок "Топ-5 лиг";
- добавить карточки 5 лиг;
- добавить структуру данных для таблицы лиги и индивидуальных наград;
- добавить статусы `draft`, `submitted`, `locked`;
- без очков и наград.

### Этап 2

- реализовать таблицу лиги с drag-and-drop;
- подсветить зоны: чемпион, ЛЧ, ЛЕ/ЛК, вылет, стыки;
- добавить сохранение `draft`;
- добавить подтверждение прогноза.

### Этап 3

- добавить индивидуальные награды;
- добавить выбор бомбардира, ассистента, золотой перчатки;
- сохранять индивидуальные награды вместе с прогнозом лиги.

### Этап 4

- добавить задания без наград;
- добавить структуру разделов и подразделов;
- добавить прогресс заданий;
- поддержать `completed` без экономического claim.

### Этап 5

- добавить Вызов недели;
- добавить админский пул матчей;
- добавить 5 вопросов;
- добавить ответы пользователя;
- добавить статусы `submitted` и `locked`.

### Этап 6

- добавить еврокубки по этапам;
- подготовить отдельные дедлайны и статусы стадий;
- не делать одну огромную сетку сразу.

### Этап 7

- после отдельного согласования добавить scoring;
- после отдельного согласования добавить рейтинги;
- после отдельного согласования добавить награды.

## 11. Итог

Режим "Прогнозы сезона" должен развиваться как отдельный сезонный режим, не смешанный с обычными прогнозами на матчи.

Первая цель будущего внедрения — безопасно добавить каркас режима и прогнозы по Топ-5 лигам без очков, наград и экономики. Scoring, рейтинги, задания с наградами и финальные призы должны внедряться только после отдельного согласования формул и правил.

## 12. Текущий технический статус

### 12.1. Что реализовано
- Каркас режима `Прогнозы сезона` (изолированный, не пересекается с обычными прогнозами и WC2026).
- Топ-5 лиг: таблица лиги, индивидуальные награды, draft/submit, статусы `draft/submitted/locked/scoring/completed`, admin настройка команд/правил/наград, импорт из football-data/AllSports.
- Главный экран режима имеет вкладки: `Топ-5 лиг` и `Еврокубки`.
- Еврокубки добавлены как каркас на этом этапе:
  - три турнира `UCL` (Лига чемпионов), `UEL` (Лига Европы), `UECL` (Лига конференций) c `tournament_type='european'`, `team_count=36`, sort_order `60/70/80` (после топ-5).
  - settings_json содержит `stages: [league_stage, playoff_knockout, round_of_16, quarter_final, semi_final, final]` и `active_stage: "league_stage"`.
  - На первом этапе реализована только `league_stage`: пользователь выбирает Топ-8 (8 команд напрямую в 1/8) и зону 9–24 (16 команд → стыки), плюс опциональный победитель турнира.
  - UI: компактный picker с поиском и сегментированным контролом `— / Топ-8 / 9–24` для каждой команды; native `<select>` для победителя.
  - Timeline всех этапов на детальном экране (активный — выделен tone-цветом, остальные — `скоро`).
  - draft/submit поддержаны: до дедлайна можно изменять и повторно подтверждать; после deadline/locked/scoring/completed редактирование запрещено.
  - Если команды турнира пока не настроены, UI честно показывает empty state «Команды турнира ещё не настроены администратором».
- Admin вкладка `Прогнозы сезона` расширена фильтром-группой `Топ-5 лиг / Еврокубки`. Все существующие endpoints (status/open_at/deadline_at/team_count/teams/rules/award-options) теперь принимают коды UCL/UEL/UECL через расширенный нормализатор. Зоны и индивидуальные награды для еврокубков не обязательны.

### 12.2. Что зарезервировано на будущее (НЕ реализовано)
- Этапы плей-офф: стыки, 1/8, 1/4, 1/2, финал — в UI показаны как `скоро`, бекенд их не принимает.
- Сетка плей-офф, привязка результатов реальных матчей к этапам.
- Авто-импорт команд еврокубков из провайдеров: AllSports провайдер ID для UCL/UEL/UECL не задан — на этом этапе админ заводит команды вручную; preview-эндпоинт корректно вернёт предупреждение.

### 12.3. Что намеренно НЕ внедрялось
- scoring;
- рейтинги;
- задания и их прогресс;
- звёзды, мячи, кейсы;
- reward ledger;
- финальный расчёт результатов;
- финальные призы и магазин.

### 12.4. Endpoints (актуальные на этап «каркас еврокубков»)

**User**:
- `GET /season-predictions/config` — возвращает `season`, `tournaments` (back-compat: только топ-5), плюс группы `top_leagues` и `european_tournaments`. У каждого турнира свой `entry`.
- `GET /season-predictions/my` — entries пользователя.
- `GET /season-predictions/top-leagues/:code` — детали лиги (PL/PD/SA/BL1/FL1).
- `PUT /season-predictions/top-leagues/:code/draft` — сохранить таблицу/награды.
- `POST /season-predictions/top-leagues/:code/submit` — подтвердить.
- `GET /season-predictions/europe/:code` — детали еврокубка (UCL/UEL/UECL) + список этапов.
- `PUT /season-predictions/europe/:code/draft` — сохранить league_stage (top8 + zone 9–24 + winner).
- `POST /season-predictions/europe/:code/submit` — подтвердить (валидирует ровно 8 в top8, 16 в zone, никаких пересечений, все ID из настроенных команд).

**Admin** (все принимают коды топ-5 И еврокубков):
- `GET /admin/season-predictions/config` — возвращает все турниры обеих групп.
- `PUT /admin/season-predictions/tournaments/:code` — title/status/team_count/open_at/deadline_at/settings.
- `PUT /admin/season-predictions/tournaments/:code/teams` — список команд (требует team_count совпадения).
- `PUT /admin/season-predictions/tournaments/:code/rules` — зоны (необязательно для еврокубков).
- `PUT /admin/season-predictions/tournaments/:code/award-options` — индивидуальные награды (не обязательно для еврокубков).
- `POST /admin/season-predictions/tournaments/:code/import-teams/preview|confirm` — для еврокубков provider IDs не настроены, preview вернёт предупреждение; используйте ручной ввод.

### 12.5. Вызов недели — техническая реализация

Третий блок режима "Прогнозы сезона" — еженедельный мини-режим из 5 вопросов. Полностью изолирован от scoring/рейтингов/заданий/экономики.

**БД (миграция 0070):**
- `season_prediction_weekly_challenges` — собственно вызовы (привязка к `season_prediction_season_id`, code unique per season, статусы `draft/active/locked/scoring/completed/archived`, `open_at/deadline_at/close_at`, `sort_order`, `settings_json`).
- `season_prediction_weekly_challenge_matches` — пул матчей недели; **snapshot** home/away/kickoff_at плюс optional ссылки `match_id/provider/provider_match_id/tournament_code` для будущего scoring. Snapshot гарантирует, что отображение не ломается при изменениях внешних данных.
- `season_prediction_weekly_challenge_questions` — 5 вопросов; `question_key` ∈ `{match_of_week, league_of_week, duel_of_week, upset_of_week, event_of_week}` (UNIQUE per challenge), `options_json`, `config_json`, статус `active/disabled/void`.
- `season_prediction_weekly_challenge_entries` — ответы пользователя; UNIQUE (user_id, weekly_challenge_id); статусы `draft/submitted/locked/scoring/completed`.

**5 вопросов:**
| key | пример title | options |
|---|---|---|
| `match_of_week` | «Кто победит в матче недели?» | `home/draw/away` |
| `league_of_week` | «В какой лиге будет самая высокая результативность?» | `PL/PD/SA/BL1/FL1/UCL/...` (`calculation: "average_goals_per_match"`) |
| `duel_of_week` | «Кто забьёт больше голов?» | `player_a/player_b/equal` (required; void_if_player_did_not_play) |
| `upset_of_week` | «Кто из андердогов не проиграет?» | произвольные + обязательный `no_upset` |
| `event_of_week` | «Будет ли матч с 5+ голами?» | `yes/no` (event_type конфигурируется) |

Валидация key-specific требований применяется только при `status='active'`, чтобы admin мог сохранить draft с частичным options списком.

**User endpoints:**
- `GET /season-predictions/weekly-challenges/active` — текущий активный вызов + match_pool + questions + entry; статус surface: `not_started/draft/submitted/locked/unavailable`. Если active отсутствует, fallback на последний `locked/scoring/completed` (просмотр).
- `GET /season-predictions/weekly-challenges/:id` — вызов по id (если status != draft).
- `PUT /season-predictions/weekly-challenges/:id/draft` — частичные ответы; lock-check; статус `draft` если не submitted, иначе сохраняет submitted с обновлённым answers_json (стратегия как у топ-5).
- `POST /season-predictions/weekly-challenges/:id/submit` — валидирует все active вопросы (есть ответ + ответ из options), ставит `status='submitted'`, обновляет `last_submitted_at` (`submitted_at` фиксируется один раз).

**Admin endpoints (под существующим admin prefix):**
- `GET /admin/season-predictions/weekly-challenges` — список с counts матчей и вопросов.
- `POST /admin/season-predictions/weekly-challenges` — создать (создаётся в `draft`).
- `GET /admin/season-predictions/weekly-challenges/:id` — полная конфигурация.
- `PUT /admin/season-predictions/weekly-challenges/:id` — title/description/status/dates/sort_order/settings_json. Если есть submitted/locked entries и меняется статус/дедлайн — возвращает warning (но не блокирует).
- `PUT /admin/season-predictions/weekly-challenges/:id/matches` — заменяет пул матчей; для `active` нельзя пустой массив.
- `PUT /admin/season-predictions/weekly-challenges/:id/questions` — заменяет вопросы; не более одного на question_key; для `active` warning если не задан какой-то из 5 ключей.

**Admin UI:**
В существующей вкладке «Прогнозы сезона» добавлена третья кнопка group filter `Вызов недели`. При выборе — отдельный компонент `WeeklyChallengeAdminSection` с:
- списком challenges (горизонтальный селектор);
- формой создания нового (code + title);
- формой настроек (title/description/status/open_at/deadline_at/close_at/sort_order/settings_json);
- JSON-textarea для пула матчей (с шаблоном);
- JSON-textarea для 5 вопросов (с готовым default шаблоном по всем 5 question_keys);
- отображением warnings от бекенда.

JSON-редактор для MVP позволяет настроить вызов без ручного SQL. Полноценные пер-вопросные формы — за рамками этапа.

**User UI:**
Третья вкладка `Вызов недели` в `/season-predictions`. Внутри:
- если active отсутствует — premium empty state «Вызов недели пока не открыт …»;
- иначе компактная карточка с прогрессом (`X/5 ответов`), кол-вом матчей в пуле, дедлайном, next action и унифицированным CTA;
- по тапу открывается экран ответов: hero + список пула матчей (snapshot) + 5 question-cards с button options + SaveSubmitBar.

Кнопки используют общий `Pressable` (haptic + scale), как везде в season-predictions.

**Что не реализовано (намеренно):**
- scoring и проверка правильных ответов;
- начисление наград (звёзды/мячи/кейсы/reward ledger);
- рейтинги по вызовам недели;
- задания по вызовам недели;
- автозапуск/архивация вызовов по расписанию (статус меняется вручную через admin).

### 12.6. Импорт команд еврокубков

Существующие admin endpoints `POST /admin/season-predictions/tournaments/:tournamentCode/import-teams/(preview|confirm)` теперь принимают коды `UCL`, `UEL`, `UECL` наравне с топ-5. Никаких новых endpoints не добавлено.

**Где провайдеры используются:**
- Только в админке для `preview` (чтение из внешнего API) и `confirm` (сохранение snapshot'а в БД).
- Пользовательский UI `/season-predictions/europe/:code` читает **только** сохранённые команды из `season_prediction_tournament_teams` — нет прямой зависимости от Football-Data / AllSports / RapidAPI.

**Маппинг провайдеров для UCL/UEL/UECL:**
- **Football-Data** использует свой competition code (например `CL`, `EL`, `UECL`). Резолв в `resolveFootballDataCompetitionCode`: приоритет `body.provider_competition_id` → `settings_json.competition_code` → (для top_league) `tournament.tournament_code`. Для `tournament_type='european'` без override и без settings возвращается понятный warning, а не 500.
- **AllSports** использует числовой `unique_tournament_id`. Резолв в `resolveAllSportsTournamentId`: приоритет `body.provider_competition_id` (число) → `settings_json.allsports_tournament_id` → статический `SEASON_PREDICTION_ALLSPORTS_TOURNAMENT_IDS`. Статический маппинг покрывает: топ-5 (PL=17, PD=8, SA=23, BL1=35, FL1=34) и UEFA-клубные турниры по SofaScore unique-tournament IDs — UCL=7, UEL=679, UECL=17015. Если для конкретного сезона нужен другой ID — админ задаёт его через override.

**Admin UI:** в карточке «Импорт команд из API» появилось опциональное поле `Provider competition ID` с контекстным placeholder'ом (`CL / EL / UECL` для Football-Data, `числовой unique_tournament_id` для AllSports). При выбранном еврокубке показывается пояснение, что override может понадобиться. Поле перебивает статический маппинг и `settings_json`; пустое — использует сохранённые значения.

**Обработка ошибок провайдера:**
- AllSports: `HTTP 404` на standings/seasons → warning «AllSports не вернул standings …, проверьте ID или сезон»; пустой список сезонов → warning «Сезон пока недоступен у AllSports».
- Football-Data: `HTTP 404` без `season` → warning «не возвращает команды для {code}, турнир может быть недоступен на текущем тарифе»; `HTTP 403` → warning «доступ запрещён, тариф не покрывает»; `HTTP 429` → бросает `FOOTBALL_DATA_RATE_LIMITED` (как было).
- Если provider вернул не `team_count` команд (для UCL/UEL/UECL — 36), preview добавляет warning, а confirm без `force=true` падает с `TEAM_COUNT_MISMATCH`.

**Защита submitted-прогнозов:**
- `confirm` (без изменений) проверяет `season_prediction_user_entries` со статусами `submitted/locked/scoring/completed` — если такие есть, **запрещает** замену команд (`SEASON_PREDICTION_SUBMITTED_ENTRIES_EXIST`).
- Если есть только `draft` entries, замена разрешена с warning «черновики пользователей могут быть пересинхронизированы».

**Что не входит в этот этап:**
- Импорт игроков / award options для еврокубков (индивидуальные награды — только топ-5).
- Авто-кэширование provider ID в `settings_json` после успешного preview (админ сохраняет вручную).
- Поддержка `force=true` в admin UI — confirm-кнопка выключается при `actualTeamCount !== expectedTeamCount`. Принудительный путь доступен через прямой API-вызов (документация по запросу) или ручной ввод команд через textarea выше.

### 12.7. Хранение league_stage

Стадия лиги сохраняется в существующее поле `season_prediction_user_entries.table_json` (без отдельной таблицы) в формате:

```json
{
  "stage": "league_stage",
  "league_stage": {
    "top8_team_ids": [...],
    "zone_9_24_team_ids": [...],
    "winner_team_id": null
  },
  "updated_at": "..."
}
```

Это позволяет переиспользовать механику draft/submit/last_submitted_at/lock без новых таблиц. Поле `awards_json` для еврокубков сейчас не используется (NULL).

### 12.8. Задания режима Прогнозы сезона — технический статус

Добавлен пользовательский раздел `Задания` внутри `/season-predictions`. Это отдельный read-only слой режима, не связанный с общей экономикой приложения.

**Модель хранения и расчёта:**
- отдельные таблицы для заданий не добавлялись;
- существующие `tasks_catalog` и `user_task_progress` не используются, потому что они уже связаны с обычными daily/seasonal tasks, claim-flow и экономическими наградами;
- прогресс считается on-the-fly из `season_prediction_user_entries` и `season_prediction_weekly_challenge_entries`;
- endpoint не пишет прогресс, не создаёт completed records и не меняет пользовательскую экономику.

**Endpoint:**
- `GET /season-predictions/tasks` — возвращает sections/subsections/tasks, progress, status и `reward: null`.

**Статусы:**
- `available` — задание доступно, прогресс 0;
- `in_progress` — прогресс больше 0, но цель ещё не выполнена;
- `completed` — прогресс достиг цели;
- `future` — задание зарезервировано для scoring/results или недельной истории.

**Реально считаются сейчас:**
- Старт сезона: первый подтверждённый прогноз, первая таблица, первый индивидуальный выбор, полный прогноз одной лиги, подтверждение 3 лиг топ-5.
- Топ-5 лиг: заполнение таблицы, submit прогноза, выбор 3 индивидуальных наград, полный прогноз лиги; кросс-лиговые задания по 2/3/5 подтверждённым лигам, наградам во всех лигах и полному закрытию топ-5.
- Вызов недели: наличие draft/submitted entry, ответы на все active questions, submitted/locked/scoring/completed статус.
- Еврокубки: наличие draft entry, заполнение top-8, заполнение зоны 9–24, submit по каждому турниру и кросс-турнирные задания.

**Future/coming soon:**
- все задания за угадывания чемпионов, зон, позиций и индивидуальных наград;
- scoring-задания Вызова недели (`3 из 5`, `4 из 5`, `5 из 5`, отдельные типы вопросов);
- недельные серии, пока нет отдельной недельной истории;
- плей-офф задания еврокубков, пока реализована только стадия лиги.

**Что намеренно не добавлено:**
- награды;
- claim endpoint;
- запись в `stars_ledger`;
- запись в reward ledger;
- звёзды, мячи, кейсы;
- изменение текущих tasks/quests обычной игры.

### 12.9. Scoring «Топ-5 лиг» — этап S1 (data foundation + official results)

Зафиксирована формула очков (реализация движка — следующий этап S2, на S1 НЕ внедряется):

- Позиции: точная `+5`, ошибка на 1 место `+3`, на 2 места `+1`, 3+ `0`.
- Бонус за чемпиона: `+10` (если official-чемпион поставлен на 1 место).
- Очки за зоны (если команда в правильной зоне): ЛЧ `+3`/команду, ЛЕ `+2`, ЛК `+2`, вылет `+3`, стыки `+2`.
- Бонусы за зоны: ЛЧ 4/4 `+10`, ЛЧ 3/4 `+5`, вылет 100% `+8`, вылет partial `+4`, 10+ команд с ошибкой ≤2 `+10`.
- Индивидуальные награды: `awards_points = 0` (в рейтинге не участвуют на этом этапе), но `awards_correct` хранится для будущих заданий/нормализации.
- Максимум на лигу: ~163 (20 команд) / ~152 (18 команд). Нормализация не применяется; в `user_scores` хранится `points_pct` для будущего нормализованного рейтинга.

**Таблицы (миграция `0071_season_predictions_scoring_foundation.sql`):**
- `season_prediction_official_results` — admin-confirmed итоговая таблица per tournament (UNIQUE по tournament). Статусы `draft/confirmed/published/superseded`. Хранит `table_json`, `zones_snapshot_json` (снапшот зон на момент confirm), `team_ids_snapshot_json`, `source` (`admin_manual/football_data_import/allsports_import`), `provider_payload_json` для аудита, `confirmed_at/confirmed_by_admin_id`.
- `season_prediction_official_awards` — официальные победители наград (UNIQUE tournament+award_type), статусы те же.
- `season_prediction_user_scores` — score breakdown per entry. На S1 создаётся пустой, движок не заполняет.
- `season_prediction_recalc_log` — audit будущих пересчётов. На S1 пустой, пересчёты не запускаются.
- `season_prediction_leaderboard_snapshots` — НЕ создаётся на S1 (отдельный этап S4).

**Admin endpoints (только топ-5: PL, PD, SA, BL1, FL1):**
- `GET /admin/season-predictions/tournaments/:code/official-results` — текущий snapshot + awards + teams + award_options + zones.
- `PUT /admin/season-predictions/tournaments/:code/official-results` — сохранить draft (table_json + опциональные awards). Блокируется, если результат уже `confirmed` (нужен supersede).
- `POST /admin/season-predictions/tournaments/:code/official-results/confirm` — валидирует таблицу (ровно `team_count`, без дублей, все team_ids из `season_prediction_tournament_teams`), снапшотит зоны из `tournament_rules.zones_json` и список team_ids, переводит `draft → confirmed`, подтверждает draft-награды. **Scoring НЕ запускается** (`scoring_triggered: false` в ответе).

**Admin UI:** в существующей вкладке «Прогнозы сезона» для топ-5 лиг под блоками настроек добавлен блок «Официальные результаты»: переиспользует `LeagueTableOrderEditor` для итоговой таблицы, селекторы official awards из `award_options`, кнопки «Сохранить draft» и «Подтвердить official results», постоянный warning «Scoring пока не запускается (S1)». После confirm таблица переходит в read-only.

**Что НЕ внедрено на S1:** scoring engine, запуск пересчёта (`recalculate`), rollback, leaderboard, score breakdown для пользователя, rewards/economy/звёзды/мячи/кейсы, supersede UI, изменения WC2026/bracket и обычных прогнозов на матчи.

### 12.10. Scoring «Топ-5 лиг» — этап S2 (scoring engine + ручной пересчёт)

**Движок:** чистый модуль [api-worker/src/seasonPredictionScoring.ts](../api-worker/src/seasonPredictionScoring.ts) без I/O. Функция `scoreSeasonPredictionTopLeagueEntry(input) → ScoreBreakdown` принимает user/official table_json, zones_snapshot, team_ids_snapshot, teamCount, config, user awards и official awards; возвращает все поля `season_prediction_user_scores` + `breakdown` (структурный JSON с per-team деталями и бонусами) + `warnings`. Версия формулы — `top5_v1` (`TOP5_V1_CONFIG`).

**Формула top5_v1:**
- Позиции: точная `+5`, ошибка 1 `+3`, ошибка 2 `+1`, 3+ `0`.
- Зоны (если команда в правильной зоне): ЛЧ `+3`, ЛЕ `+2`, ЛК `+2`, вылет `+3`, стыки `+2`. `champion` как зона не считается — только champion bonus.
- Champion bonus `+10`, если официальный чемпион стоит у пользователя на 1 месте.
- Бонусы: ЛЧ 4/4 `+10`, ЛЧ 3/4 `+5`; вылет full `+8`, partial (2/3 или 1/2) `+4`; 10+ команд с ошибкой ≤2 `+10`.
- Awards: `awards_points = 0`; `awards_correct` считается (match по `award_option_id`, fallback `player_id`) для будущих заданий/тайбрейков.
- `max_possible_points` считается динамически из `team_count` + zones_snapshot (20-команд → 163, 18-команд → 152); `points_pct = total / max`.

**Edge cases:** пустая официальная таблица → throw (entry → failed, весь recalc не падает); пустая/дублирующая user table, неизвестные команды, mismatch снапшота → graceful warnings в `breakdown`. Только entries со статусом `submitted/locked/scoring/completed` скорятся; `draft` пропускаются (не входят в выборку).

**Endpoints (только топ-5):**
- `POST /admin/season-predictions/tournaments/:code/recalculate` — требует `official_results.status` ∈ `{confirmed, published}`; создаёт `recalc_log` (running), скорит все подходящие entries, upsert в `season_prediction_user_scores`, заполняет лог (`completed/failed`, processed/skipped/failed/avg/max). Награды/leaderboard НЕ запускаются (`rewards_triggered: false`).
- `GET /admin/season-predictions/tournaments/:code/recalc-log` — история пересчётов (до 50).
- `GET /admin/season-predictions/tournaments/:code/scores/summary` — summary последнего успешного recalc: processed/skipped/failed, avg/max, formula_version, scored_at, distribution buckets (`0-19/20-49/50-99/100+`), top-10 по total_points.

**Admin UI:** в блок «Официальные результаты» добавлена карточка «Пересчёт scores»: кнопка «Запустить пересчёт» (disabled с подсказкой «Сначала подтвердите official results», если не confirmed), summary-чипы и top-10 sanity preview после пересчёта. Notices переписаны на theme-aware (`color-mix` + `--tg-*`): убраны ярко-жёлтый warning и синий confirmed-текст; status pill draft/confirmed/published/superseded. Rollback пока не реализован (отдельный этап).

**Тесты:** [api-worker/src/__tests__/seasonPredictionScoring.test.ts](../api-worker/src/__tests__/seasonPredictionScoring.test.ts) — 12 кейсов (идеал 20/18, позиции 0/1/2/3, champion bonus, ЛЧ 4/4 и 3/4, вылет full/partial 20 и 18, consistency, awards_correct при awards_points=0, дубли/missing без падения, max_possible).

**Что НЕ внедрено на S2:** leaderboard, user-facing score breakdown/display, rollback, rewards/economy/звёзды/мячи/кейсы, scoring для еврокубков и вызова недели, изменения заданий, WC2026/bracket и обычных прогнозов.

### 12.11. Scoring «Топ-5 лиг» — этап S3 (user-facing score summary + breakdown)

Пользователь видит свои очки и объяснение начисления. Только топ-5 лиг, read-only, текущий пользователь.

**User endpoints (Telegram auth, только свои данные):**
- `GET /season-predictions/my-scores` — агрегат по топ-5: `total_points`, `max_possible_points`, `points_pct`, `scored_leagues_count`, `total_leagues`, и `leagues[]` (per-league `has_score`, `total_points`, `max_possible_points`, `points_pct`, `official_results_status`, `reason`).
- `GET /season-predictions/top-leagues/:code/my-score` — детальный score по лиге: `tournament`, `entry`, `score` (все метрики + `breakdown_json` + `formula_version` + `scored_at`), `official_results_status`, `has_score`, `reason`.

`reason` (когда `has_score=false`): `no_submitted_entry` → `official_results_not_confirmed` → `recalc_not_run` → `not_available_yet`, в порядке приоритета пайплайна. Endpoints **не меняют** scores, не отдают чужие записи и не отдают admin recalc-log/breakdown.

**Frontend:**
- Главный экран (вкладка «Топ-5 лиг»): компонент `SeasonScoreSummary` — «Очки топ‑5: X / Y», «Посчитано N из 5 лиг», percent-chip + progress bar. Если ни одна лига не посчитана — muted-текст «Очки появятся после подтверждения официальных результатов и пересчёта».
- Карточки лиг (`TopLeagueCard`): chip `X / Y · Z%` (зелёный) если score есть; «Очки позже» (muted) для submitted/locked без score. Статусы draft/submitted/locked не сломаны.
- Экран лиги (`LeaguePredictionEditor`): компонент `ScoreBreakdown` (фетчит `my-score`) — total/max + %, `scored_at`, `formula_version`; категории (Позиции/Зоны/Чемпион/Бонусы/Индивидуальные награды = 0 + awards_correct X/3); метрики (точные, ≤1, ≤2, зона ЛЧ, вылет, чемпион); список «Бонусы»; collapsed `<details>` accordion «Команды» (твоя/итоговая позиция, ошибка, очки, статус exact/close/missed, ellipsis для длинных имён). Warnings из breakdown показываются человекочитаемо.

**Empty/error states:** нет submitted entry / official не confirmed / recalc не запускался — соответствующий текст; score есть — полный разбор; entry с warnings — читаемые предупреждения. Стиль theme-aware (`color-mix` + `--tg-*`), `<details>` для accordion, без огромных таблиц, mobile-friendly.

**Что НЕ внедрено на S3:** leaderboard, rewards/economy/звёзды/мячи/кейсы, scoring еврокубков и вызова недели, изменения заданий, WC2026/bracket, обычные прогнозы. Бэкенд читает только `season_prediction_user_scores`, заполняемую ручным admin-пересчётом (S2).

## Тестовые сбросы

Добавлены admin-only инструменты для многократной ручной проверки режима `season-predictions`.

**Endpoints:**
- `GET /admin/season-predictions/reset/summary` — показывает текущие counts по сезону `club_2026_27`.
- `POST /admin/season-predictions/reset/user-data` — требует `RESET_SEASON_PREDICTIONS_USER_DATA`; удаляет `season_prediction_user_entries`, `season_prediction_user_scores` и weekly user entries.
- `POST /admin/season-predictions/reset/scoring` — требует `RESET_SEASON_PREDICTIONS_SCORING`; удаляет только `season_prediction_user_scores` и `season_prediction_recalc_log`.
- `POST /admin/season-predictions/reset/official-results` — требует `RESET_SEASON_PREDICTIONS_OFFICIAL_RESULTS`; удаляет `season_prediction_official_results`, `season_prediction_official_awards`, scores и recalc logs.
- `POST /admin/season-predictions/reset/weekly-challenges` — требует `RESET_SEASON_PREDICTIONS_WEEKLY`; удаляет weekly challenges, matches, questions и entries.
- `POST /admin/season-predictions/reset/full-season-predictions-test-data` — требует `RESET_ALL_SEASON_PREDICTIONS_TEST_DATA`; удаляет user entries, scores, recalc logs, official results/awards и weekly challenge data.

**Что НЕ удаляется тестовыми сбросами:**
- `season_prediction_seasons`;
- `season_prediction_tournaments`;
- `season_prediction_tournament_teams`;
- `season_prediction_tournament_rules`;
- `season_prediction_award_options`;
- обычные прогнозы на матчи, users, balances, economy, leagues, WC2026/bracket и общие tasks вне `season-predictions`.

Каждый destructive endpoint:
- требует admin auth;
- требует точную confirm phrase;
- считает counts до/после;
- пишет `admin_audit` с action, admin id, `seasonCode`, counts before и counts deleted.

В production использовать осторожно: это инструменты тестирования режима, не пользовательские self-service операции.

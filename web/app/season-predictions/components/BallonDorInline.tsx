"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { apiFetch } from "@/lib/api";
import { Pressable } from "@/app/components/ui/Pressable";
import type { BallonDorNominee, BallonDorResponse, SeasonPredictionEntry } from "../types";
import {
  BallonDorEmptyStep,
  BallonDorStep,
  NomineeAvatar,
  getNomineeRef,
} from "./BallonDorLadder";
import {
  BallonDorGuidedStep,
  BallonDorStartScreen,
  BallonDorWinnerReveal,
  nextGuidedPlace,
} from "./BallonDorFlow";
import { BallonDorPodium } from "./BallonDorPodium";
import { SaveSubmitBar } from "./SaveSubmitBar";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Разбирает сохранённый бюллетень на «расставленных» и «пул».
 * Лестница пустая: в отличие от таблицы лиги, ничего не предзаполняется —
 * иначе подтверждение было бы одним нажатием, а награда за него — раздачей
 * из воздуха. Всё, чего нет в черновике, лежит в пуле в алфавитном порядке
 * официального шорт-листа.
 */
export function splitNominees(
  nominees: BallonDorNominee[],
  entry: SeasonPredictionEntry | null,
  size: number,
): { slots: Slot[]; pool: BallonDorNominee[] } {
  const table = entry?.table as { ranking?: unknown; slots?: unknown } | null | undefined;
  const byId = new Map(nominees.map((nominee) => [getNomineeRef(nominee), nominee]));
  const used = new Set<string>();
  const slots: Slot[] = Array.from({ length: size }, () => null);

  // Приоритет у slots: там сохранены пропуски. `ranking` сжат, и по нему
  // игрок, поставленный на 2-е место при пустом 1-м, съехал бы наверх.
  const savedSlots = table && Array.isArray(table.slots) ? table.slots : null;
  const source = savedSlots ?? (table && Array.isArray(table.ranking) ? table.ranking : []);
  for (let i = 0; i < Math.min(source.length, size); i++) {
    const raw = source[i];
    if (raw === null || raw === undefined || raw === "") continue;
    const id = String(raw);
    const nominee = byId.get(id);
    if (!nominee || used.has(id)) continue;
    used.add(id);
    slots[i] = nominee;
  }
  const pool = nominees.filter((nominee) => !used.has(getNomineeRef(nominee)));
  return { slots, pool };
}

/**
 * Фаза экрана.
 *
 * `intro` — стартовый экран с кнопкой «Начать»: до нажатия не показываются ни
 * колода, ни пустые места. `guided` — пошаговая расстановка 30 → 2 по живому
 * треку. `reveal` — коронация последнего оставшегося кандидата. `review` —
 * прежний полный расклад (подиум, места 4–30, сохранение и подтверждение): он
 * не переделан, а перенесён в конец пути и стал экраном проверки.
 */
type Phase = "intro" | "guided" | "reveal" | "review";

/**
 * «Начал, но никого ещё не выбрал» — состояние без единого байта данных:
 * черновик пустой, и на сервере его отличить не от чего. Заводить ради него
 * поле в БД не стоит, поэтому флаг живёт в localStorage. Его потеря ничего не
 * ломает: игрок снова увидит стартовый экран, а сделанные выборы лежат в
 * черновике и определяют фазу сами.
 */
function startedKey(tournamentId: unknown) {
  return `sg:ballon-dor:started:${String(tournamentId ?? "0")}`;
}

function hasStarted(tournamentId: unknown) {
  try {
    return localStorage.getItem(startedKey(tournamentId)) === "1";
  } catch {
    return false;
  }
}

function markStarted(tournamentId: unknown) {
  try {
    localStorage.setItem(startedKey(tournamentId), "1");
  } catch {
    // Приватный режим — не повод ронять экран.
  }
}

/** Фаза при входе: дочитанный черновик решает, куда попадёт игрок. */
export function initialPhase(res: BallonDorResponse, slots: Slot[]): Phase {
  const total = res.nominee_count || res.nominees.length;
  const status = String(res.tournament?.status ?? "draft");
  const entryStatus = String(res.entry?.status || "");
  const editable = status === "open" && !["locked", "scoring", "completed"].includes(entryStatus);
  const placed = slots.filter(Boolean).length;
  // Подтверждённый прогноз, закрытый турнир и полностью расставленный черновик
  // ведут на прежний экран: пошаговый режим им нечего показать.
  if (!editable || (placed >= total && total > 0)) return "review";
  if (placed > 0 || hasStarted(res.tournament?.id)) return "guided";
  return "intro";
}

export function BallonDorInline() {
  const [data, setData] = useState<BallonDorResponse | null>(null);
  // Слоты с пропусками: slots[i] — место i+1, null — место пустое. Плотный
  // список здесь не подходит: выбор на 2-е место при пустом 1-м складывался бы
  // в начало, и игрок оказывался на 1-м.
  const [slots, setSlots] = useState<Slot[]>([]);
  const [pool, setPool] = useState<BallonDorNominee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const [moveTarget, setMoveTarget] = useState<BallonDorNominee | null>(null);
  // Выбор игрока на конкретное место — открывается тапом по пустой ступени.
  const [pickForPlace, setPickForPlace] = useState<number | null>(null);
  const [poolQuery, setPoolQuery] = useState("");
  // Промежуточный расклад поверх пошагового экрана: посмотреть и поправить уже
  // заполненные места, не начиная всё заново.
  const [ladderOpen, setLadderOpen] = useState(false);
  // Место, к которому игрок перешёл руками по лестнице. null — идём по очереди.
  const [focusedPlace, setFocusedPlace] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("review");
  const baselineRef = useRef<Slot[]>([]);

  useEffect(() => {
    let active = true;
    apiFetch<BallonDorResponse>("/season-predictions/ballon-dor")
      .then((res) => {
        if (!active) return;
        const split = splitNominees(res.nominees, res.entry, res.nominee_count || res.nominees.length);
        setData(res);
        setSlots(split.slots);
        setPool(split.pool);
        baselineRef.current = split.slots;
        setPhase(initialPhase(res, split.slots));
      })
      .catch((e: unknown) => { if (active) setError(getErrorMessage(e, "Ошибка загрузки")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
  );

  const total = data?.nominee_count ?? 30;
  const status = String(data?.tournament?.status ?? "draft");
  const entry = data?.entry ?? null;
  const canEdit = status === "open" && !["locked", "scoring", "completed"].includes(String(entry?.status || ""));
  const isSubmitted = Boolean(entry && entry.status !== "draft");
  const placedCount = useMemo(() => slots.filter(Boolean).length, [slots]);
  const complete = placedCount >= total && total > 0;

  const currentPosition = useMemo(
    () => (moveTarget ? slots.findIndex((item) => item && getNomineeRef(item) === getNomineeRef(moveTarget)) + 1 : 0),
    [moveTarget, slots],
  );

  const filteredPool = useMemo(() => {
    const query = poolQuery.trim().toLowerCase();
    if (!query) return pool;
    return pool.filter((nominee) =>
      nominee.player_name.toLowerCase().includes(query)
      || (nominee.team_name || "").toLowerCase().includes(query));
  }, [pool, poolQuery]);

  // Пошаговый режим идёт снизу вверх: текущее место — самое нижнее свободное.
  // Переход по лестнице временно перебивает очередь: выбор встанет туда, куда
  // игрок перешёл, а после этого очередь возвращается.
  const guidedPlace = useMemo(() => nextGuidedPlace(slots), [slots]);
  const activePlace = focusedPlace ?? guidedPlace;

  function focusPlace(target: number) {
    setFocusedPlace((prev) => (prev === target || target === guidedPlace ? null : target));
  }

  /**
   * Последний кандидат занимает первое место сам: выбирать не из чего, и тап
   * был бы формальностью. Вместо него — экран коронации.
   */
  useEffect(() => {
    if (phase !== "guided" || !canEdit) return;
    if (pool.length !== 1 || slots[0]) return;
    const winner = pool[0];
    const nextSlots = [...slots];
    nextSlots[0] = winner;
    setSlots(nextSlots);
    setPool([]);
    setDirty(true);
    setNotice("");
    setPhase("reveal");
    void persist(nextSlots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, canEdit, pool, slots]);

  // Расставлено всё — пошаговому экрану больше нечего показывать, отдаём игрока
  // прежнему полному раскладу для проверки и подтверждения.
  useEffect(() => {
    if (phase !== "guided" || !complete) return;
    setPhase("review");
    // Последний выбор досохраняем сразу: на экране расклада автосохранения нет,
    // и без этого тридцатый тап остался бы только на экране.
    if (canEdit && dirty && !saving) void save(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, complete]);

  /**
   * Пошаговый режим сохраняет черновик сам: игрок закрывает мини-приложение на
   * середине списка и не должен терять два десятка тапов из-за того, что не
   * нажал «Сохранить». На экране расклада сохранение остаётся ручным, как было.
   */
  useEffect(() => {
    if (phase !== "guided" || !dirty || saving || !canEdit) return;
    const timer = setTimeout(() => { void save(true); }, 900);
    return () => clearTimeout(timer);
    // `save` пересоздаётся каждый рендер: в зависимостях он перезапускал бы
    // таймер бесконечно. Актуальный черновик обеспечивают slots в списке.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, dirty, saving, canEdit, slots]);

  function apply(nextSlots: Slot[], nextPool: BallonDorNominee[]) {
    setSlots(nextSlots);
    setPool(nextPool);
    setDirty(true);
    setNotice("");
  }

  /** Возвращает игрока в колоду на его место по официальному шорт-листу. */
  function toPool(current: BallonDorNominee[], nominee: BallonDorNominee): BallonDorNominee[] {
    const order = data?.nominees.map(getNomineeRef) || [];
    return [...current, nominee].sort(
      (a, b) => order.indexOf(getNomineeRef(a)) - order.indexOf(getNomineeRef(b)));
  }

  /**
   * Ставит игрока на конкретное место; без места — на первое свободное.
   * Если место занято, прежний жилец уходит обратно в колоду, а не сдвигает
   * весь список: игрок целился именно в эту позицию.
   */
  function placeNominee(nominee: BallonDorNominee, place: number | null) {
    if (!canEdit) return;
    const index = place == null ? slots.findIndex((s) => !s) : place - 1;
    if (index < 0 || index >= slots.length) return;
    const nextSlots = [...slots];
    let nextPool = pool.filter((item) => getNomineeRef(item) !== getNomineeRef(nominee));
    // Игрок мог уже стоять на другом месте — освобождаем его.
    const prevIndex = nextSlots.findIndex((s) => s && getNomineeRef(s) === getNomineeRef(nominee));
    if (prevIndex >= 0) nextSlots[prevIndex] = null;
    const evicted = nextSlots[index];
    if (evicted) nextPool = toPool(nextPool, evicted);
    nextSlots[index] = nominee;
    apply(nextSlots, nextPool);
    setPickForPlace(null);
    setPoolQuery("");
  }

  /** Досыпает оставшихся в свободные места в текущем порядке колоды. */
  function fillRest() {
    if (!canEdit || pool.length === 0 || placedCount < AUTOFILL_MIN_PLACED) return;
    const nextSlots = [...slots];
    const rest = [...pool];
    for (let i = 0; i < nextSlots.length && rest.length; i++) {
      if (!nextSlots[i]) nextSlots[i] = rest.shift()!;
    }
    apply(nextSlots, rest);
  }

  /**
   * Снимает игрока с места и возвращает в колоду. Активное место пересчитается
   * само: освободившаяся позиция снова станет самой нижней пустой.
   */
  function releasePlace(place: number) {
    if (!canEdit) return;
    const nominee = slots[place - 1];
    if (!nominee) return;
    const nextSlots = [...slots];
    nextSlots[place - 1] = null;
    apply(nextSlots, toPool(pool, nominee));
  }

  /**
   * Отмена с экрана коронации: снимаем и победителя, и предыдущий выбор.
   * Только первое место вернуло бы игрока прямо в автокоронацию — тот же
   * победитель, только через лишний экран.
   */
  function undoCrowning() {
    if (!canEdit) return;
    const winner = slots[0];
    const runnerUpPlace = slots.length > 1 && slots[1] ? 2 : 0;
    const runnerUp = runnerUpPlace ? slots[runnerUpPlace - 1] : null;
    if (!winner && !runnerUp) return;
    const nextSlots = [...slots];
    let nextPool = pool;
    if (winner) { nextSlots[0] = null; nextPool = toPool(nextPool, winner); }
    if (runnerUp) { nextSlots[runnerUpPlace - 1] = null; nextPool = toPool(nextPool, runnerUp); }
    apply(nextSlots, nextPool);
    setPhase("guided");
  }

  function removeNominee(nominee: BallonDorNominee) {
    if (!canEdit) return;
    const nextSlots = slots.map((s) => (s && getNomineeRef(s) === getNomineeRef(nominee) ? null : s));
    apply(nextSlots, toPool(pool, nominee));
    setMoveTarget(null);
  }

  /** Перестановка двух мест местами: дырки при этом не «съезжают». */
  function swapSlots(fromIndex: number, toIndex: number) {
    const next = [...slots];
    [next[fromIndex], next[toIndex]] = [next[toIndex], next[fromIndex]];
    return next;
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!canEdit) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = slots.findIndex((s) => s && getNomineeRef(s) === String(active.id));
    const toIndex = slots.findIndex((s) => s && getNomineeRef(s) === String(over.id));
    if (fromIndex < 0 || toIndex < 0) return;
    apply(swapSlots(fromIndex, toIndex), pool);
  }

  function moveToPosition(nominee: BallonDorNominee, position: number) {
    if (!canEdit) return;
    const fromIndex = slots.findIndex((s) => s && getNomineeRef(s) === getNomineeRef(nominee));
    const toIndex = position - 1;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= slots.length || fromIndex === toIndex) {
      setMoveTarget(null);
      return;
    }
    apply(swapSlots(fromIndex, toIndex), pool);
    setMoveTarget(null);
  }

  function resetAll() {
    const split = splitNominees(data?.nominees || [], entry, total);
    setSlots(split.slots);
    setPool(split.pool);
    setDirty(false);
    setNotice("");
  }

  async function saveDraft(current: Slot[]) {
    return apiFetch<{ entry: SeasonPredictionEntry }>("/season-predictions/ballon-dor/draft", {
      method: "PUT",
      body: JSON.stringify({
        table_json: {
          // ranking сжат — по нему считаются очки; slots хранят пропуски,
          // чтобы после перезагрузки места не съезжали.
          ranking: current.filter(Boolean).map((n) => getNomineeRef(n!)),
          slots: current.map((n) => (n ? getNomineeRef(n) : null)),
        },
      }),
    });
  }

  /**
   * Отправляет переданный расклад, а не тот, что лежит в состоянии: коронация
   * последнего кандидата сохраняет слоты, которых в `slots` ещё нет.
   */
  async function persist(current: Slot[]) {
    setSaving(true);
    setError("");
    try {
      const res = await saveDraft(current);
      setData((prev) => prev ? { ...prev, entry: res.entry } : prev);
      baselineRef.current = current;
      setDirty(false);
      return true;
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Не удалось сохранить"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  /** `silent` — автосохранение пошагового режима: без плашки «Черновик сохранён». */
  async function save(silent = false) {
    const ok = await persist(slots);
    if (ok && !silent) setNotice("Черновик сохранён");
  }

  async function submit() {
    setSaving(true);
    setError("");
    try {
      // Сервер подтверждает то, что лежит в БД, а не то, что видно на экране.
      await saveDraft(slots);
      const res = await apiFetch<{ entry: SeasonPredictionEntry }>("/season-predictions/ballon-dor/submit", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setData((prev) => prev ? { ...prev, entry: res.entry } : prev);
      baselineRef.current = slots;
      setDirty(false);
      setNotice("Прогноз подтверждён");
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Не удалось подтвердить"));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Оверлеи выбора: они одинаково нужны и пошаговому экрану, и полному раскладу,
   * поэтому живут отдельной функцией, а не дублируются в двух ветках рендера.
   */
  function renderSheets() {
    return (
      <>
        {/* Выбор игрока на конкретное место */}
        {pickForPlace !== null && (
          <div
            style={sheetOverlayStyle}
            onClick={() => setPickForPlace(null)}
            role="dialog"
            aria-modal="true"
            aria-label={`Выбрать игрока на ${pickForPlace} место`}
          >
            <div style={sheetStyle} onClick={(event) => event.stopPropagation()}>
              <div style={sheetHeaderStyle}>
                <div>
                  <div style={sheetTitleStyle}>
                    {pickForPlace === 1 ? "Обладатель Золотого мяча" : `${pickForPlace} место`}
                  </div>
                  <div style={{ marginTop: 3, color: "var(--tg-hint)", fontSize: 13, fontWeight: 750 }}>
                    Осталось нерасставленных: {pool.length}
                  </div>
                </div>
                <Pressable onClick={() => setPickForPlace(null)} haptic="light" aria-label="Закрыть" style={closeButtonStyle}>
                  ×
                </Pressable>
              </div>
  
              <input
                value={poolQuery}
                onChange={(e) => setPoolQuery(e.target.value)}
                placeholder="Поиск по имени или клубу"
                aria-label="Поиск номинанта"
                style={searchInputStyle}
              />
  
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                {filteredPool.length === 0 && (
                  <div style={{ padding: 14, textAlign: "center", color: "var(--tg-hint)", fontWeight: 800, fontSize: 13 }}>
                    Никого не нашлось.
                  </div>
                )}
                {filteredPool.map((nominee) => (
                  <Pressable
                    key={getNomineeRef(nominee)}
                    onClick={() => placeNominee(nominee, pickForPlace)}
                    haptic="selection"
                    style={pickRowStyle}
                  >
                    <NomineeAvatar nominee={nominee} size={34} />
                    <div style={{ minWidth: 0, textAlign: "left" }}>
                      <div style={{ fontSize: 13.5, fontWeight: 900, color: "var(--tg-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {nominee.player_name}
                      </div>
                      {nominee.team_name && (
                        <div style={{ fontSize: 11, fontWeight: 750, color: "color-mix(in srgb, var(--tg-text) 50%, var(--tg-hint))" }}>
                          {nominee.team_name}
                        </div>
                      )}
                    </div>
                  </Pressable>
                ))}
              </div>
            </div>
          </div>
        )}
  
        {/* Перенос уже расставленного игрока на другое место */}
        {moveTarget && (
          <div
            style={sheetOverlayStyle}
            onClick={() => setMoveTarget(null)}
            role="dialog"
            aria-modal="true"
            aria-label={`Выбрать место для ${moveTarget.player_name}`}
          >
            <div style={sheetStyle} onClick={(event) => event.stopPropagation()}>
              <div style={sheetHeaderStyle}>
                <div>
                  <div style={sheetTitleStyle}>Переместить игрока</div>
                  <div style={{ marginTop: 3, color: "var(--tg-hint)", fontSize: 14, fontWeight: 750 }}>
                    {moveTarget.player_name}
                  </div>
                </div>
                <Pressable onClick={() => setMoveTarget(null)} haptic="light" aria-label="Закрыть" style={closeButtonStyle}>
                  ×
                </Pressable>
              </div>
  
              <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(128,128,128,0.5)", margin: "10px 0 14px" }}>
                Сейчас: {currentPosition} место · выбери новое
              </div>
  
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 7 }}>
                {slots.map((_, index) => {
                  const pos = index + 1;
                  const isCurrent = pos === currentPosition;
                  return (
                    <Pressable
                      key={pos}
                      onClick={() => moveToPosition(moveTarget, pos)}
                      haptic="selection"
                      aria-label={`Место ${pos}${isCurrent ? " (текущее)" : ""}`}
                      aria-pressed={isCurrent}
                      style={positionButtonStyle(isCurrent)}
                    >
                      {pos}
                    </Pressable>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Промежуточный расклад: проверить и поправить уже занятые места,
            не выходя из пошагового режима. */}
        {ladderOpen && (
          <div
            style={sheetOverlayStyle}
            onClick={() => setLadderOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Текущий расклад"
          >
            <div style={sheetStyle} onClick={(event) => event.stopPropagation()}>
              <div style={sheetHeaderStyle}>
                <div>
                  <div style={sheetTitleStyle}>Текущий расклад</div>
                  <div style={{ marginTop: 3, color: "var(--tg-hint)", fontSize: 13, fontWeight: 750 }}>
                    Занято мест: {placedCount} из {total}
                  </div>
                </div>
                <Pressable onClick={() => setLadderOpen(false)} haptic="light" aria-label="Закрыть" style={closeButtonStyle}>
                  ×
                </Pressable>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 12 }}>
                {slots.map((nominee, index) => {
                  const place = index + 1;
                  if (!nominee) {
                    return (
                      <div key={`ladder-empty-${place}`} style={ladderEmptyRowStyle}>
                        <span style={ladderPlaceStyle}>{place}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: "color-mix(in srgb, var(--tg-text) 32%, var(--tg-hint))" }}>
                          Пока пусто
                        </span>
                      </div>
                    );
                  }
                  return (
                    <Pressable
                      key={getNomineeRef(nominee)}
                      className="sg-pressable-flat"
                      onClick={() => { setLadderOpen(false); setPoolQuery(""); setPickForPlace(place); }}
                      haptic="light"
                      aria-label={`Заменить игрока на ${place} месте`}
                      style={ladderRowStyle}
                    >
                      <span style={ladderPlaceStyle}>{place}</span>
                      <NomineeAvatar nominee={nominee} size={24} />
                      <span style={{ minWidth: 0, flex: 1, textAlign: "left", fontSize: 13, fontWeight: 850, color: "var(--tg-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {nominee.player_name}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 900, color: "var(--tg-button)" }}>Заменить</span>
                    </Pressable>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  if (loading) return <div style={emptyStyle}>Загрузка номинантов…</div>;
  if (error && !data) return <div style={errorStyle}>{error}</div>;
  if (!data || !data.nominees.length) return <div style={emptyStyle}>Номинанты пока не заведены.</div>;

  const pct = Math.round((placedCount / Math.max(1, total)) * 100);

  // Стартовый экран: ни колоды, ни пустых мест — только приглашение начать.
  if (phase === "intro") {
    return (
      <BallonDorStartScreen
        total={total}
        onStart={() => {
          markStarted(data.tournament?.id);
          setPhase("guided");
        }}
      />
    );
  }

  // Пошаговая расстановка 30 → 1. Полный расклад откроется сам на 30/30.
  if (phase === "guided") {
    return (
      <>
        <BallonDorGuidedStep
          total={total}
          placedCount={placedCount}
          pool={pool}
          filteredPool={filteredPool}
          query={poolQuery}
          onQueryChange={setPoolQuery}
          slots={slots}
          place={activePlace}
          onPick={(nominee) => { placeNominee(nominee, activePlace); setFocusedPlace(null); }}
          onRelease={(target) => { releasePlace(target); setFocusedPlace(null); }}
          focused={focusedPlace !== null}
          onFocus={focusPlace}
          onUndo={() => { releasePlace(guidedPlace + 1); setFocusedPlace(null); }}
          onOpenLadder={() => setLadderOpen(true)}
        />
        {error && <div style={{ ...errorStyle, marginTop: 10 }}>{error}</div>}
        {renderSheets()}
      </>
    );
  }

  // Коронация победителя — кульминация пути; дальше только проверка расклада.
  if (phase === "reveal" && slots[0]) {
    return (
      <>
        <BallonDorWinnerReveal
          nominee={slots[0]!}
          onContinue={() => setPhase("review")}
          onUndo={canEdit ? undoCrowning : undefined}
        />
        {error && <div style={{ ...errorStyle, marginTop: 10 }}>{error}</div>}
      </>
    );
  }

  return (
    <section style={cardStyle}>
      {/* Шапка: прогресс заполнения — главный ориентир на пустой лестнице */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 950, letterSpacing: "-0.03em" }}>Золотой мяч</h2>
          <div style={{ marginTop: 2, fontSize: 11.5, fontWeight: 750, color: "color-mix(in srgb, var(--tg-text) 52%, var(--tg-hint))" }}>
            {complete ? "Все места расставлены" : `Расставлено ${placedCount} из ${total}`}
          </div>
        </div>
        {canEdit && (
          <Pressable onClick={resetAll} disabled={!dirty} haptic="light" style={resetButtonStyle(!dirty)}>
            Сброс
          </Pressable>
        )}
      </div>

      <div style={progressTrackStyle}>
        <div style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: 999,
          background: complete
            ? "linear-gradient(90deg, #ffc94a, #e0955c)"
            : "linear-gradient(90deg, color-mix(in srgb, var(--tg-button) 80%, #ffc94a), var(--tg-button))",
          transition: "width 240ms ease",
        }} />
      </div>

      {canEdit && (
        <p style={hintStyle}>
          {complete
            ? "Проверь расклад перед подтверждением: порядок меняется перетаскиванием за значок или кнопкой «Место»."
            : placedCount < 3
              ? "Начни с подиума: жми по пьедесталу и выбирай, кто заберёт Золотой мяч."
              : "Жми по игроку в колоде — он встанет на следующее свободное место. Порядок меняется перетаскиванием за значок."}
        </p>
      )}

      {/* Акт 1 — подиум. Главные 30 очков бонусами и весь смысл прогноза. */}
      <BallonDorPodium
        placed={slots}
        readOnly={!canEdit}
        onPick={(place) => { setPoolQuery(""); setPickForPlace(place); }}
        onOpen={(nominee) => setMoveTarget(nominee)}
        onRemove={removeNominee}
      />

      {/* Акты 2 и 3 — места 4–10 и 11–30. Одна зона перетаскивания на обе:
          подиум в неё не входит, туда переносят кнопкой «Место». */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={slots.slice(3).filter(Boolean).map((n) => getNomineeRef(n!))} strategy={verticalListSortingStrategy}>
          {BANDS.map((band) => {
            const places = Array.from({ length: band.to - band.from + 1 }, (_, i) => band.from + i)
              .filter((place) => place <= total);
            if (!places.length) return null;
            const filledInBand = places.filter((place) => slots[place - 1]).length;
            return (
              <div key={band.from} style={{ marginTop: 12 }}>
                <div style={bandHeaderStyle}>
                  <span>{band.title}</span>
                  <span style={{ fontWeight: 850, color: "color-mix(in srgb, var(--tg-text) 50%, var(--tg-hint))" }}>
                    {filledInBand} / {places.length}
                  </span>
                </div>
                <div style={listContainerStyle}>
                  {places.map((place) => {
                    const nominee = slots[place - 1];
                    const isLast = place === places[places.length - 1];
                    if (!nominee) {
                      return (
                        <BallonDorEmptyStep
                          key={`empty-${place}`}
                          place={place}
                          isLast={isLast}
                          onPick={() => { if (canEdit) { setPoolQuery(""); setPickForPlace(place); } }}
                        />
                      );
                    }
                    return (
                      <BallonDorStep
                        key={getNomineeRef(nominee)}
                        nominee={nominee}
                        place={place}
                        readOnly={!canEdit}
                        isLast={isLast}
                        onMoveTo={() => setMoveTarget(nominee)}
                        onRemove={() => removeNominee(nominee)}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </SortableContext>
      </DndContext>

      {/* Пул нерасставленных */}
      {canEdit && pool.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 900, color: "var(--tg-text)" }}>
              Колода · {pool.length}
            </span>
            {/* Хвост можно досыпать одной кнопкой, но только когда первая десятка
                расставлена руками: там 60 очков бонусами, а места с 11-го стоят
                по три и почти ничего не решают. Иначе «расставить всех» снова
                стало бы наградой за одно нажатие. */}
            <Pressable
              onClick={fillRest}
              disabled={placedCount < AUTOFILL_MIN_PLACED}
              haptic="light"
              style={autofillButtonStyle(placedCount < AUTOFILL_MIN_PLACED)}
            >
              {placedCount < AUTOFILL_MIN_PLACED
                ? `Дозаполнить с ${AUTOFILL_MIN_PLACED} места`
                : "Дозаполнить оставшихся"}
            </Pressable>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {pool.map((nominee) => (
              <Pressable
                key={getNomineeRef(nominee)}
                onClick={() => placeNominee(nominee, null)}
                haptic="selection"
                aria-label={`Поставить ${nominee.player_name} на следующее свободное место`}
                style={poolChipStyle}
              >
                <NomineeAvatar nominee={nominee} size={20} />
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>
                  {nominee.player_name}
                </span>
              </Pressable>
            ))}
          </div>
        </div>
      )}

      {error && <div style={{ ...errorStyle, marginTop: 10 }}>{error}</div>}

      <SaveSubmitBar
        canEdit={canEdit}
        canSubmit={complete}
        isSubmitted={isSubmitted}
        saving={saving}
        dirty={dirty}
        onSave={() => void save()}
        onSubmit={() => void submit()}
        submitLabel={isSubmitted ? "Подтвердить заново" : "Подтвердить прогноз"}
        hint={notice || (complete ? undefined : `Расставь всех ${total}, чтобы подтвердить`)}
      />

      {renderSheets()}
    </section>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const cardStyle = {
  borderRadius: 18,
  padding: "12px 12px 4px",
  background: "linear-gradient(180deg, rgba(255,255,255,0.13), rgba(255,255,255,0.06)), var(--tg-bg)",
  color: "var(--tg-text)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.12)",
} as const;

const progressTrackStyle = {
  height: 5,
  borderRadius: 999,
  background: "rgba(128,128,128,0.16)",
  overflow: "hidden",
  margin: "9px 0 8px",
} as const;

const hintStyle = {
  margin: "0 0 10px",
  color: "color-mix(in srgb, var(--tg-text) 50%, var(--tg-hint))",
  fontSize: 11,
  lineHeight: 1.4,
  fontWeight: 700,
} as const;

const listContainerStyle = {
  borderRadius: 12,
  overflow: "hidden",
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(0,0,0,0.18)",
} as const;

const poolChipStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 32,
  padding: "0 10px 0 4px",
  borderRadius: 999,
  border: "1px solid color-mix(in srgb, var(--tg-button) 24%, transparent)",
  background: "color-mix(in srgb, var(--tg-button) 10%, var(--tg-bg))",
  color: "var(--tg-text)",
  fontSize: 12,
  fontWeight: 850,
  cursor: "pointer",
} as const;

const emptyStyle = {
  padding: 24,
  borderRadius: 18,
  background: "var(--tg-bg)",
  color: "var(--tg-hint)",
  textAlign: "center",
  fontWeight: 800,
} as const;

const errorStyle = {
  padding: 14,
  borderRadius: 16,
  background: "rgba(255,59,48,0.12)",
  color: "var(--tg-destructive, #ff453a)",
  fontWeight: 800,
  fontSize: 13,
} as const;

function resetButtonStyle(disabled: boolean) {
  return {
    height: 26,
    padding: "0 10px",
    border: "none",
    borderRadius: 8,
    background: disabled ? "rgba(128,128,128,0.06)" : "rgba(128,128,128,0.12)",
    color: disabled ? "rgba(128,128,128,0.35)" : "var(--tg-hint)",
    fontSize: 11,
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
  } as const;
}

const sheetOverlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 50,
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  padding: "16px 12px calc(16px + env(safe-area-inset-bottom, 0px))",
  background: "rgba(0,0,0,0.48)",
} as const;

const sheetStyle = {
  width: "min(560px, 100%)",
  maxHeight: "80dvh",
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  borderRadius: 26,
  padding: "18px 16px",
  background: "linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04)), var(--tg-bg)",
  color: "var(--tg-text)",
  boxShadow: "0 -18px 48px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.10)",
} as const;

const sheetHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
} as const;

const sheetTitleStyle = {
  fontSize: 17,
  fontWeight: 950,
  letterSpacing: "-0.03em",
  color: "var(--tg-text)",
} as const;

const searchInputStyle = {
  width: "100%",
  height: 40,
  marginTop: 12,
  padding: "0 12px",
  borderRadius: 12,
  border: "1px solid rgba(128,128,128,0.22)",
  background: "var(--tg-secondary-bg)",
  color: "var(--tg-text)",
  fontSize: 14,
  fontWeight: 700,
  outline: "none",
} as const;

const ladderPlaceStyle = {
  width: 24,
  flexShrink: 0,
  textAlign: "center",
  fontSize: 11.5,
  fontWeight: 900,
  color: "color-mix(in srgb, var(--tg-text) 45%, var(--tg-hint))",
} as const;

const ladderRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  width: "100%",
  minHeight: 40,
  padding: "4px 10px 4px 4px",
  borderRadius: 11,
  border: "1px solid rgba(128,128,128,0.14)",
  background: "rgba(128,128,128,0.07)",
  cursor: "pointer",
} as const;

const ladderEmptyRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  minHeight: 32,
  padding: "0 10px 0 4px",
  borderRadius: 11,
  border: "1px dashed rgba(128,128,128,0.16)",
} as const;

const pickRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  minHeight: 50,
  padding: "6px 10px",
  borderRadius: 14,
  border: "1px solid rgba(128,128,128,0.14)",
  background: "rgba(128,128,128,0.07)",
  cursor: "pointer",
} as const;

const closeButtonStyle = {
  flexShrink: 0,
  width: 34,
  height: 34,
  border: "none",
  borderRadius: 999,
  background: "rgba(128,128,128,0.14)",
  color: "var(--tg-hint)",
  fontSize: 20,
  fontWeight: 400,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 1,
} as const;

function positionButtonStyle(active: boolean) {
  return {
    minHeight: 44,
    border: active ? "2px solid var(--tg-button)" : "1px solid rgba(255,255,255,0.08)",
    borderRadius: 13,
    background: active ? "color-mix(in srgb, var(--tg-button) 22%, transparent)" : "rgba(255,255,255,0.07)",
    color: active ? "var(--tg-button)" : "var(--tg-text)",
    fontSize: 15,
    fontWeight: active ? 950 : 800,
    cursor: "pointer",
  } as const;
}

// Полосы мест: подиум идёт отдельным блоком, поэтому здесь только 4+.
// Разбиение повторяет формулу — точный топ-10 даёт 60 очков бонусами, хвост
// по три очка за место.
const BANDS: Array<{ from: number; to: number; title: string }> = [
  { from: 4, to: 10, title: "Места 4–10" },
  { from: 11, to: 30, title: "Места 11–30" },
];

// Досыпать хвост можно, только когда десятка расставлена руками.
const AUTOFILL_MIN_PLACED = 10;

const bandHeaderStyle = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 8,
  margin: "0 2px 6px",
  fontSize: 12.5,
  fontWeight: 900,
  color: "var(--tg-text)",
} as const;

function autofillButtonStyle(disabled: boolean) {
  return {
    height: 28,
    padding: "0 11px",
    border: "none",
    borderRadius: 999,
    background: disabled ? "rgba(128,128,128,0.08)" : "color-mix(in srgb, var(--tg-button) 14%, var(--tg-bg))",
    color: disabled ? "rgba(128,128,128,0.4)" : "var(--tg-button)",
    fontSize: 11,
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
  } as const;
}

/** Место на лестнице: игрок или пусто. */
type Slot = BallonDorNominee | null;

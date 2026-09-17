"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminButton } from "./components/AdminButton";
import { AdminCard } from "./components/AdminCard";
import { SeasonPredictionsTaskRewardsTab } from "./SeasonPredictionsTaskRewardsTab";
import { mskInputToMs, toMskInputValue } from "./mskTime";

type FetchWithAuth = <T = unknown>(path: string, options?: RequestInit) => Promise<T | null>;

const VISIBILITY_KEY = "season_predictions.ballon_dor";
const TASKS_GROUP_KEY = "tasks.season.ballon_dor";

type Nominee = {
  id: number;
  player_name: string;
  team_name: string | null;
  nationality: string | null;
  photo_url: string | null;
};

type OfficialResponse = {
  tournament: {
    tournament_code: string;
    title: string;
    status: string;
    deadline_at: number | null;
  } | null;
  nominees: Nominee[];
  official: { status: string | null; ranking: string[]; confirmed_at: number | null };
  formula_version: string;
};

type VisibilityRow = { section_key: string; title: string; visibility: string; is_enabled: boolean };

const VISIBILITY_OPTIONS: Array<{ key: string; label: string; hint: string }> = [
  { key: "admin_only", label: "Только админам", hint: "Вкладка и задания видны лишь администраторам." },
  { key: "visible_to_all", label: "Всем игрокам", hint: "Фича открыта: вкладку и задания видят все." },
  { key: "hidden", label: "Скрыто", hint: "Не видит никто, включая админов." },
];

const STATUS_OPTIONS = ["draft", "soon", "open", "locked", "scoring", "completed", "archived"];

type RecalcResponse = {
  processed: number;
  skipped: number;
  failed: number;
  avg_points: number;
  max_points: number;
};

const MEDALS: Record<number, string> = { 1: "#ffc94a", 2: "#cfd8e3", 3: "#e0955c" };

const OFFICIAL_STATUS_LABELS: Record<string, string> = {
  draft: "черновик",
  confirmed: "подтверждён",
  published: "опубликован",
  superseded: "заменён",
};

/** Круглое фото игрока; без фото — инициал на подложке. */
function Avatar({ nominee, size = 28 }: { nominee: Nominee | undefined; size?: number }) {
  const common = {
    width: size,
    height: size,
    borderRadius: 999,
    flexShrink: 0,
    background: "rgba(128,128,128,0.18)",
  } as const;
  if (nominee?.photo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={nominee.photo_url} alt="" width={size} height={size} style={{ ...common, objectFit: "cover" }} />
    );
  }
  return (
    <div style={{
      ...common,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: Math.max(10, Math.round(size * 0.4)),
      fontWeight: 900,
      color: "var(--tg-hint, #999)",
    }}>
      {nominee?.player_name?.slice(0, 1) || "?"}
    </div>
  );
}

/**
 * Ввод официального итога «Золотого мяча»: тридцатка собирается по одному
 * игроку из списка номинантов. Свободного ввода имён здесь намеренно нет —
 * итог должен ссылаться на тех же номинантов, по которым считаются бюллетени,
 * иначе очки посчитаются мимо.
 */
export function BallonDorOfficialTab({ fetchWithAuth }: { fetchWithAuth: FetchWithAuth }) {
  const [data, setData] = useState<OfficialResponse | null>(null);
  const [ranking, setRanking] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  // Доступ и сроки — чтобы всё управление фичей жило в одном блоке.
  const [visibility, setVisibility] = useState<string>("");
  const [tasksGroupVisibility, setTasksGroupVisibility] = useState<string>("");
  const [status, setStatus] = useState("");
  const [deadlineInput, setDeadlineInput] = useState("");
  const [enrichWarnings, setEnrichWarnings] = useState<string[]>([]);
  // Подсказки для клубов вне сезона и для тёзок.
  const [teamIdsInput, setTeamIdsInput] = useState("");
  const [aliasesInput, setAliasesInput] = useState("");
  // Поиск клуба у провайдера — чтобы узнать его числовой id.
  const [teamQuery, setTeamQuery] = useState("");
  const [teamHits, setTeamHits] = useState<Array<{ id: number; name: string; country: string | null }>>([]);
  const [teamSearchNote, setTeamSearchNote] = useState("");

  async function findTeam() {
    const q = teamQuery.trim();
    if (!q) return;
    setBusy("find-team");
    setError("");
    setTeamHits([]);
    setTeamSearchNote("");
    try {
      const res = await fetchWithAuth<{
        teams: Array<{ id: number; name: string; country: string | null }>;
        endpoint_used: string | null;
        tried: Array<{ path: string; status: string }>;
      }>(`/admin/season-predictions/ballon-dor/find-team?q=${encodeURIComponent(q)}`);
      if (res) {
        setTeamHits(res.teams || []);
        setTeamSearchNote(res.teams?.length
          ? `Найдено ${res.teams.length}.`
          : `Ничего не нашлось. Пробовали: ${(res.tried || []).map((t) => `${t.path} → ${t.status}`).join("; ")}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Поиск клуба не удался");
    } finally {
      setBusy("");
    }
  }

  /** Дописывает найденный клуб в JSON подсказок, не затирая уже введённое. */
  function addTeamId(name: string, id: number) {
    let current: Record<string, unknown> = {};
    if (teamIdsInput.trim()) {
      try { current = JSON.parse(teamIdsInput); } catch { current = {}; }
    }
    // Ключ — имя клуба как он назван у номинанта, а не как у провайдера.
    const key = teamQuery.trim() || name;
    setTeamIdsInput(JSON.stringify({ ...current, [key]: id }));
    setTeamSearchNote(`Добавлено: ${key} → ${id}. Теперь нажми «Подтянуть фото».`);
  }

  const load = useCallback(async () => {
    setError("");
    try {
      const [res, vis] = await Promise.all([
        fetchWithAuth<OfficialResponse>("/admin/season-predictions/ballon-dor/official"),
        fetchWithAuth<{ sections: VisibilityRow[] }>("/admin/app-sections/visibility"),
      ]);
      if (res) {
        setData(res);
        setRanking(res.official?.ranking || []);
        setStatus(res.tournament?.status || "");
        setDeadlineInput(res.tournament?.deadline_at ? toMskInputValue(res.tournament.deadline_at * 1000) : "");
      }
      if (vis?.sections) {
        setVisibility(vis.sections.find((s) => s.section_key === VISIBILITY_KEY)?.visibility || "");
        setTasksGroupVisibility(vis.sections.find((s) => s.section_key === TASKS_GROUP_KEY)?.visibility || "");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить номинантов");
    }
  }, [fetchWithAuth]);

  useEffect(() => { void load(); }, [load]);

  async function saveVisibility(next: string) {
    setBusy("visibility");
    setError("");
    setNotice("");
    try {
      await fetchWithAuth(`/admin/app-sections/visibility/${VISIBILITY_KEY}`, {
        method: "PUT",
        body: JSON.stringify({ visibility: next, is_enabled: true }),
      });
      setVisibility(next);
      setNotice(next === "visible_to_all"
        ? "Вкладка открыта всем игрокам."
        : "Видимость обновлена.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить видимость");
    } finally {
      setBusy("");
    }
  }

  async function saveTournament() {
    setBusy("tournament");
    setError("");
    setNotice("");
    try {
      const deadlineMs = deadlineInput ? mskInputToMs(deadlineInput) : null;
      await fetchWithAuth(`/admin/season-predictions/tournaments/${data?.tournament?.tournament_code || "BALLON_DOR"}`, {
        method: "PUT",
        body: JSON.stringify({
          status,
          // Роут ждёт unix-секунды; null очищает дедлайн.
          deadline_at: deadlineMs == null ? null : Math.floor(deadlineMs / 1000),
        }),
      });
      setNotice("Статус и дедлайн сохранены.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить турнир");
    } finally {
      setBusy("");
    }
  }

  // Своя мемоизация: `data?.nominees || []` даёт новый массив на каждый рендер
  // и сбрасывал бы зависимые useMemo вхолостую.
  const nominees = useMemo(() => data?.nominees || [], [data]);
  const total = nominees.length || 30;
  const byId = useMemo(() => new Map(nominees.map((n) => [String(n.id), n])), [nominees]);
  const placedSet = useMemo(() => new Set(ranking), [ranking]);
  const pool = useMemo(() => {
    const rest = nominees.filter((n) => !placedSet.has(String(n.id)));
    const q = query.trim().toLowerCase();
    if (!q) return rest;
    return rest.filter((n) =>
      n.player_name.toLowerCase().includes(q) || (n.team_name || "").toLowerCase().includes(q));
  }, [nominees, placedSet, query]);

  const complete = ranking.length >= total && total > 0;
  // Статус официального итога человеческим языком: колонка хранит служебные
  // draft/confirmed/published/superseded, а админу нужен ответ «подтверждён или нет».
  const officialConfirmed = ["confirmed", "published"].includes(String(data?.official?.status || ""));
  const officialStatusLabel = OFFICIAL_STATUS_LABELS[String(data?.official?.status || "")] || "не подтверждён";

  function place(id: string) {
    setRanking((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setNotice("");
  }
  function unplace(id: string) {
    setRanking((prev) => prev.filter((item) => item !== id));
    setNotice("");
  }
  function move(id: string, delta: number) {
    setRanking((prev) => {
      const index = prev.indexOf(id);
      const next = index + delta;
      if (index < 0 || next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      [copy[index], copy[next]] = [copy[next], copy[index]];
      return copy;
    });
  }

  async function saveOfficial() {
    setBusy("save");
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<{ ranking: string[]; warnings: string[] }>(
        "/admin/season-predictions/ballon-dor/official",
        { method: "PUT", body: JSON.stringify({ ranking }) },
      );
      if (res) {
        setRanking(res.ranking);
        setNotice(`Официальный итог сохранён (${res.ranking.length} мест).`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить итог");
    } finally {
      setBusy("");
    }
  }

  async function recalc() {
    setBusy("recalc");
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<RecalcResponse>(
        "/admin/season-predictions/ballon-dor/recalc",
        { method: "POST", body: JSON.stringify({}) },
      );
      if (res) {
        setNotice(`Пересчёт готов: ${res.processed} бюллетеней, средний балл ${res.avg_points}, максимум ${res.max_points}. Пропущено ${res.skipped}, ошибок ${res.failed}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось пересчитать");
    } finally {
      setBusy("");
    }
  }

  async function enrich() {
    setBusy("enrich");
    setError("");
    setNotice("");
    setEnrichWarnings([]);
    // Ручные подсказки необязательны: пустое поле — пустой объект.
    let teamIds: Record<string, string> = {};
    let aliasMap: Record<string, string> = {};
    try {
      if (teamIdsInput.trim()) teamIds = JSON.parse(teamIdsInput);
      if (aliasesInput.trim()) aliasMap = JSON.parse(aliasesInput);
    } catch {
      setError("Подсказки должны быть корректным JSON, например {\"Al Nassr\": 12345}");
      setBusy("");
      return;
    }
    try {
      const res = await fetchWithAuth<{
        matched: number; total: number; warnings: string[];
        photos_uploaded?: number; photos_cached?: number;
      }>(
        "/admin/season-predictions/ballon-dor/enrich",
        { method: "POST", body: JSON.stringify({ team_ids: teamIds, aliases: aliasMap }) },
      );
      if (res) {
        const photos = `Фото в Cloudinary: залито ${res.photos_uploaded ?? 0}, уже было ${res.photos_cached ?? 0}.`;
        setNotice(`Подтянуто из провайдера: ${res.matched} из ${res.total}. ${photos}`);
        // Список показываем целиком: раньше он резался до четырёх, и часть
        // проблем просто не доезжала до глаз.
        setEnrichWarnings(res.warnings || []);
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обогатить карточки");
    } finally {
      setBusy("");
    }
  }

  return (
    // Тело группы «Золотой мяч» в переключателе турниров — тем же шаблоном, что
    // и «Вызов недели»: не сворачиваемый блок, а содержимое выбранной вкладки.
    <>
      {/* 1. Доступ и сроки — главный рубильник фичи. */}
      <AdminCard>
        <div style={{ fontSize: 16, fontWeight: 950, marginBottom: 2 }}>Доступ и сроки</div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--tg-hint, #999)", marginBottom: 10 }}>
          Видимость закрывает и вкладку, и задания сразу — это единственный рубильник «выпущено / нет».
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          {VISIBILITY_OPTIONS.map((option) => (
            <button
              key={option.key}
              onClick={() => void saveVisibility(option.key)}
              disabled={busy !== ""}
              title={option.hint}
              style={choiceChip(visibility === option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tg-hint, #999)", marginBottom: 12 }}>
          {VISIBILITY_OPTIONS.find((o) => o.key === visibility)?.hint || "Видимость не загружена."}
          {tasksGroupVisibility && tasksGroupVisibility !== "visible_to_all" && (
            <> · Внимание: группа заданий отдельно переведена в «{tasksGroupVisibility}» — задания не покажутся даже при открытой вкладке.</>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={fieldLabelStyle}>Статус турнира</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={fieldLabelStyle}>Дедлайн (МСК)</span>
            <input
              type="datetime-local"
              value={deadlineInput}
              onChange={(e) => setDeadlineInput(e.target.value)}
              style={selectStyle}
            />
          </label>
          <AdminButton size="sm" onClick={() => void saveTournament()} disabled={busy !== ""}>
            {busy === "tournament" ? "Сохраняем…" : "Сохранить"}
          </AdminButton>
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tg-hint, #999)", marginTop: 8 }}>
          Редактировать бюллетень можно только в статусе <b>open</b>. Награды за задания настраиваются
          в блоке «Награды за задания» — фильтр «Золотой мяч».
        </div>
      </AdminCard>

      {/* 2. Номинанты и официальный итог. */}
      <AdminCard>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 950 }}>Официальный итог и результаты</div>
            <div style={{ marginTop: 3, fontSize: 12, fontWeight: 700, color: "var(--tg-hint, #999)" }}>
              Собери тридцатку → «Сохранить итог» (это и есть подтверждение) → «Пересчитать очки».
            </div>
            <div style={{ marginTop: 3, fontSize: 12, fontWeight: 700, color: "var(--tg-hint, #999)" }}>
              {data?.tournament?.title || "Золотой мяч"} · расставлено {ranking.length} из {total} · итог:{" "}
              <b style={{ color: officialConfirmed ? "#34c759" : "#ff9f0a" }}>{officialStatusLabel}</b>
              {" "}· формула {data?.formula_version || "—"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <AdminButton size="sm" variant="secondary" onClick={() => void enrich()} disabled={busy !== ""}>
              {busy === "enrich" ? "Тянем…" : "Подтянуть фото"}
            </AdminButton>
            <AdminButton size="sm" onClick={() => void saveOfficial()} disabled={busy !== "" || !complete}>
              {busy === "save" ? "Сохраняем…" : "Сохранить итог"}
            </AdminButton>
            <AdminButton size="sm" variant="secondary" onClick={() => void recalc()} disabled={busy !== ""}>
              {busy === "recalc" ? "Считаем…" : "Пересчитать очки"}
            </AdminButton>
          </div>
        </div>

        {!complete && (
          <div style={noticeStyle("warn")}>
            Итог сохраняется только целиком: осталось поставить {total - ranking.length}. Неполный результат занизил бы очки всем.
          </div>
        )}
        {error && <div style={noticeStyle("error")}>{error}</div>}
        {notice && <div style={noticeStyle("ok")}>{notice}</div>}

        {enrichWarnings.length > 0 && (
          <div style={noticeStyle("warn")}>
            <b>Замечания ({enrichWarnings.length}):</b>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {enrichWarnings.map((w, i) => <li key={i} style={{ marginBottom: 2 }}>{w}</li>)}
            </ul>
          </div>
        )}

        <details style={{ marginTop: 10 }}>
          <summary style={{ fontSize: 11.5, fontWeight: 800, color: "var(--tg-hint, #999)", cursor: "pointer" }}>
            Подсказки для «Подтянуть фото» (нужны редко)
          </summary>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {/* Поиск клуба у провайдера: id руками искать негде. */}
            <div style={{ display: "grid", gap: 4 }}>
              <span style={fieldLabelStyle}>Найти клуб у провайдера и подставить его id</span>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  value={teamQuery}
                  onChange={(e) => setTeamQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void findTeam(); }}
                  placeholder="Al Nassr"
                  style={{ ...selectStyle, height: 34, flex: 1 }}
                />
                <AdminButton size="sm" variant="secondary" onClick={() => void findTeam()} disabled={busy !== ""}>
                  {busy === "find-team" ? "Ищем…" : "Найти"}
                </AdminButton>
              </div>
              {teamSearchNote && (
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--tg-hint, #999)", lineHeight: 1.4 }}>
                  {teamSearchNote}
                </div>
              )}
              {teamHits.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
                  {teamHits.map((hit) => (
                    <button key={hit.id} onClick={() => addTeamId(hit.name, hit.id)} style={poolRowStyle}>
                      <span style={{ fontSize: 12.5, fontWeight: 800 }}>
                        {hit.name}
                        {hit.country ? <span style={{ fontWeight: 700, color: "var(--tg-hint, #999)" }}> · {hit.country}</span> : null}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 900, color: "var(--tg-hint, #999)" }}>id {hit.id}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <label style={{ display: "grid", gap: 4 }}>
              <span style={fieldLabelStyle}>
                id клубов вне сезона, JSON — например {"{"}&quot;Al Nassr&quot;: 12345{"}"}
              </span>
              <input
                value={teamIdsInput}
                onChange={(e) => setTeamIdsInput(e.target.value)}
                placeholder='{"Al Nassr": 12345, "Inter Miami": 67890}'
                style={{ ...selectStyle, height: 34 }}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={fieldLabelStyle}>
                Полные имена для тёзок, JSON — например {"{"}&quot;Gabriel&quot;: &quot;Gabriel Magalhaes&quot;{"}"}
              </span>
              <input
                value={aliasesInput}
                onChange={(e) => setAliasesInput(e.target.value)}
                placeholder='{"Gabriel": "Gabriel Magalhaes"}'
                style={{ ...selectStyle, height: 34 }}
              />
            </label>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--tg-hint, #999)", lineHeight: 1.4 }}>
              id клуба — числовой идентификатор у провайдера. Нужен только тем клубам,
              которых нет среди импортированных команд сезона.
            </div>
          </div>
        </details>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginTop: 14 }}>
          {/* Собранная тридцатка */}
          <div>
            <div style={columnTitleStyle}>Итоговые места</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {ranking.length === 0 && (
                <div style={{ padding: 12, fontSize: 12, fontWeight: 700, color: "var(--tg-hint, #999)" }}>
                  Пока пусто — выбирай игроков справа, они встанут по порядку.
                </div>
              )}
              {ranking.map((id, index) => {
                const nominee = byId.get(id);
                const place = index + 1;
                const medal = MEDALS[place];
                return (
                  <div key={id} style={{
                    display: "grid",
                    gridTemplateColumns: "22px 28px 1fr auto",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 8px",
                    borderRadius: 10,
                    background: medal
                      ? `linear-gradient(90deg, ${medal}22, transparent 70%)`
                      : "rgba(128,128,128,0.06)",
                  }}>
                    <span style={{
                      fontSize: 12, fontWeight: 950, textAlign: "center",
                      color: medal || "var(--tg-hint, #999)",
                    }}>
                      {place}
                    </span>
                    <Avatar nominee={nominee} />
                    <span style={{ minWidth: 0, fontSize: 12.5, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {nominee?.player_name || `#${id}`}
                      {nominee?.team_name ? (
                        <span style={{ fontWeight: 700, color: "var(--tg-hint, #999)" }}> · {nominee.team_name}</span>
                      ) : null}
                    </span>
                    <span style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => move(id, -1)} disabled={index === 0} style={miniButtonStyle} aria-label="Выше">↑</button>
                      <button onClick={() => move(id, 1)} disabled={index === ranking.length - 1} style={miniButtonStyle} aria-label="Ниже">↓</button>
                      <button onClick={() => unplace(id)} style={miniButtonStyle} aria-label="Убрать">×</button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Пул номинантов */}
          <div>
            <div style={columnTitleStyle}>Осталось расставить ({pool.length})</div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по имени или клубу"
              style={searchStyle}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
              {pool.length === 0 && (
                <div style={{ padding: 12, fontSize: 12, fontWeight: 700, color: "var(--tg-hint, #999)" }}>
                  {ranking.length >= total ? "Все номинанты расставлены." : "Никого не нашлось."}
                </div>
              )}
              {pool.map((nominee) => (
                <button
                  key={nominee.id}
                  onClick={() => place(String(nominee.id))}
                  style={poolRowStyle}
                >
                  <Avatar nominee={nominee} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {nominee.player_name}
                    {nominee.team_name ? (
                      <span style={{ fontWeight: 700, color: "var(--tg-hint, #999)" }}> · {nominee.team_name}</span>
                    ) : null}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 900, color: "var(--tg-hint, #999)" }}>
                    → {ranking.length + 1}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </AdminCard>

      {/* 3. Задания турнира и их награды — тот же редактор, что и в глобальных
          настройках, но зафиксированный на «Золотом мяче»: копии со своей
          логикой рядом заводить нельзя, она разойдётся с оригиналом. */}
      <SeasonPredictionsTaskRewardsTab fetchWithAuth={fetchWithAuth} lockCategory="ballon_dor" />
    </>
  );
}

const columnTitleStyle = {
  fontSize: 12,
  fontWeight: 950,
  marginBottom: 8,
} as const;

const miniButtonStyle = {
  width: 24,
  height: 24,
  border: "1px solid rgba(128,128,128,0.25)",
  borderRadius: 6,
  background: "transparent",
  color: "inherit",
  fontSize: 12,
  fontWeight: 900,
  cursor: "pointer",
} as const;

const poolRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  width: "100%",
  padding: "7px 9px",
  border: "1px solid rgba(128,128,128,0.18)",
  borderRadius: 10,
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  textAlign: "left",
} as const;

const searchStyle = {
  width: "100%",
  height: 34,
  padding: "0 10px",
  borderRadius: 9,
  border: "1px solid rgba(128,128,128,0.25)",
  background: "transparent",
  color: "inherit",
  fontSize: 12.5,
  fontWeight: 700,
  outline: "none",
} as const;

function noticeStyle(tone: "ok" | "warn" | "error") {
  const colors = {
    ok: { bg: "rgba(52,199,89,0.12)", fg: "#34c759" },
    warn: { bg: "rgba(255,159,10,0.12)", fg: "#ff9f0a" },
    error: { bg: "rgba(255,59,48,0.12)", fg: "#ff3b30" },
  }[tone];
  return {
    marginTop: 10,
    padding: "8px 10px",
    borderRadius: 10,
    background: colors.bg,
    color: colors.fg,
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 1.4,
  } as const;
}

function choiceChip(active: boolean) {
  return {
    height: 30,
    padding: "0 12px",
    borderRadius: 9,
    border: active ? "1px solid var(--tg-button, #3aa1ff)" : "1px solid rgba(128,128,128,0.25)",
    background: active ? "color-mix(in srgb, var(--tg-button, #3aa1ff) 18%, transparent)" : "transparent",
    color: active ? "var(--tg-button, #3aa1ff)" : "inherit",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
  } as const;
}

const fieldLabelStyle = {
  fontSize: 11,
  fontWeight: 800,
  color: "var(--tg-hint, #999)",
} as const;

const selectStyle = {
  height: 32,
  padding: "0 8px",
  borderRadius: 8,
  border: "1px solid rgba(128,128,128,0.25)",
  background: "transparent",
  color: "inherit",
  fontSize: 12.5,
  fontWeight: 700,
} as const;

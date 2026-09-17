"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminCard } from "./components/AdminCard";
import { AdminButton } from "./components/AdminButton";
import { AdminCollapsibleSection } from "./components/AdminCollapsibleSection";
import { AdminBadge as UiBadge } from "./components/ui";
import { toMskInputValue } from "./mskTime";

type FetchWithAuth = <T = unknown>(path: string, options?: RequestInit) => Promise<T | null>;

type TournamentStats = {
  tournament_code: string;
  tournament_type: string;
  title: string;
  status: string;
  entries: number;
  submitted: number;
  drafts: number;
  awards_submitted: number;
};

type StatsResponse = {
  ok: boolean;
  season_code: string;
  participants: number;
  tournaments: TournamentStats[];
  totals: {
    top_league: { submitted: number; drafts: number; awards_submitted: number };
    european: { submitted: number; drafts: number; awards_submitted: number };
  };
  weekly: {
    challenge: { id: number; code: string; title: string; status: string; deadline_at: number | null } | null;
    is_open: boolean;
    participants: number;
    drafts: number;
  };
};

const GROUP_TITLES: Record<string, string> = {
  top_league: "По турнирам · Топ-5 лиг",
  european: "По турнирам · еврокубки",
};

const ROW_CLASS =
  "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-2xl border border-[color-mix(in_srgb,var(--tg-hint,#8a8a8a)_14%,transparent)] px-3 py-2";

// Каждое число подписано прямо рядом со своим значением: при узком экране
// строка переносится, но «37 отправлено» не отрывается от «Топ-5 лиг».
function StatRow({ title, note, values }: { title: string; note?: string; values: { label: string; value: number; strong?: boolean }[] }) {
  return (
    <div className={ROW_CLASS}>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-extrabold text-[var(--tg-text,#fff)]">{title}</div>
        {note ? <div className="text-[11px] font-semibold text-[var(--tg-hint,#999)]">{note}</div> : null}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px] font-semibold text-[var(--tg-hint,#999)]">
        {values.map((item) => (
          <span key={item.label} className="whitespace-nowrap">
            <span className={item.strong ? "text-[15px] font-black text-[var(--tg-text,#fff)]" : "font-extrabold text-[var(--tg-text,#fff)]"}>{item.value}</span>{" "}
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// Participation snapshot for the Season Predictions admin screen. Banned users are
// excluded server-side. The weekly-challenge block intentionally reports ONLY the
// currently surfaced challenge — not the all-time entry count across past weeks.
export function SeasonPredictionsStats({ fetchWithAuth }: { fetchWithAuth: FetchWithAuth }) {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth<StatsResponse>("/admin/season-predictions/stats");
      if (res?.ok) setStats(res);
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void load();
  }, [load]);

  const weekly = stats?.weekly;
  const description = stats
    ? `${stats.season_code} · участников ${stats.participants} · вызов недели ${weekly?.challenge ? weekly.participants : "—"}`
    : "загрузка…";

  return (
    <AdminCollapsibleSection
      title="Статистика"
      description={description}
      defaultOpen
      storageKey="admin:season-predictions:stats"
    >
      <AdminCard className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[12px] font-semibold leading-snug text-[var(--tg-hint,#999)]">
            Считаем только незабаненных пользователей. «Отправлено» — прогнозы со статусом выше черновика.
          </div>
          <AdminButton size="sm" variant="secondary" onClick={load} disabled={loading}>
            {loading ? "..." : "Обновить"}
          </AdminButton>
        </div>

        {!stats ? (
          <div className="text-[12px] font-semibold text-[var(--tg-hint,#999)]">{loading ? "Загрузка…" : "Нет данных"}</div>
        ) : (
          <>
            <div className="space-y-1.5">
              <StatRow
                title="Участники сезона"
                note="уникальных игроков с прогнозом"
                values={[{ label: "человек", value: stats.participants, strong: true }]}
              />
              <StatRow
                title="Все прогнозы: Топ-5 лиг"
                values={[
                  { label: "отправлено", value: stats.totals.top_league.submitted, strong: true },
                  { label: "в черновиках", value: stats.totals.top_league.drafts },
                ]}
              />
              <StatRow
                title="Все прогнозы: еврокубки"
                values={[
                  { label: "отправлено", value: stats.totals.european.submitted, strong: true },
                  { label: "в черновиках", value: stats.totals.european.drafts },
                ]}
              />
              <StatRow
                title="Прогнозы на награды"
                note="лучший игрок, бомбардир и т. п."
                values={[
                  {
                    label: "отправлено",
                    value: stats.totals.top_league.awards_submitted + stats.totals.european.awards_submitted,
                    strong: true,
                  },
                ]}
              />
            </div>

            {(["top_league", "european"] as const).map((group) => {
              const rows = stats.tournaments.filter((item) => item.tournament_type === group);
              if (!rows.length) return null;
              return (
                <div key={group} className="space-y-1.5">
                  <div className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--tg-hint,#999)]">{GROUP_TITLES[group]}</div>
                  {rows.map((row) => (
                    <StatRow
                      key={row.tournament_code}
                      title={row.title}
                      note={`${row.tournament_code} · ${row.status}`}
                      values={[
                        { label: "отправлено", value: row.submitted, strong: true },
                        { label: "в черновиках", value: row.drafts },
                        { label: "на награды", value: row.awards_submitted },
                      ]}
                    />
                  ))}
                </div>
              );
            })}

            <div className="space-y-1.5">
              <div className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--tg-hint,#999)]">Вызов недели</div>
              {!weekly?.challenge ? (
                <div className="rounded-2xl border border-[color-mix(in_srgb,var(--tg-hint,#8a8a8a)_14%,transparent)] px-3 py-2 text-[12px] font-semibold text-[var(--tg-hint,#999)]">
                  Активного вызова нет
                </div>
              ) : (
                <div className="rounded-2xl border border-[color-mix(in_srgb,var(--tg-hint,#8a8a8a)_14%,transparent)] px-3 py-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-extrabold text-[var(--tg-text,#fff)]">{weekly.challenge.title}</div>
                      <div className="text-[11px] font-semibold text-[var(--tg-hint,#999)]">
                        {weekly.challenge.code}
                        {weekly.challenge.deadline_at ? ` · дедлайн ${toMskInputValue(weekly.challenge.deadline_at * 1000).replace("T", " ")} МСК` : ""}
                      </div>
                    </div>
                    <UiBadge variant={weekly.is_open ? "success" : "neutral"} size="sm">
                      {weekly.is_open ? "приём открыт" : weekly.challenge.status}
                    </UiBadge>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px] font-semibold text-[var(--tg-hint,#999)]">
                    <span className="whitespace-nowrap">
                      <span className="text-[15px] font-black text-[var(--tg-text,#fff)]">{weekly.participants}</span> отправили ответы
                    </span>
                    <span className="whitespace-nowrap">
                      <span className="font-extrabold text-[var(--tg-text,#fff)]">{weekly.drafts}</span> начали, но не отправили
                    </span>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </AdminCard>
    </AdminCollapsibleSection>
  );
}

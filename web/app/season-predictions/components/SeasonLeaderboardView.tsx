"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { apiFetch } from "@/lib/api";
import { Pressable } from "@/app/components/ui/Pressable";
import { SegmentedControl } from "@/app/components/ui/SegmentedControl";
import { EUROPEAN_CUP_ACCENTS, TOP_LEAGUE_ACCENTS } from "../constants";
import type {
  EurocupLeaderboardCupResponse,
  EurocupLeaderboardOverallResponse,
  SeasonLeaderboardLeagueResponse,
  SeasonLeaderboardMyRank,
  SeasonLeaderboardOverallResponse,
  SeasonOverallLeaderboardResponse,
} from "../types";

// Stage S4/E4 — read-only season leaderboards, shown INSIDE «Прогнозы сезона»
// (not the general «Рейтинг» section). Live read from season_prediction_user_scores;
// no rewards, no claim, no recalc. Top-5 and eurocups stay separate (no combined
// season leaderboard on E4).

const ACCENT = "var(--tg-button)";
const DONE = "#2ec060";

type LeaderboardMode = "season" | "top5" | "eurocups";

const MODE_SWITCH: Array<{ key: LeaderboardMode; label: string }> = [
  { key: "season", label: "Общий сезон" },
  { key: "top5", label: "Топ-5 лиг" },
  { key: "eurocups", label: "Еврокубки" },
];

const TOP5_TABS: Array<{ key: string; label: string }> = [
  { key: "overall", label: "Общий" },
  { key: "PL", label: "АПЛ" },
  { key: "PD", label: "Ла Лига" },
  { key: "SA", label: "Серия А" },
  { key: "BL1", label: "Бундеслига" },
  { key: "FL1", label: "Лига 1" },
];

const EUROCUP_TABS: Array<{ key: string; label: string }> = [
  { key: "overall", label: "Общий" },
  { key: "UCL", label: "Лига чемпионов" },
  { key: "UEL", label: "Лига Европы" },
  { key: "UECL", label: "Лига конференций" },
];

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function pct(value: number): string {
  return `${Math.round((value || 0) * 100)}%`;
}

export function SeasonLeaderboardView({ onBack, initialTab = "overall", initialMode = "season" }: { onBack: () => void; initialTab?: string; initialMode?: LeaderboardMode }) {
  const [mode, setMode] = useState<LeaderboardMode>(initialMode);
  const [activeKey, setActiveKey] = useState<string>(initialTab);
  const [seasonOverall, setSeasonOverall] = useState<SeasonOverallLeaderboardResponse | null>(null);
  const [top5Overall, setTop5Overall] = useState<SeasonLeaderboardOverallResponse | null>(null);
  const [top5League, setTop5League] = useState<SeasonLeaderboardLeagueResponse | null>(null);
  const [cupOverall, setCupOverall] = useState<EurocupLeaderboardOverallResponse | null>(null);
  const [cup, setCup] = useState<EurocupLeaderboardCupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // "Общий сезон" is a single combined list — no second-level tabs.
  const tabs = mode === "season" ? [] : mode === "top5" ? TOP5_TABS : EUROCUP_TABS;

  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeKey, mode]);

  // setState lives in the click handlers (not the effect body) to avoid cascading renders.
  function selectMode(next: LeaderboardMode) {
    if (next === mode) return;
    setLoading(true);
    setError("");
    setMode(next);
    setActiveKey("overall");
  }
  function selectTab(key: string) {
    if (key === activeKey) return;
    setLoading(true);
    setError("");
    setActiveKey(key);
  }

  useEffect(() => {
    let active = true;
    const url = mode === "season"
      ? "/season-predictions/leaderboard/overall-season"
      : mode === "top5"
        ? (activeKey === "overall"
          ? "/season-predictions/leaderboard/top-leagues-overall"
          : `/season-predictions/leaderboard/top-leagues/${activeKey}`)
        : (activeKey === "overall"
          ? "/season-predictions/leaderboard/eurocups-overall"
          : `/season-predictions/leaderboard/eurocups/${activeKey}`);
    apiFetch<unknown>(url)
      .then((res) => {
        if (!active) return;
        setSeasonOverall(mode === "season" ? (res as SeasonOverallLeaderboardResponse) : null);
        setTop5Overall(mode === "top5" && activeKey === "overall" ? (res as SeasonLeaderboardOverallResponse) : null);
        setTop5League(mode === "top5" && activeKey !== "overall" ? (res as SeasonLeaderboardLeagueResponse) : null);
        setCupOverall(mode === "eurocups" && activeKey === "overall" ? (res as EurocupLeaderboardOverallResponse) : null);
        setCup(mode === "eurocups" && activeKey !== "overall" ? (res as EurocupLeaderboardCupResponse) : null);
      })
      .catch((e: unknown) => {
        if (active) setError(getErrorMessage(e, "Не удалось загрузить рейтинг"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [mode, activeKey]);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Pressable onClick={onBack} haptic="light" pressedScale={0.98} style={backButtonStyle} aria-label="Назад к прогнозам сезона">
        ← Назад
      </Pressable>

      <div>
        <h1 style={titleStyle}>Рейтинг сезона</h1>
        <p style={subtitleStyle}>{mode === "season" ? "Общий зачёт" : mode === "top5" ? "Топ-5 лиг" : "Еврокубки"}</p>
        <p style={descriptionStyle}>
          {mode === "season"
            ? "Сумма очков за топ-5 лиг и еврокубки."
            : mode === "top5"
              ? "Очки появляются после подтверждения итогов и пересчёта."
              : "Очки считаются по стадии лиги: топ-8, 9–24 и топ-24."}
        </p>
      </div>

      {/* Top-level switch: Топ-5 лиг / Еврокубки (never combined). */}
      <SegmentedControl
        value={mode}
        onChange={selectMode}
        ariaLabel="Тип рейтинга"
        pressedScale={0.98}
        trackStyle={modeSwitchStyle}
        pillStyle={{
          borderRadius: 11,
          border: `1px solid color-mix(in srgb, ${ACCENT} 52%, var(--tg-hint))`,
          background: `color-mix(in srgb, ${ACCENT} 20%, var(--tg-bg))`,
        }}
        itemStyle={modeButtonStyle}
        items={MODE_SWITCH.map((m) => ({ key: m.key, content: m.label }))}
      />

      {tabs.length > 0 && (
      <div ref={tabsRef} style={{ position: "relative" }}>
        <SegmentedControl
          value={activeKey}
          onChange={selectTab}
          ariaLabel="Разрез рейтинга"
          pressedScale={0.97}
          className="sp-lb-tabs"
          trackStyle={tabsRowStyle}
          pillStyle={{
            borderRadius: 999,
            border: `1px solid color-mix(in srgb, ${ACCENT} 50%, var(--tg-hint))`,
            background: `color-mix(in srgb, ${ACCENT} 16%, var(--tg-bg))`,
          }}
          itemStyle={tabChipStyle}
          items={tabs.map((tab) => ({ key: tab.key, content: tab.label }))}
        />
      </div>
      )}

      {loading && <div style={stateCardStyle}>Загрузка рейтинга…</div>}
      {error && !loading && <div style={errorCardStyle}>{error}</div>}

      {!loading && !error && mode === "season" && seasonOverall && (
        <SeasonOverallLeaderboard data={seasonOverall} />
      )}
      {!loading && !error && mode === "top5" && activeKey === "overall" && top5Overall && (
        <OverallLeaderboard data={top5Overall} />
      )}
      {!loading && !error && mode === "top5" && activeKey !== "overall" && top5League && (
        <LeagueLeaderboard data={top5League} code={activeKey} />
      )}
      {!loading && !error && mode === "eurocups" && activeKey === "overall" && cupOverall && (
        <EurocupOverallLeaderboard data={cupOverall} />
      )}
      {!loading && !error && mode === "eurocups" && activeKey !== "overall" && cup && (
        <EurocupCupLeaderboard data={cup} code={activeKey} />
      )}

      {/* global: the class sits on SegmentedControl's root, outside styled-jsx scoping */}
      <style jsx global>{`
        .sp-lb-tabs::-webkit-scrollbar { display: none; }
      `}</style>
    </section>
  );
}

function EurocupOverallLeaderboard({ data }: { data: EurocupLeaderboardOverallResponse }) {
  const hasItems = data.items.length > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={headerCardStyle}>
        <h2 style={headerTitleStyle}>Общий рейтинг еврокубков</h2>
        <p style={headerSubtitleStyle}>Очки за стадию лиги.</p>
      </div>

      <MyRankCard myRank={data.my_rank} hasItems={hasItems} />

      {!hasItems ? (
        <div style={emptyCardStyle}>Рейтинг появится после пересчёта очков.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {data.items.map((item) => (
            <div key={item.profile_key ?? item.rank} style={rowStyle(item.is_current_user)}>
              <RankBadge rank={item.rank} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={rowNameStyle}>{item.display_name}{item.is_current_user ? " · ты" : ""}</div>
                <div style={rowMetaStyle}>{item.total_points} / {item.max_possible_points} · {pct(item.points_pct)}</div>
              </div>
              <div style={rowAsideStyle}>{item.scored_cups_count}/{data.max_cups_count} турниров</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EurocupCupLeaderboard({ data, code }: { data: EurocupLeaderboardCupResponse; code: string }) {
  const hasItems = data.items.length > 0;
  const tone = (EUROPEAN_CUP_ACCENTS as Record<string, { tone?: string } | undefined>)[code]?.tone || ACCENT;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ ...headerCardStyle, borderColor: `color-mix(in srgb, ${tone} 30%, transparent)` }}>
        <h2 style={headerTitleStyle}>Рейтинг {data.tournament.name}</h2>
        <p style={headerSubtitleStyle}>Очки за стадию лиги.</p>
      </div>

      <MyRankCard myRank={data.my_rank} hasItems={hasItems} />

      {!hasItems ? (
        <div style={emptyCardStyle}>
          {data.empty_reason === "OFFICIAL_RESULTS_REQUIRED"
            ? "Сначала нужно подтвердить итоговые результаты."
            : "Рейтинг появится после пересчёта очков."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {data.items.map((item) => (
            <div key={item.profile_key ?? item.rank} style={rowStyle(item.is_current_user)}>
              <RankBadge rank={item.rank} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={rowNameStyle}>{item.display_name}{item.is_current_user ? " · ты" : ""}</div>
                <div style={rowMetaStyle}>{item.total_points} / {item.max_possible_points} · {pct(item.points_pct)}</div>
                <div style={chipsRowStyle}>
                  <span style={chipStyle(item.top8_correct > 0)}>Топ-8: {item.top8_correct}/8</span>
                  <span style={chipStyle(item.playoff_9_24_correct > 0)}>9–24: {item.playoff_9_24_correct}/16</span>
                  <span style={chipStyle(item.top24_correct > 0)}>Топ-24: {item.top24_correct}/24</span>
                  <span style={chipStyle(item.bonus_points > 0)}>Бонусы: {item.bonus_points}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SeasonOverallLeaderboard({ data }: { data: SeasonOverallLeaderboardResponse }) {
  const hasItems = data.items.length > 0;
  const c = data.components;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={headerCardStyle}>
        <h2 style={headerTitleStyle}>Общий рейтинг сезона</h2>
        <p style={headerSubtitleStyle}>Топ-5 + еврокубки · сумма очков за сезон.</p>
      </div>

      {data.my_rank ? (
        <div style={myRankCardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 850, color: "color-mix(in srgb, var(--tg-text) 64%, var(--tg-hint))" }}>Моё место</span>
            <span style={myRankBadgeStyle}>#{data.my_rank.rank}</span>
          </div>
          <div style={{ marginTop: 4, fontSize: 15, fontWeight: 950, color: "var(--tg-text)" }}>
            {data.my_rank.total_points} / {data.my_rank.max_possible_points} · {pct(data.my_rank.points_pct)}
          </div>
          <div style={{ marginTop: 2, fontSize: 12, fontWeight: 700, color: "var(--tg-hint)" }}>
            Отставание от лидера: {data.my_rank.gap_to_leader}
          </div>
          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
            <span style={chipStyle(c.top5.total_points > 0)}>Топ-5: {c.top5.total_points}/{c.top5.max_possible_points}</span>
            <span style={chipStyle(c.eurocups.total_points > 0)}>Еврокубки: {c.eurocups.total_points}/{c.eurocups.max_possible_points}</span>
          </div>
        </div>
      ) : hasItems ? (
        <div style={myRankEmptyStyle}>Ты появишься в рейтинге после подтверждения прогноза и пересчёта очков.</div>
      ) : null}

      {!hasItems ? (
        <div style={emptyCardStyle}>Рейтинг появится после пересчёта очков.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {data.items.map((item) => (
            <div key={item.profile_key ?? item.rank} style={rowStyle(item.is_current_user)}>
              <RankBadge rank={item.rank} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={rowNameStyle}>{item.display_name}{item.is_current_user ? " · ты" : ""}</div>
                <div style={rowMetaStyle}>{item.total_points} / {item.max_possible_points} · {pct(item.points_pct)}</div>
                <div style={chipsRowStyle}>
                  <span style={chipStyle(item.top5_points > 0)}>Топ-5 {item.top5_points}</span>
                  <span style={chipStyle(item.eurocups_points > 0)}>Евро {item.eurocups_points}</span>
                </div>
              </div>
              <div style={rowAsideStyle}>{item.scored_total_count}/{item.max_total_count} турниров</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MyRankCard({ myRank, hasItems }: { myRank: SeasonLeaderboardMyRank | null; hasItems: boolean }) {
  if (!myRank) {
    if (!hasItems) return null;
    return (
      <div style={myRankEmptyStyle}>
        Ты появишься в рейтинге после подтверждения прогноза и пересчёта очков.
      </div>
    );
  }
  return (
    <div style={myRankCardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 850, color: "color-mix(in srgb, var(--tg-text) 64%, var(--tg-hint))" }}>Моё место</span>
        <span style={myRankBadgeStyle}>#{myRank.rank}</span>
      </div>
      <div style={{ marginTop: 4, fontSize: 15, fontWeight: 950, color: "var(--tg-text)" }}>
        {myRank.total_points} / {myRank.max_possible_points} · {pct(myRank.points_pct)}
      </div>
      <div style={{ marginTop: 2, fontSize: 12, fontWeight: 700, color: "var(--tg-hint)" }}>
        Отставание от лидера: {myRank.gap_to_leader}
      </div>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const top3 = rank <= 3;
  return (
    <div style={rankBadgeStyle(top3)}>
      {rank}
    </div>
  );
}

function OverallLeaderboard({ data }: { data: SeasonLeaderboardOverallResponse }) {
  const hasItems = data.items.length > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={headerCardStyle}>
        <h2 style={headerTitleStyle}>Общий рейтинг топ-5</h2>
        <p style={headerSubtitleStyle}>Сумма очков по пяти лигам.</p>
      </div>

      <MyRankCard myRank={data.my_rank} hasItems={hasItems} />

      {!hasItems ? (
        <div style={emptyCardStyle}>
          {data.empty_reason === "OFFICIAL_RESULTS_REQUIRED"
            ? "Сначала нужно подтвердить итоговые результаты."
            : "Рейтинг появится после пересчёта очков."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {data.items.map((item) => (
            <div key={item.profile_key ?? item.rank} style={rowStyle(item.is_current_user)}>
              <RankBadge rank={item.rank} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={rowNameStyle}>{item.display_name}{item.is_current_user ? " · ты" : ""}</div>
                <div style={rowMetaStyle}>
                  {item.total_points} / {item.max_possible_points} · {pct(item.points_pct)}
                </div>
              </div>
              <div style={rowAsideStyle}>{item.scored_leagues_count}/{data.max_tournaments_count} лиг</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LeagueLeaderboard({ data, code }: { data: SeasonLeaderboardLeagueResponse; code: string }) {
  const hasItems = data.items.length > 0;
  const tone = (TOP_LEAGUE_ACCENTS as Record<string, { tone?: string } | undefined>)[code]?.tone || ACCENT;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ ...headerCardStyle, borderColor: `color-mix(in srgb, ${tone} 30%, transparent)` }}>
        <h2 style={headerTitleStyle}>Рейтинг {data.tournament.name}</h2>
        <p style={headerSubtitleStyle}>Очки за таблицу лиги.</p>
      </div>

      <MyRankCard myRank={data.my_rank} hasItems={hasItems} />

      {!hasItems ? (
        <div style={emptyCardStyle}>
          {data.empty_reason === "OFFICIAL_RESULTS_REQUIRED"
            ? "Сначала нужно подтвердить итоговые результаты."
            : "Рейтинг появится после пересчёта очков."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {data.items.map((item) => (
            <div key={item.profile_key ?? item.rank} style={rowStyle(item.is_current_user)}>
              <RankBadge rank={item.rank} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={rowNameStyle}>{item.display_name}{item.is_current_user ? " · ты" : ""}</div>
                <div style={rowMetaStyle}>
                  {item.total_points} / {item.max_possible_points} · {pct(item.points_pct)}
                </div>
                <div style={chipsRowStyle}>
                  <span style={chipStyle(item.champion_correct > 0)}>{item.champion_correct > 0 ? "✓ чемпион" : "чемпион —"}</span>
                  <span style={chipStyle(item.exact_positions > 0)}>точных: {item.exact_positions}</span>
                  <span style={chipStyle(item.ucl_zone_correct > 0)}>ЛЧ: {item.ucl_zone_correct}</span>
                  <span style={chipStyle(item.relegation_zone_correct > 0)}>вылет: {item.relegation_zone_correct}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── styles (theme-aware) ─────────────────────────────────────────────────────

const SOFT_BORDER = "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)";
const CARD_SURFACE = "linear-gradient(180deg, color-mix(in srgb, var(--tg-secondary-bg) 92%, var(--tg-bg)), color-mix(in srgb, var(--tg-bg) 82%, var(--tg-secondary-bg)))";

const backButtonStyle: CSSProperties = {
  alignSelf: "flex-start",
  minHeight: 36,
  borderRadius: 999,
  border: SOFT_BORDER,
  padding: "0 14px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 70%, var(--tg-bg))",
  color: "var(--tg-text)",
  fontSize: 13,
  fontWeight: 850,
  cursor: "pointer",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 950,
  letterSpacing: "-0.03em",
  color: "var(--tg-text)",
};

const subtitleStyle: CSSProperties = {
  margin: "3px 0 0",
  fontSize: 13,
  fontWeight: 800,
  color: "color-mix(in srgb, var(--tg-text) 64%, var(--tg-hint))",
};

const descriptionStyle: CSSProperties = {
  margin: "6px 0 0",
  fontSize: 12,
  fontWeight: 650,
  lineHeight: 1.45,
  color: "color-mix(in srgb, var(--tg-text) 54%, var(--tg-hint))",
};

const modeSwitchStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 4,
  padding: 4,
  borderRadius: 14,
  background: "color-mix(in srgb, var(--tg-secondary-bg) 82%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)",
};

// Active border/background live on the SegmentedControl pill; items keep colors only.
function modeButtonStyle(active: boolean): CSSProperties {
  return {
    minHeight: 34,
    borderRadius: 11,
    padding: "0 6px",
    color: active ? ACCENT : "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))",
    fontSize: 12,
    fontWeight: active ? 900 : 800,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    transition: "color 180ms ease",
  };
}

// Scrollable rail: the chips sit on a shared track so the pill can travel.
const tabsRowStyle: CSSProperties = {
  display: "flex",
  gap: 6,
  padding: 3,
  borderRadius: 999,
  background: "color-mix(in srgb, var(--tg-secondary-bg) 70%, var(--tg-bg))",
  border: SOFT_BORDER,
  overflowX: "auto",
  scrollbarWidth: "none",
  WebkitOverflowScrolling: "touch",
  WebkitMaskImage: "linear-gradient(90deg, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%)",
  maskImage: "linear-gradient(90deg, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%)",
};

function tabChipStyle(active: boolean): CSSProperties {
  return {
    flex: "0 0 auto",
    minHeight: 30,
    borderRadius: 999,
    padding: "0 13px",
    color: active ? ACCENT : "color-mix(in srgb, var(--tg-text) 58%, var(--tg-hint))",
    fontSize: 12,
    fontWeight: active ? 900 : 780,
    whiteSpace: "nowrap",
    transition: "color 180ms ease",
  };
}

const stateCardStyle: CSSProperties = {
  padding: 18,
  borderRadius: 16,
  background: CARD_SURFACE,
  border: SOFT_BORDER,
  color: "var(--tg-hint)",
  textAlign: "center",
  fontSize: 13,
  fontWeight: 800,
};

const errorCardStyle: CSSProperties = {
  padding: 16,
  borderRadius: 16,
  background: "color-mix(in srgb, #ff453a 12%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, #ff453a 24%, transparent)",
  color: "color-mix(in srgb, #ff453a 82%, var(--tg-text))",
  fontSize: 13,
  fontWeight: 800,
};

const emptyCardStyle: CSSProperties = {
  minHeight: 64,
  borderRadius: 14,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  padding: "16px 18px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 62%, var(--tg-bg))",
  border: "1px dashed color-mix(in srgb, var(--tg-hint) 18%, transparent)",
  color: "var(--tg-hint)",
  fontSize: 13,
  fontWeight: 750,
  lineHeight: 1.45,
};

const headerCardStyle: CSSProperties = {
  borderRadius: 16,
  padding: "12px 13px",
  background: CARD_SURFACE,
  border: SOFT_BORDER,
};

const headerTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 950,
  color: "var(--tg-text)",
};

// Plain human-readable subtitle (replaces the technical formula/count chips).
const headerSubtitleStyle: CSSProperties = {
  margin: "3px 0 0",
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1.4,
  color: "color-mix(in srgb, var(--tg-text) 56%, var(--tg-hint))",
};

const myRankCardStyle: CSSProperties = {
  borderRadius: 14,
  padding: "11px 12px",
  background: `color-mix(in srgb, ${ACCENT} 12%, var(--tg-bg))`,
  border: `1px solid color-mix(in srgb, ${ACCENT} 40%, var(--tg-hint))`,
};

const myRankEmptyStyle: CSSProperties = {
  borderRadius: 14,
  padding: "11px 12px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 62%, var(--tg-bg))",
  border: SOFT_BORDER,
  color: "var(--tg-hint)",
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1.45,
};

const myRankBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 24,
  borderRadius: 999,
  padding: "0 11px",
  background: `color-mix(in srgb, ${ACCENT} 22%, var(--tg-bg))`,
  color: ACCENT,
  fontSize: 14,
  fontWeight: 950,
};

function rowStyle(current: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    borderRadius: 13,
    padding: "9px 10px",
    background: current
      ? `color-mix(in srgb, ${ACCENT} 12%, var(--tg-bg))`
      : "color-mix(in srgb, var(--tg-secondary-bg) 76%, var(--tg-bg))",
    border: current
      ? `1px solid color-mix(in srgb, ${ACCENT} 42%, var(--tg-hint))`
      : SOFT_BORDER,
  };
}

function rankBadgeStyle(top3: boolean): CSSProperties {
  return {
    flexShrink: 0,
    width: 30,
    height: 30,
    borderRadius: 9,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    fontWeight: 950,
    background: top3
      ? `color-mix(in srgb, ${ACCENT} 18%, var(--tg-bg))`
      : "color-mix(in srgb, var(--tg-hint) 10%, transparent)",
    color: top3 ? ACCENT : "var(--tg-hint)",
    border: top3 ? `1px solid color-mix(in srgb, ${ACCENT} 34%, transparent)` : SOFT_BORDER,
  };
}

const rowNameStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 850,
  color: "var(--tg-text)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const rowMetaStyle: CSSProperties = {
  marginTop: 2,
  fontSize: 12,
  fontWeight: 750,
  color: "color-mix(in srgb, var(--tg-text) 58%, var(--tg-hint))",
};

const rowAsideStyle: CSSProperties = {
  flexShrink: 0,
  fontSize: 11,
  fontWeight: 800,
  color: "var(--tg-hint)",
};

const chipsRowStyle: CSSProperties = {
  marginTop: 5,
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
};

function chipStyle(hit: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 18,
    borderRadius: 999,
    padding: "0 7px",
    background: hit
      ? `color-mix(in srgb, ${DONE} 13%, var(--tg-bg))`
      : "color-mix(in srgb, var(--tg-hint) 10%, transparent)",
    color: hit ? DONE : "var(--tg-hint)",
    border: "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)",
    fontSize: 10,
    fontWeight: 800,
    whiteSpace: "nowrap",
  };
}

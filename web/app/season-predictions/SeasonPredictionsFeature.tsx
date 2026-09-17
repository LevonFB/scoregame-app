"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { EUROPEAN_CUP_ORDER, TOP_LEAGUE_ORDER } from "./constants";
import type {
  EuropeanCupCode,
  SeasonPredictionEntry,
  SeasonPredictionEuropeanResponse,
  SeasonPredictionSeason,
  SeasonPredictionTournament,
  SeasonPredictionTournamentResponse,
  SeasonPredictionsConfigResponse,
  TopLeagueCode,
  MyScoresResponse,
} from "./types";
import { SeasonPredictionsHome } from "./components/SeasonPredictionsHome";
import { LeaguePredictionEditor } from "./components/LeaguePredictionEditor";
import { EuropeanCupEditor } from "./components/EuropeanCupEditor";
import { SeasonLeaderboardView } from "./components/SeasonLeaderboardView";
import type { SeasonPredictionsTabId } from "./components/SeasonPredictionsTabs";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

type Selection =
  | { kind: "top-league"; code: TopLeagueCode }
  | { kind: "european-cup"; code: EuropeanCupCode };

function TopLeagueDetail({
  code,
  onBack,
  onEntryChange,
}: {
  code: TopLeagueCode;
  onBack: () => void;
  onEntryChange: (code: TopLeagueCode, entry: SeasonPredictionEntry) => void;
}) {
  const [data, setData] = useState<SeasonPredictionTournamentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiFetch<SeasonPredictionTournamentResponse>(`/season-predictions/top-leagues/${code}`)
      .then((res) => { if (active) setData(res); })
      .catch((e: unknown) => { if (active) setError(getErrorMessage(e, "Ошибка загрузки")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [code]);

  function handleEntryChange(entry: SeasonPredictionEntry) {
    setData((prev) => prev ? { ...prev, entry, tournament: { ...prev.tournament, entry } } : prev);
    onEntryChange(code, entry);
  }

  if (loading) return <LoadingBlock>Загрузка лиги…</LoadingBlock>;
  if (error || !data) return <ErrorBlock message={error || "Лига не найдена"} onBack={onBack} />;

  return <LeaguePredictionEditor data={data} onBack={onBack} onEntryChange={handleEntryChange} />;
}

function EuropeanCupDetail({
  code,
  availableCodes,
  onSwitch,
  onBack,
  onEntryChange,
}: {
  code: EuropeanCupCode;
  availableCodes?: EuropeanCupCode[];
  onSwitch?: (code: EuropeanCupCode) => void;
  onBack: () => void;
  onEntryChange: (code: EuropeanCupCode, entry: SeasonPredictionEntry) => void;
}) {
  const [data, setData] = useState<SeasonPredictionEuropeanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiFetch<SeasonPredictionEuropeanResponse>(`/season-predictions/europe/${code}`)
      .then((res) => { if (active) setData(res); })
      .catch((e: unknown) => { if (active) setError(getErrorMessage(e, "Ошибка загрузки")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [code]);

  function handleEntryChange(entry: SeasonPredictionEntry) {
    setData((prev) => prev ? { ...prev, entry, tournament: { ...prev.tournament, entry } } : prev);
    onEntryChange(code, entry);
  }

  if (loading) return <LoadingBlock>Загрузка турнира…</LoadingBlock>;
  if (error || !data) return <ErrorBlock message={error || "Турнир не найден"} onBack={onBack} />;

  return (
    <EuropeanCupEditor
      data={data}
      availableCodes={availableCodes}
      onSwitch={onSwitch}
      onBack={onBack}
      onEntryChange={handleEntryChange}
    />
  );
}

function LoadingBlock({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 24, borderRadius: 22, background: "var(--tg-bg)", color: "var(--tg-hint)", textAlign: "center", fontWeight: 800 }}>
      {children}
    </div>
  );
}

function ErrorBlock({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <button onClick={onBack} style={backButtonStyle}>Назад</button>
      <div style={{ padding: 18, borderRadius: 20, background: "rgba(255,59,48,0.12)", color: "var(--tg-destructive, #ff453a)", fontWeight: 800 }}>
        {message}
      </div>
    </div>
  );
}

const backButtonStyle = {
  alignSelf: "flex-start",
  minHeight: 40,
  borderRadius: 999,
  border: "none",
  padding: "0 14px",
  background: "var(--tg-bg)",
  color: "var(--tg-text)",
  fontSize: 14,
  fontWeight: 900,
  cursor: "pointer",
} as const;

export function SeasonPredictionsFeature({
  embedded = false,
  onOpenTasks,
  requestTab,
  visibleTabs,
}: {
  embedded?: boolean;
  // Deep-link to season tasks; optional target preselects section (top5/europe) + subsection (league/cup code).
  onOpenTasks?: (target?: { section: string; subsection: string }) => void;
  // Deep-link to a specific home tab (from the home card); token distinguishes repeat requests.
  requestTab?: { tab: SeasonPredictionsTabId; token: number };
  // Admin-controlled subsection visibility; undefined = all tabs visible.
  visibleTabs?: SeasonPredictionsTabId[];
}) {
  const [season, setSeason] = useState<SeasonPredictionSeason | null>(null);
  const [topLeagues, setTopLeagues] = useState<SeasonPredictionTournament[]>([]);
  const [europeanCups, setEuropeanCups] = useState<SeasonPredictionTournament[]>([]);
  const [activeTab, setActiveTab] = useState<SeasonPredictionsTabId>(requestTab?.tab ?? "top-leagues");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  // Leaderboard deep-link preset: which mode/tab to open the rating on.
  const [leaderboardPreset, setLeaderboardPreset] = useState<{ mode: "season" | "top5" | "eurocups"; tab: string }>({ mode: "season", tab: "overall" });
  const [myScores, setMyScores] = useState<MyScoresResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadConfig() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch<SeasonPredictionsConfigResponse>("/season-predictions/config");
      setSeason(res.season);
      const top = (res.top_leagues || res.tournaments || []).slice();
      top.sort((a, b) => TOP_LEAGUE_ORDER.indexOf(a.tournament_code as TopLeagueCode) - TOP_LEAGUE_ORDER.indexOf(b.tournament_code as TopLeagueCode));
      setTopLeagues(top);
      const european = (res.european_tournaments || []).slice();
      european.sort((a, b) => EUROPEAN_CUP_ORDER.indexOf(a.tournament_code as EuropeanCupCode) - EUROPEAN_CUP_ORDER.indexOf(b.tournament_code as EuropeanCupCode));
      setEuropeanCups(european);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Ошибка загрузки"));
    } finally {
      setLoading(false);
    }
  }

  async function loadScores() {
    try {
      const res = await apiFetch<MyScoresResponse>("/season-predictions/my-scores");
      setMyScores(res);
    } catch {
      // Scores are an enhancement layer; never block the screen on a scores failure.
      setMyScores(null);
    }
  }

  useEffect(() => {
    void loadConfig();
    void loadScores();
  }, []);

  // Apply a tab deep-link when the request token changes while already mounted
  // (initial mount is covered by the useState initializer above).
  const requestToken = requestTab?.token ?? 0;
  const requestedTab = requestTab?.tab;
  useEffect(() => {
    if (!requestToken || !requestedTab) return;
    setActiveTab(requestedTab);
    setSelection(null);
    setShowLeaderboard(false);
  }, [requestToken, requestedTab]);

  // Fall back to the first visible tab when the active one (default or deep-link)
  // was hidden by an admin, so the screen never lands on an empty tab.
  const visibleTabsKey = visibleTabs ? visibleTabs.join(",") : "";
  useEffect(() => {
    if (!visibleTabs || visibleTabs.length === 0) return;
    if (visibleTabs.includes(activeTab)) return;
    setActiveTab(visibleTabs[0]);
    setSelection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTabsKey, activeTab]);

  function patchTopLeagueEntry(code: TopLeagueCode, entry: SeasonPredictionEntry) {
    setTopLeagues((prev) => prev.map((t) => t.tournament_code === code ? { ...t, entry } : t));
  }

  function patchEuropeanCupEntry(code: EuropeanCupCode, entry: SeasonPredictionEntry) {
    setEuropeanCups((prev) => prev.map((t) => t.tournament_code === code ? { ...t, entry } : t));
  }

  // Open the season rating preset to a specific cup/league (not the general list).
  function openRating(mode: "top5" | "eurocups", tab: string) {
    setLeaderboardPreset({ mode, tab });
    setShowLeaderboard(true);
  }

  return (
    <div
      style={{
        padding: embedded ? "18px 16px calc(58px + env(safe-area-inset-bottom, 0px))" : "calc(18px + env(safe-area-inset-top, 0px)) 16px calc(58px + env(safe-area-inset-bottom, 0px))",
        maxWidth: 600,
        margin: "0 auto",
        minHeight: embedded ? "auto" : "100dvh",
        background: "var(--tg-secondary-bg)",
      }}
    >
      {loading && (
        <div style={{ padding: 28, textAlign: "center", color: "var(--tg-hint)", fontWeight: 800 }}>
          Загрузка прогнозов сезона…
        </div>
      )}
      {error && !loading && (
        <div style={{ padding: 18, borderRadius: 20, background: "rgba(255,59,48,0.12)", color: "var(--tg-destructive, #ff453a)", fontWeight: 800 }}>
          {error}
        </div>
      )}
      {!loading && !error && showLeaderboard && !selection && (
        <SeasonLeaderboardView
          onBack={() => setShowLeaderboard(false)}
          initialMode={leaderboardPreset.mode}
          initialTab={leaderboardPreset.tab}
        />
      )}
      {!loading && !error && !showLeaderboard && selection?.kind === "top-league" && (
        <TopLeagueDetail
          code={selection.code}
          onBack={() => setSelection(null)}
          onEntryChange={patchTopLeagueEntry}
        />
      )}
      {!loading && !error && !showLeaderboard && selection?.kind === "european-cup" && (
        <EuropeanCupDetail
          code={selection.code}
          availableCodes={europeanCups.map((t) => t.tournament_code as EuropeanCupCode)}
          onSwitch={(c) => setSelection({ kind: "european-cup", code: c })}
          onBack={() => setSelection(null)}
          onEntryChange={patchEuropeanCupEntry}
        />
      )}
      {!loading && !error && !showLeaderboard && !selection && (
        <SeasonPredictionsHome
          season={season}
          topLeagues={topLeagues}
          europeanCups={europeanCups}
          myScores={myScores}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          visibleTabs={visibleTabs}
          onTopLeagueEntryChange={patchTopLeagueEntry}
          onEuropeanEntryChange={patchEuropeanCupEntry}
          onOpenTasks={onOpenTasks}
          onOpenLeaderboard={() => { setLeaderboardPreset({ mode: "season", tab: "overall" }); setShowLeaderboard(true); }}
          onOpenLeagueRating={(c) => openRating("top5", c)}
          onOpenLeagueTasks={(c) => onOpenTasks?.({ section: "top5", subsection: c })}
          onOpenCupRating={(c) => openRating("eurocups", c)}
          onOpenCupTasks={(c) => onOpenTasks?.({ section: "europe", subsection: c })}
        />
      )}
    </div>
  );
}

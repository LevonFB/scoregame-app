"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { TOP_LEAGUE_ORDER } from "../constants";
import type {
  SeasonPredictionEntry,
  SeasonPredictionTournament,
  SeasonPredictionTournamentResponse,
  TopLeagueCode,
} from "../types";
import { LeaguePredictionEditor } from "./LeaguePredictionEditor";
import { TopLeagueSwitch } from "./TopLeagueSwitch";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// Inline "Топ-5 лиг" tab: one selected league at a time (league hub), no long
// list of 5 cards, no drill-in. Selector → hero → panels live in LeaguePredictionEditor.
export function TopLeaguesInline({
  tournaments,
  onEntryChange,
  onSelectedCodeChange,
}: {
  tournaments: SeasonPredictionTournament[];
  onEntryChange?: (code: TopLeagueCode, entry: SeasonPredictionEntry) => void;
  // Report the currently-selected league up so the bottom summary block can deep-link to it.
  onSelectedCodeChange?: (code: TopLeagueCode) => void;
}) {
  const codes = TOP_LEAGUE_ORDER.filter((c) => tournaments.some((t) => t.tournament_code === c));
  const [code, setCode] = useState<TopLeagueCode>(codes[0] || "PL");
  const [data, setData] = useState<SeasonPredictionTournamentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiFetch<SeasonPredictionTournamentResponse>(`/season-predictions/top-leagues/${code}`)
      .then((res) => { if (active) { setData(res); setError(""); } })
      .catch((e: unknown) => { if (active) setError(getErrorMessage(e, "Ошибка загрузки")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [code]);

  // Surface the selected league to the parent (for the bottom action block).
  useEffect(() => { onSelectedCodeChange?.(code); }, [code, onSelectedCodeChange]);

  // Switch league — reset loading here (handler), not in the effect body.
  function selectCode(next: TopLeagueCode) {
    if (next === code) return;
    setLoading(true);
    setError("");
    setData(null);
    setCode(next);
  }

  if (codes.length === 0) {
    return <div style={emptyStyle}>Топ-5 лиг сезона ещё не настроены</div>;
  }

  function handleEntryChange(entry: SeasonPredictionEntry) {
    setData((prev) => prev ? { ...prev, entry, tournament: { ...prev.tournament, entry } } : prev);
    onEntryChange?.(code, entry);
  }

  // Keep the selector visible during load/error.
  if (loading || error || !data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <TopLeagueSwitch codes={codes} activeCode={code} onSelect={selectCode} />
        <div style={loading ? loadingStyle : errorStyle}>
          {loading ? "Загрузка лиги…" : (error || "Лига не найдена")}
        </div>
      </div>
    );
  }

  return (
    <LeaguePredictionEditor
      key={code}
      data={data}
      availableCodes={codes}
      onSwitch={selectCode}
      onEntryChange={handleEntryChange}
    />
  );
}

const emptyStyle = {
  padding: 20,
  borderRadius: 16,
  background: "color-mix(in srgb, var(--tg-secondary-bg) 70%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)",
  color: "var(--tg-hint)",
  fontSize: 13,
  fontWeight: 700,
  textAlign: "center" as const,
  lineHeight: 1.5,
} as const;

const loadingStyle = {
  padding: 24,
  textAlign: "center" as const,
  color: "var(--tg-hint)",
  fontWeight: 800,
  fontSize: 13,
} as const;

const errorStyle = {
  padding: 16,
  borderRadius: 14,
  background: "color-mix(in srgb, #e5484d 12%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, #e5484d 28%, transparent)",
  color: "color-mix(in srgb, #e5484d 82%, var(--tg-text))",
  fontWeight: 800,
  fontSize: 13,
} as const;

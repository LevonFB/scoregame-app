"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { EUROPEAN_CUP_ORDER } from "../constants";
import type {
  EuropeanCupCode,
  SeasonPredictionEntry,
  SeasonPredictionEuropeanResponse,
  SeasonPredictionTournament,
} from "../types";
import { EuropeanCupEditor } from "./EuropeanCupEditor";
import { EurocupTournamentSwitch } from "./EurocupTournamentSwitch";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// Inline "Еврокубки" tab: one selected tournament at a time (no 3-card list, no
// drill-in). Tournament switch → hero → stage tabs all live in EuropeanCupEditor.
export function EuropeanCupsInline({
  tournaments,
  onEntryChange,
  onSelectedCodeChange,
}: {
  tournaments: SeasonPredictionTournament[];
  onEntryChange?: (code: EuropeanCupCode, entry: SeasonPredictionEntry) => void;
  // Report the currently-selected cup up so the bottom summary block can deep-link to it.
  onSelectedCodeChange?: (code: EuropeanCupCode) => void;
}) {
  const codes = EUROPEAN_CUP_ORDER.filter((c) => tournaments.some((t) => t.tournament_code === c));
  const [code, setCode] = useState<EuropeanCupCode>(codes[0] || "UCL");
  const [data, setData] = useState<SeasonPredictionEuropeanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiFetch<SeasonPredictionEuropeanResponse>(`/season-predictions/europe/${code}`)
      .then((res) => { if (active) { setData(res); setError(""); } })
      .catch((e: unknown) => { if (active) setError(getErrorMessage(e, "Ошибка загрузки")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [code]);

  // Surface the selected cup to the parent (for the bottom action block).
  useEffect(() => { onSelectedCodeChange?.(code); }, [code, onSelectedCodeChange]);

  // Switch tournament — reset loading here (handler), not in the effect body.
  function selectCode(next: EuropeanCupCode) {
    if (next === code) return;
    setLoading(true);
    setError("");
    setData(null);
    setCode(next);
  }

  if (codes.length === 0) {
    return (
      <div style={emptyStyle}>Еврокубки сезона ещё не настроены</div>
    );
  }

  function handleEntryChange(entry: SeasonPredictionEntry) {
    setData((prev) => prev ? { ...prev, entry, tournament: { ...prev.tournament, entry } } : prev);
    onEntryChange?.(code, entry);
  }

  // Keep the tournament switch visible during load/error so the user can still
  // change tournaments without a blank screen.
  if (loading || error || !data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <EurocupTournamentSwitch codes={codes} activeCode={code} onSelect={selectCode} />
        <div style={loading ? loadingStyle : errorStyle}>
          {loading ? "Загрузка турнира…" : (error || "Турнир не найден")}
        </div>
      </div>
    );
  }

  return (
    <EuropeanCupEditor
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

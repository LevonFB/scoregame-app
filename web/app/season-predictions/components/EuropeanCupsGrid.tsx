"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { EurocupMyScoreResponse, EuropeanCupCode, SeasonPredictionTournament } from "../types";
import { EuropeanCupCard, type EuropeanCupCardScore } from "./EuropeanCupCard";
import { EurocupTournamentSwitch } from "./EurocupTournamentSwitch";

export function EuropeanCupsGrid({
  tournaments,
  onOpenTournament,
}: {
  tournaments: SeasonPredictionTournament[];
  onOpenTournament: (code: EuropeanCupCode) => void;
}) {
  const [scoreByCode, setScoreByCode] = useState<Record<string, EuropeanCupCardScore>>({});

  // Stage E3: load calculated eurocup scores (only the listed cups, own scores).
  const codesKey = tournaments.map((t) => t.tournament_code).join(",");
  useEffect(() => {
    if (!tournaments.length) return;
    let active = true;
    Promise.allSettled(
      tournaments.map((t) => apiFetch<EurocupMyScoreResponse>(`/season-predictions/europe/${t.tournament_code}/my-score`)),
    ).then((results) => {
      if (!active) return;
      const map: Record<string, EuropeanCupCardScore> = {};
      results.forEach((r, i) => {
        if (r.status === "fulfilled" && r.value?.has_score && r.value.score) {
          map[tournaments[i].tournament_code] = {
            total_points: r.value.score.total_points,
            max_possible_points: r.value.score.max_possible_points,
            points_pct: r.value.score.points_pct,
          };
        }
      });
      setScoreByCode(map);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codesKey]);

  if (tournaments.length === 0) {
    return (
      <div style={{
        padding: 20,
        borderRadius: 16,
        background: "rgba(128,128,128,0.07)",
        border: "1px solid rgba(128,128,128,0.10)",
        color: "var(--tg-hint)",
        fontSize: 13,
        fontWeight: 700,
        textAlign: "center",
        lineHeight: 1.5,
      }}>
        Еврокубки сезона ещё не настроены
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Top tournament navigation (UX idea from tournament hubs; opens a cup). */}
      <EurocupTournamentSwitch
        codes={tournaments.map((t) => t.tournament_code as EuropeanCupCode)}
        activeCode={null}
        onSelect={onOpenTournament}
      />
      {tournaments.map((tournament) => (
        <EuropeanCupCard
          key={tournament.tournament_code}
          tournament={tournament}
          score={scoreByCode[tournament.tournament_code] || null}
          onOpen={() => onOpenTournament(tournament.tournament_code as EuropeanCupCode)}
        />
      ))}
    </div>
  );
}

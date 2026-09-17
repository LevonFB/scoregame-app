import type { MyScoresLeague, SeasonPredictionTournament, TopLeagueCode } from "../types";
import { TopLeagueCard } from "./TopLeagueCard";

export function TopLeaguesGrid({
  tournaments,
  scoreByCode,
  onOpenTournament,
}: {
  tournaments: SeasonPredictionTournament[];
  scoreByCode?: Map<TopLeagueCode, MyScoresLeague>;
  onOpenTournament: (code: TopLeagueCode) => void;
}) {
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
        Лиги сезона ещё не настроены
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {tournaments.map((tournament) => (
        <TopLeagueCard
          key={tournament.tournament_code}
          tournament={tournament}
          score={scoreByCode?.get(tournament.tournament_code as TopLeagueCode) ?? null}
          onOpen={() => onOpenTournament(tournament.tournament_code as TopLeagueCode)}
        />
      ))}
    </div>
  );
}

"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { apiFetch } from "@/lib/api";
import type {
  EurocupMyScoreResponse,
  EurocupScoreBonus,
  EurocupScoreTeam,
  EurocupPlayoffSection,
  EurocupPlayoffTieRow,
  EurocupBracketSection,
  EurocupBracketStageSection,
  EurocupBracketBonusItem,
  SeasonPredictionTeam,
} from "../types";

// Muted success green (was the brighter #3ddc6f) — calmer in dark theme.
const ACCENT = "#86efac";

const REASON_TEXT: Record<string, string> = {
  no_submitted_entry: "Сначала подтверди прогноз — без этого очки не начисляются.",
  official_results_not_confirmed: "Очки появятся после подтверждения итогов и пересчёта.",
  recalc_not_run: "Итоги подтверждены. Очки появятся после пересчёта.",
  not_available_yet: "Очки пока недоступны.",
};

const ZONE_LABEL: Record<string, string> = {
  top8: "Топ-8",
  playoff_9_24: "9–24",
  eliminated: "Вылет",
  not_in_table: "нет в таблице",
};

type TeamMeta = { name: string; shortName: string; crest: string | null };

function teamRefOf(team: SeasonPredictionTeam): string {
  return String(team.team_id || team.id);
}

function buildTeamMetaMap(teams: SeasonPredictionTeam[] | undefined): Map<string, TeamMeta> {
  const map = new Map<string, TeamMeta>();
  for (const team of teams || []) {
    const name = team.team_name || team.short_name || teamRefOf(team);
    map.set(teamRefOf(team), {
      name,
      shortName: team.short_name || compactTeamName(name),
      crest: team.crest_url || null,
    });
  }
  return map;
}

function compactTeamName(name: string): string {
  const clean = String(name || "")
    .replace(/\b(football club|club de football|club atletico|club atlético|club|fc|cf|afc)\b/gi, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return String(name || "").slice(0, 4).toUpperCase();
  const words = clean.split(" ").filter(Boolean);
  if (words.length > 1) return words.map((word) => word[0]).join("").slice(0, 4).toUpperCase();
  return clean.slice(0, 4).toUpperCase();
}

function formatScoredAt(ts: number | null): string {
  if (!ts) return "—";
  return `${new Date(ts * 1000).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" })} МСК`;
}

export function EurocupScoreBreakdown({
  code,
  teams,
  preloaded,
  stage = "league",
}: {
  code: string;
  teams?: SeasonPredictionTeam[];
  preloaded?: EurocupMyScoreResponse | null;
  stage?: "league" | "playoffs" | "bracket";
}) {
  const usePreloaded = preloaded !== undefined;
  const [fetched, setFetched] = useState<EurocupMyScoreResponse | null>(null);
  const [loading, setLoading] = useState(!usePreloaded);
  // When the parent supplies the score, use it directly (reactive to prop changes);
  // otherwise fetch it once. Keeps setState out of the effect body.
  const data = usePreloaded ? (preloaded ?? null) : fetched;

  useEffect(() => {
    if (usePreloaded) return;
    let active = true;
    apiFetch<EurocupMyScoreResponse>(`/season-predictions/europe/${code}/my-score`)
      .then((res) => { if (active) setFetched(res); })
      .catch(() => { /* breakdown is optional — stay silent on transient errors */ })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [code, usePreloaded]);

  const teamMeta = buildTeamMetaMap(teams);

  if (loading) {
    return <section style={cardStyle}><div style={{ color: "var(--tg-hint)", fontWeight: 700, fontSize: 13 }}>Загрузка очков…</div></section>;
  }
  if (!data) return null;

  // Empty / pending states.
  if (!data.has_score || !data.score) {
    const reasonText = (data.reason && REASON_TEXT[data.reason]) || REASON_TEXT.not_available_yet;
    return (
      <section style={cardStyle}>
        <h2 style={titleStyle}>Разбор очков</h2>
        <div style={mutedStyle}>{reasonText}</div>
      </section>
    );
  }

  const score = data.score;
  const bd = score.breakdown_json || {};
  const pct = Math.round((score.points_pct || 0) * 100);

  // Old/broken breakdown fallback — still show totals.
  if (!bd.zones || !bd.summary) {
    return (
      <section style={cardStyle}>
        <h2 style={titleStyle}>Разбор очков</h2>
        <div style={headlineRowStyle}>
          <span style={{ fontSize: 26, fontWeight: 950, letterSpacing: "-0.04em", color: "var(--tg-text)" }}>{score.total_points}</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))" }}>/ {score.max_possible_points}</span>
          <span style={pctChipStyle}>{pct}%</span>
        </div>
        <div style={{ marginTop: 8, ...mutedStyle }}>Подробного разбора для этого расчёта нет.</div>
      </section>
    );
  }

  const zoneTop8 = bd.zones.top8;
  const zone924 = bd.zones.playoff_9_24;
  const zoneTop24 = bd.zones.top24;
  const bonuses = bd.bonuses || [];
  const winner = bd.winner;
  const teamsList = bd.teams || [];
  const qualifiedCount = (zoneTop24?.qualified_credit_team_ids || []).length;

  const nameOf = (id: string) => teamMeta.get(id)?.name || id;
  const shortNameOf = (id: string | null | undefined) => {
    if (!id) return "—";
    return teamMeta.get(id)?.shortName || teamMeta.get(id)?.name || id;
  };

  // E8 — full breakdown (league + ties + bracket). Detected by the new sections.
  const isFull = !!(bd.playoffs || bd.bracket) || bd.formula_version === "eurocups_full_v1";
  if (isFull) {
    const ls = bd.league_stage || { points: bd.summary?.total_points ?? 0, max: bd.summary?.max_possible_points ?? 100 };
    const po = bd.playoffs;
    const br = bd.bracket;
    if (stage === "playoffs") {
      return (
        <section style={compactCardStyle}>
          <h2 style={titleStyle}>Стыки · разбор очков</h2>
          {!po || (po.max ?? 0) <= 0 ? (
            <div style={mutedStyle}>Очки за стыки появятся после подтверждения результатов и пересчёта.</div>
          ) : (
            <>
              <StageHeadline points={po.points} max={po.max} scoredAt={score.scored_at} />
              <div style={{ marginTop: 8, fontSize: 12, fontWeight: 800, color: "var(--tg-hint)" }}>
                Угадано {po.correct} из {po.total}
              </div>
              <PlayoffSection section={po} nameOf={nameOf} shortNameOf={shortNameOf} compactTitle />
            </>
          )}
        </section>
      );
    }

    if (stage === "bracket") {
      return (
        <section style={compactCardStyle}>
          <h2 style={titleStyle}>Сетка · разбор очков</h2>
          {!br || (br.max ?? 0) <= 0 ? (
            <div style={mutedStyle}>Очки сетки появятся после подтверждения результатов и пересчёта.</div>
          ) : (
            <>
              <StageHeadline points={br.points} max={br.max} scoredAt={score.scored_at} />
              <BracketSection section={br} shortNameOf={shortNameOf} compactTitle />
            </>
          )}
        </section>
      );
    }

    return (
      <section style={cardStyle}>
        <h2 style={titleStyle}>Стадия лиги · разбор очков</h2>
        <StageHeadline points={Number(ls.points || 0)} max={Number(ls.max || 100)} scoredAt={score.scored_at} />
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <ZoneSummary label="Топ-8" correct={bd.summary.top8_correct} total={(bd.zones.top8?.official_team_ids || []).length || 8}
            points={bd.zones.top8?.points ?? 0} maxPoints={bd.zones.top8?.max_points ?? 64} correctIds={bd.zones.top8?.correct_team_ids || []} nameOf={nameOf} />
          <ZoneSummary label="9–24" correct={bd.summary.playoff_9_24_correct} total={(bd.zones.playoff_9_24?.official_team_ids || []).length || 16}
            points={bd.zones.playoff_9_24?.points ?? 0} maxPoints={bd.zones.playoff_9_24?.max_points ?? 64} correctIds={bd.zones.playoff_9_24?.correct_team_ids || []} nameOf={nameOf} />
          {(bd.bonuses || []).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {(bd.bonuses || []).map((bonus) => <BonusRow key={bonus.key} bonus={bonus} />)}
            </div>
          )}
        </div>
      </section>
    );
  }

  if (stage !== "league") {
    return (
      <section style={cardStyle}>
        <h2 style={titleStyle}>{stage === "playoffs" ? "Стыки" : "Сетка"} · разбор очков</h2>
        <div style={mutedStyle}>Очки появятся после подтверждения результатов и пересчёта.</div>
      </section>
    );
  }

  return (
    <section style={cardStyle}>
      <h2 style={titleStyle}>Стадия лиги · разбор очков</h2>

      <div style={headlineRowStyle}>
        <span style={{ fontSize: 26, fontWeight: 950, letterSpacing: "-0.04em", color: "var(--tg-text)" }}>{score.total_points}</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))" }}>/ {score.max_possible_points}</span>
      </div>
      <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, color: "var(--tg-hint)" }}>
        Посчитано: {formatScoredAt(score.scored_at)}
      </div>

      {/* Categories */}
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 1 }}>
        <CategoryRow label="Топ-8" value={zoneTop8?.points ?? 0} />
        <CategoryRow label="9–24" value={zone924?.points ?? 0} />
        <CategoryRow label="Топ-24 зачёт" value={zoneTop24?.points ?? 0} muted={(zoneTop24?.points ?? 0) === 0} />
        <CategoryRow label="Бонусы" value={bonuses.reduce((a, b) => a + (b.earned ? b.points : 0), 0)} />
        <CategoryRow label="Победитель" value={0} muted hint="ожидает плей-офф" />
      </div>
      <div style={{ marginTop: 7, fontSize: 11, fontWeight: 650, color: "var(--tg-hint)", lineHeight: 1.4 }}>
        Победитель турнира пока не приносит очков — он будет учтён после плей-офф.
      </div>

      {/* Zone summaries */}
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <ZoneSummary
          label="Топ-8"
          correct={bd.summary.top8_correct}
          total={(zoneTop8?.official_team_ids || []).length || 8}
          points={zoneTop8?.points ?? 0}
          maxPoints={zoneTop8?.max_points ?? 64}
          correctIds={zoneTop8?.correct_team_ids || []}
          nameOf={nameOf}
        />
        <ZoneSummary
          label="9–24"
          correct={bd.summary.playoff_9_24_correct}
          total={(zone924?.official_team_ids || []).length || 16}
          points={zone924?.points ?? 0}
          maxPoints={zone924?.max_points ?? 64}
          correctIds={zone924?.correct_team_ids || []}
          nameOf={nameOf}
        />
      </div>

      {/* Top-24 qualified credit */}
      <div style={{ marginTop: 10 }}>
        <div style={sectionLabelStyle}>Топ-24 зачёт</div>
        {qualifiedCount > 0 ? (
          <div style={{ fontSize: 12, fontWeight: 650, color: "var(--tg-hint)", lineHeight: 1.5 }}>
            Команды в топ-24, но не в той зоне:
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 5 }}>
              {(zoneTop24?.qualified_credit_team_ids || []).map((id) => (
                <div key={id} style={qualifiedRowStyle}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameOf(id)}</span>
                  <span style={{ color: ACCENT, fontWeight: 900 }}>+2</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12, fontWeight: 650, color: "var(--tg-hint)" }}>Доп. зачёт: 0</div>
        )}
      </div>

      {/* Bonuses */}
      {bonuses.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={sectionLabelStyle}>Бонусы</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {bonuses.map((bonus) => <BonusRow key={bonus.key} bonus={bonus} />)}
          </div>
        </div>
      )}

      {/* Winner pending */}
      <div style={{ marginTop: 12 }}>
        <div style={sectionLabelStyle}>Победитель турнира</div>
        <div style={winnerCardStyle}>
          {winner?.user_team_id ? (
            <>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--tg-text)" }}>
                Твой выбор: {winner.user_team_name || nameOf(winner.user_team_id)}
              </div>
              <div style={{ marginTop: 3, fontSize: 11, fontWeight: 700, color: "var(--tg-hint)" }}>
                Статус: будет рассчитан после плей-офф · Очки: 0
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--tg-text)" }}>Победитель не выбран</div>
              <div style={{ marginTop: 3, fontSize: 11, fontWeight: 700, color: "var(--tg-hint)" }}>
                На этом этапе выбор победителя не влияет на очки.
              </div>
            </>
          )}
        </div>
      </div>

      {/* Teams — collapsed by default (36 rows). */}
      {teamsList.length > 0 && (
        <details style={detailsStyle}>
          <summary style={summaryStyle}>
            <span style={{ fontSize: 13, fontWeight: 900, color: "var(--tg-text)" }}>Команды</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tg-hint)" }}>{teamsList.length} · нажми, чтобы раскрыть</span>
          </summary>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            {teamsList.map((team) => (
              <EurocupTeamRow key={team.team_id} team={team} meta={teamMeta.get(team.team_id) ?? null} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function ZoneSummary({ label, correct, total, points, maxPoints, correctIds, nameOf }: {
  label: string; correct: number; total: number; points: number; maxPoints: number; correctIds: string[]; nameOf: (id: string) => string;
}) {
  return (
    <div style={zoneCardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 900, color: "var(--tg-text)" }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--tg-hint)" }}>
          Угадано {correct}/{total} · {points}/{maxPoints}
        </span>
      </div>
      {correctIds.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 7 }}>
          {correctIds.map((id) => (
            <span key={id} style={teamChipStyle}>{nameOf(id)}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function BonusRow({ bonus }: { bonus: EurocupScoreBonus }) {
  return (
    <div style={bonus.earned ? bonusRowEarnedStyle : bonusRowMutedStyle}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: bonus.earned ? "var(--tg-text)" : "var(--tg-hint)" }}>{bonus.label}</span>
      <span style={{ fontSize: 12.5, fontWeight: 900, color: bonus.earned ? ACCENT : "var(--tg-hint)" }}>
        {bonus.earned ? `+${bonus.points}` : "0"}
      </span>
    </div>
  );
}

const TEAM_STATUS: Record<string, { label: string; color: string }> = {
  exact_top8: { label: "точно", color: ACCENT },
  exact_9_24: { label: "точно", color: ACCENT },
  qualified_wrong_zone: { label: "зона перепутана", color: "color-mix(in srgb, #d98a1a 80%, var(--tg-text))" },
  eliminated: { label: "вылет", color: "color-mix(in srgb, var(--tg-text) 50%, var(--tg-hint))" },
  unknown_team: { label: "нет в таблице", color: "var(--tg-hint)" },
};

function EurocupTeamRow({ team, meta }: { team: EurocupScoreTeam; meta: TeamMeta | null }) {
  const status = TEAM_STATUS[team.status] || { label: team.status, color: "var(--tg-hint)" };
  const displayName = meta?.name || team.team_name || team.team_id;
  return (
    <div style={teamRowStyle}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: status.color, flexShrink: 0 }} />
      {meta?.crest && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={meta.crest} alt="" width={18} height={18} style={{ width: 18, height: 18, objectFit: "contain", flexShrink: 0, opacity: 0.92 }} />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--tg-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {displayName}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tg-hint)" }}>
          Твой {ZONE_LABEL[team.user_zone]} · Итог {ZONE_LABEL[team.official_zone]}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: team.points > 0 ? "var(--tg-text)" : "var(--tg-hint)" }}>
          {team.points > 0 ? `+${team.points}` : "0"}
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: status.color }}>{status.label}</div>
      </div>
    </div>
  );
}

// ── E8 full-breakdown components ─────────────────────────────────────────────

function StageHeadline({ points, max, scoredAt }: { points: number; max: number; scoredAt: number | null }) {
  const pct = max > 0 ? Math.round((points / max) * 100) : 0;
  return (
    <>
      <div style={headlineRowStyle}>
        <span style={{ fontSize: 26, fontWeight: 950, letterSpacing: "-0.04em", color: "var(--tg-text)" }}>{points}</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))" }}>/ {max}</span>
        <span style={pctChipStyle}>{pct}%</span>
      </div>
      <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, color: "var(--tg-hint)" }}>
        Посчитано: {formatScoredAt(scoredAt)}
      </div>
    </>
  );
}

function PlayoffSection({
  section,
  nameOf,
  shortNameOf,
  compactTitle,
}: {
  section: EurocupPlayoffSection;
  nameOf: (id: string) => string;
  shortNameOf: (id: string | null | undefined) => string;
  compactTitle?: boolean;
}) {
  return (
    <div style={{ marginTop: compactTitle ? 8 : 12 }}>
      {!compactTitle && <div style={sectionLabelStyle}>Стыки</div>}
      {!section.predicted ? (
        <div style={fullMutedStyle}>Прогноз стыков не подтверждён.</div>
      ) : section.total === 0 ? (
        <div style={fullMutedStyle}>Результаты стыков ещё не подтверждены.</div>
      ) : (
        <div style={compactTitle ? playoffListCardStyle : zoneCardStyle}>
          {!compactTitle && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 900, color: "var(--tg-text)" }}>Угадано {section.correct}/{section.total}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: "var(--tg-hint)" }}>{section.points}/{section.max}</span>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: compactTitle ? 0 : 7 }}>
            {section.matches.map((m) => <TieRow key={m.match_key} m={m} nameOf={nameOf} shortNameOf={shortNameOf} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function TieRow({
  m,
  nameOf,
  shortNameOf,
}: {
  m: EurocupPlayoffTieRow;
  nameOf: (id: string) => string;
  shortNameOf: (id: string | null | undefined) => string;
}) {
  const ok = m.status === "correct";
  const wrong = m.status === "wrong";
  const officialShort = shortNameOf(m.official_winner_team_id);
  const userShort = shortNameOf(m.user_winner_team_id);
  const officialFull = nameOf(m.official_winner_team_id);
  const userFull = m.user_winner_team_id ? nameOf(m.user_winner_team_id) : "—";
  const rowColor = ok ? ACCENT : wrong ? "color-mix(in srgb, #d98a1a 82%, var(--tg-text))" : "var(--tg-hint)";
  const title = ok
    ? `✓ ${officialShort}`
    : wrong
      ? `× ${userShort} ≠ ${officialShort}`
      : `— ${officialShort}`;
  return (
    <div style={tieRowStyle(ok, wrong)}>
      <div style={{ minWidth: 0 }}>
        <div title={wrong ? `${userFull} ≠ ${officialFull}` : officialFull} style={{ fontSize: 12.5, fontWeight: 900, color: rowColor, lineHeight: 1.2 }}>
          {title}
        </div>
        <div style={tieDetailStyle}>
          Твой: {userShort} · Итог: {officialShort}
        </div>
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 950, color: ok ? ACCENT : wrong ? "color-mix(in srgb, #d98a1a 82%, var(--tg-text))" : "var(--tg-hint)" }}>
        {m.points > 0 ? `+${m.points}` : "0"}
      </span>
    </div>
  );
}

function BracketSection({
  section,
  shortNameOf,
  compactTitle,
}: {
  section: EurocupBracketSection;
  shortNameOf: (id: string | null | undefined) => string;
  compactTitle?: boolean;
}) {
  if (!section.predicted) {
    return (
      <div style={{ marginTop: 12 }}>
        {!compactTitle && <div style={sectionLabelStyle}>Сетка</div>}
        <div style={fullMutedStyle}>Прогноз сетки не подтверждён.</div>
      </div>
    );
  }
  if (section.max <= 0) {
    return (
      <div style={{ marginTop: 12 }}>
        {!compactTitle && <div style={sectionLabelStyle}>Сетка</div>}
        <div style={fullMutedStyle}>Сетка ещё не рассчитана.</div>
      </div>
    );
  }
  const champ = section.champion;
  const bonusPoints = Object.values(section.bonuses).reduce((sum, bonus) => sum + (bonus.resolved ? bonus.points : 0), 0);
  const bonusMax = Object.values(section.bonuses).reduce((sum, bonus) => sum + (bonus.resolved ? bonus.max : 0), 0);
  return (
    <div style={{ marginTop: compactTitle ? 8 : 12 }}>
      {!compactTitle && <div style={sectionLabelStyle}>Сетка <span style={{ fontWeight: 700, color: "var(--tg-hint)" }}>· {section.points}/{section.max}</span></div>}
      <div style={bracketSummaryCardStyle}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <BracketStageLine label="1/4" s={section.quarterfinalists} unit="команд" />
          <BracketStageLine label="1/2" s={section.semifinalists} unit="команд" />
          <BracketStageLine label="Финалисты" s={section.finalists} unit="" />
          <BracketChampionLine champ={champ} shortNameOf={shortNameOf} />
        </div>
        <div style={bracketBonusGroupStyle}>
          <div style={bracketBonusHeaderStyle}>
            <span>Бонусы</span>
            <span style={{ color: bonusMax > 0 ? "var(--tg-text)" : "var(--tg-hint)" }}>{bonusMax > 0 ? `${bonusPoints}/${bonusMax}` : "ещё нет"}</span>
          </div>
          <BracketBonusRow label="8 четвертьфиналистов" bonus={section.bonuses.all_quarterfinalists} pendingText="после 1/8" />
          <BracketBonusRow label="4 полуфиналиста" bonus={section.bonuses.all_semifinalists} pendingText="после 1/4" />
          <BracketBonusRow label="оба финалиста" bonus={section.bonuses.all_finalists} pendingText="после 1/2" />
          <BracketBonusRow label="Чемпион" bonus={section.bonuses.champion_bonus} pendingText="после финала" />
        </div>
      </div>
    </div>
  );
}

function BracketStageLine({ label, s, unit }: { label: string; s: EurocupBracketStageSection; unit: string }) {
  const resolvedColor = s.points > 0 ? ACCENT : "color-mix(in srgb, #d98a1a 82%, var(--tg-text))";
  return (
    <div style={bracketLineStyle}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 900, color: "var(--tg-text)", lineHeight: 1.2 }}>{label}</div>
        <div style={{ marginTop: 2, fontSize: 11.5, fontWeight: 750, color: "var(--tg-hint)", lineHeight: 1.25 }}>
          {s.resolved ? `${s.correct} из ${s.total}${unit ? ` ${unit}` : ""}` : "ещё не рассчитано"}
        </div>
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 950, color: s.resolved ? resolvedColor : "var(--tg-hint)" }}>
        {s.resolved ? `${s.points}/${s.max}` : "—"}
      </span>
    </div>
  );
}

function BracketChampionLine({ champ, shortNameOf }: {
  champ: EurocupBracketSection["champion"];
  shortNameOf: (id: string | null | undefined) => string;
}) {
  if (!champ.resolved) {
    return (
      <div style={bracketLineStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 900, color: "var(--tg-text)", lineHeight: 1.2 }}>Чемпион</div>
          <div style={{ marginTop: 2, fontSize: 11.5, fontWeight: 750, color: "var(--tg-hint)", lineHeight: 1.25 }}>ещё не рассчитано</div>
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 950, color: "var(--tg-hint)" }}>—</span>
      </div>
    );
  }
  const user = shortNameOf(champ.user_team_id);
  const official = shortNameOf(champ.official_team_id);
  return (
    <div style={bracketLineStyle}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 900, color: champ.correct ? ACCENT : "color-mix(in srgb, #d98a1a 82%, var(--tg-text))", lineHeight: 1.2 }}>
          {champ.correct ? `✓ Чемпион: ${official}` : "× Чемпион"}
        </div>
        {!champ.correct && (
          <div style={{ marginTop: 2, fontSize: 11.5, fontWeight: 750, color: "var(--tg-hint)", lineHeight: 1.25, overflowWrap: "anywhere" }}>
            Твой: {user} · Итог: {official}
          </div>
        )}
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 950, color: champ.correct ? ACCENT : "var(--tg-hint)" }}>
        {champ.points > 0 ? `+${champ.points}` : "0"}/{champ.max}
      </span>
    </div>
  );
}

function BracketBonusRow({ label, bonus, pendingText }: { label: string; bonus: EurocupBracketBonusItem; pendingText: string }) {
  const earned = bonus.resolved && bonus.earned;
  return (
    <div style={earned ? bracketBonusEarnedStyle : bracketBonusMutedStyle}>
      <span style={{ minWidth: 0, fontSize: 12, fontWeight: 800, color: bonus.resolved ? "var(--tg-text)" : "var(--tg-hint)", lineHeight: 1.25 }}>
        {bonus.resolved ? (bonus.earned ? "✓ " : "× ") : ""}
        {label}
      </span>
      <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 950, color: earned ? ACCENT : "var(--tg-hint)" }}>
        {bonus.resolved ? (bonus.points > 0 ? `+${bonus.points}` : "0") : pendingText}
      </span>
    </div>
  );
}

function CategoryRow({ label, value, muted, hint }: { label: string; value: number; muted?: boolean; hint?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "7px 0", borderBottom: "1px solid color-mix(in srgb, var(--tg-hint) 8%, transparent)" }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: muted ? "var(--tg-hint)" : "var(--tg-text)", minWidth: 0 }}>
        {label}
        {hint && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: "var(--tg-hint)" }}>{hint}</span>}
      </span>
      <span style={{ fontSize: 14, fontWeight: 900, color: muted ? "var(--tg-hint)" : "var(--tg-text)" }}>
        {value > 0 ? `+${value}` : value}
      </span>
    </div>
  );
}

const cardStyle: CSSProperties = {
  borderRadius: 18,
  padding: 16,
  background: "linear-gradient(180deg, color-mix(in srgb, var(--tg-secondary-bg) 90%, var(--tg-bg)), color-mix(in srgb, var(--tg-bg) 84%, var(--tg-secondary-bg)))",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)",
  boxShadow: "0 7px 18px color-mix(in srgb, var(--tg-text) 10%, transparent)",
  color: "var(--tg-text)",
};
const compactCardStyle: CSSProperties = {
  ...cardStyle,
  padding: 12,
};

const titleStyle: CSSProperties = { margin: 0, fontSize: 15, fontWeight: 950, letterSpacing: "-0.02em", color: "var(--tg-text)" };
const headlineRowStyle: CSSProperties = { display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 };
const mutedStyle: CSSProperties = { marginTop: 8, fontSize: 12.5, fontWeight: 700, lineHeight: 1.45, color: "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))" };
const pctChipStyle: CSSProperties = {
  marginLeft: "auto", display: "inline-flex", alignItems: "center", height: 24, padding: "0 10px",
  borderRadius: 999, fontSize: 12, fontWeight: 900,
  background: "color-mix(in srgb, #34c759 16%, var(--tg-bg))", color: ACCENT,
  border: "1px solid color-mix(in srgb, #34c759 26%, transparent)",
};
const sectionLabelStyle: CSSProperties = { fontSize: 12, fontWeight: 900, color: "var(--tg-hint)", marginBottom: 6 };
const zoneCardStyle: CSSProperties = {
  borderRadius: 12, padding: "10px 12px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 60%, transparent)",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)",
};
const playoffListCardStyle: CSSProperties = {
  borderRadius: 12,
  padding: 6,
  background: "color-mix(in srgb, var(--tg-secondary-bg) 54%, transparent)",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)",
};
const bracketSummaryCardStyle: CSSProperties = {
  borderRadius: 12,
  padding: "6px 7px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 54%, transparent)",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)",
};
const teamChipStyle: CSSProperties = {
  display: "inline-flex", alignItems: "center", minHeight: 22, padding: "0 8px", borderRadius: 999,
  background: "color-mix(in srgb, #34c759 12%, var(--tg-bg))", color: ACCENT,
  border: "1px solid color-mix(in srgb, #34c759 20%, transparent)",
  fontSize: 11, fontWeight: 800, whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis",
};
const qualifiedRowStyle: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
  padding: "6px 10px", borderRadius: 8,
  background: "color-mix(in srgb, #d98a1a 10%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, #d98a1a 20%, transparent)",
  color: "var(--tg-text)", fontSize: 12, fontWeight: 700,
};
const bonusRowEarnedStyle: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
  padding: "7px 10px", borderRadius: 8,
  background: "color-mix(in srgb, #34c759 8%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, #34c759 16%, transparent)",
};
const bonusRowMutedStyle: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
  padding: "7px 10px", borderRadius: 8,
  background: "color-mix(in srgb, var(--tg-secondary-bg) 55%, transparent)",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)",
};
const bracketBonusGroupStyle: CSSProperties = {
  marginTop: 6,
  paddingTop: 6,
  borderTop: "1px solid color-mix(in srgb, var(--tg-hint) 9%, transparent)",
  display: "flex",
  flexDirection: "column",
  gap: 2,
};
const bracketBonusHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "0 2px 1px",
  fontSize: 12,
  fontWeight: 950,
  color: "var(--tg-text)",
};
const bracketBonusEarnedStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 8,
  padding: "3px 6px",
  borderRadius: 7,
  background: "color-mix(in srgb, #34c759 5%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, #34c759 11%, transparent)",
};
const bracketBonusMutedStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 8,
  padding: "3px 6px",
  borderRadius: 7,
  background: "color-mix(in srgb, var(--tg-secondary-bg) 48%, transparent)",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 8%, transparent)",
};
const winnerCardStyle: CSSProperties = {
  borderRadius: 12, padding: "10px 12px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 60%, transparent)",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)",
};
const detailsStyle: CSSProperties = {
  marginTop: 12, borderRadius: 12, padding: "10px 12px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 55%, transparent)",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)",
};
const summaryStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer", listStyle: "none", userSelect: "none" };
const teamRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid color-mix(in srgb, var(--tg-hint) 8%, transparent)" };
const fullMutedStyle: CSSProperties = { fontSize: 12, fontWeight: 700, lineHeight: 1.4, color: "var(--tg-hint)", padding: "4px 0" };
const tieRowStyle = (ok: boolean, wrong: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 8,
  padding: "6px 7px",
  borderRadius: 8,
  background: ok
    ? "color-mix(in srgb, #34c759 5%, var(--tg-bg))"
    : wrong
      ? "color-mix(in srgb, #d98a1a 5%, var(--tg-bg))"
      : "color-mix(in srgb, var(--tg-secondary-bg) 48%, transparent)",
  border: `1px solid ${ok
    ? "color-mix(in srgb, #34c759 11%, transparent)"
    : wrong
      ? "color-mix(in srgb, #d98a1a 10%, transparent)"
      : "color-mix(in srgb, var(--tg-hint) 8%, transparent)"}`,
  color: "var(--tg-text)",
});
const tieDetailStyle: CSSProperties = {
  marginTop: 2,
  fontSize: 11.5,
  fontWeight: 750,
  lineHeight: 1.25,
  color: "color-mix(in srgb, var(--tg-text) 58%, var(--tg-hint))",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
};
const bracketLineStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 8,
  padding: "5px 5px",
  borderRadius: 8,
  borderBottom: "1px solid color-mix(in srgb, var(--tg-hint) 7%, transparent)",
};

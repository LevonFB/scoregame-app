"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { apiFetch } from "@/lib/api";
import { Pressable } from "@/app/components/ui/Pressable";
import { AppIcon } from "@/app/components/ui/AppIcon";
import type { SeasonPredictionTeam } from "../types";
import bstyles from "./eurocupBracket.module.css";

// E6 — user playoff (knockout) prediction. Stage-by-stage round cards, NOT a giant
// bracket. Users pick winners only for matches with both teams confirmed by admin.
// No scoring — submitted picks are stored for a future stage (E7).

type KnockoutStageDef = { stage: string; label: string; count: number; keyPart: string };
type KnockoutMatch = {
  match_key: string;
  stage: string;
  match_order: number;
  team_a_id: string | null;
  team_b_id: string | null;
  winner_team_id: string | null;
  status: string;
  known: boolean;
};
type KnockoutBracket = { status: string; picks: Record<string, unknown> } | null;
type StageLock = { pairs_confirmed: boolean; results_confirmed: boolean; can_edit: boolean };
type KnockoutResponse = {
  ok: boolean;
  teams: SeasonPredictionTeam[];
  stages: KnockoutStageDef[];
  matches: KnockoutMatch[];
  bracket: KnockoutBracket;
  can_edit: boolean;
  bracket_locked_by_results?: boolean;
  stage_locks?: Record<string, StageLock>;
  bracket_sources?: Record<string, { stage: string; a: string; b: string }>;
  available: boolean;
  notice: string;
};

type StagePicks = Record<string, Record<string, string>>;

function teamId(t: SeasonPredictionTeam): string {
  return String((t as { team_id?: string; id?: number }).team_id ?? (t as { id?: number }).id ?? "");
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

type KnockoutMode = "playoffs" | "bracket";

// Which stages each tab renders. "playoffs" = the 9–24 knockout round only;
// "bracket" = the main tree (1/8 → final) + champion.
const BRACKET_STAGES = ["round_of_16", "quarter_final", "semi_final", "final"];

// Round-by-round bracket navigation (mobile UX, not a wide desktop tree).
type BracketRoundKey = "round_of_16" | "quarter_final" | "semi_final" | "final" | "champion";
const BRACKET_ROUNDS: Array<{ key: Exclude<BracketRoundKey, "champion">; label: string; total: number }> = [
  { key: "round_of_16", label: "1/8", total: 8 },
  { key: "quarter_final", label: "1/4", total: 4 },
  { key: "semi_final", label: "1/2", total: 2 },
  { key: "final", label: "Финал", total: 1 },
];
// Board columns (the dynamic bracket). Champion is rendered as a 5th column.
const BRACKET_COLS: Array<{ key: string; title: string; cls: string }> = [
  { key: "round_of_16", title: "1/8", cls: bstyles.colR16 },
  { key: "quarter_final", title: "1/4", cls: bstyles.colQF },
  { key: "semi_final", title: "1/2", cls: bstyles.colSF },
  { key: "final", title: "Финал", cls: bstyles.colF },
];

// ── Unified state palette ────────────────────────────────────────────────────
// Primary active/select = blue (NOT the tournament tone — the Conference-League
// tone is bright green and was over-used). Green is reserved as a *muted* success
// accent (result/correct), orange as a *muted* miss accent. Kept calm for dark
// theme: low-opacity tints + soft borders, no full fills, no glow.
const ACTIVE_BG = "rgba(59,130,246,0.18)";
const ACTIVE_BORDER = "rgba(59,130,246,0.55)";
const ACTIVE_DOT = "#60a5fa";
const ACTIVE_TEXT = "#93c5fd";
const ACTIVE_SOLID = "#3b82f6";
const SUCCESS_BG = "rgba(34,197,94,0.10)";
const SUCCESS_BORDER = "rgba(34,197,94,0.28)";
const SUCCESS_DOT = "#4ade80";
const SUCCESS_TEXT = "#86efac";
const MISS_BG = "rgba(245,158,11,0.10)";
const MISS_BORDER = "rgba(245,158,11,0.28)";
const MISS_TEXT = "#fbbf24";

// `tone` (tournament accent) is accepted for API compatibility but intentionally
// unused — state colours are a fixed calm palette (blue/green/orange), not the tone.
export function EurocupKnockoutSection({ code, teams: teamsProp, mode = "playoffs" }: { code: string; tone?: string; teams?: SeasonPredictionTeam[]; mode?: KnockoutMode }) {
  const [data, setData] = useState<KnockoutResponse | null>(null);
  const [picks, setPicks] = useState<StagePicks>({});
  const [activeRound, setActiveRound] = useState<BracketRoundKey>("round_of_16");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // Ref to the FIRST match card of each round (and the champion block) so we can
  // bring the start of a stage into view. scrollIntoView walks both scroll
  // ancestors — the horizontal board AND the vertical page — in one call.
  const roundFirstRef = useRef<Partial<Record<BracketRoundKey, HTMLDivElement | null>>>({});
  // Ref to each round pill so the active one can be scrolled into the rail's view.
  const pillRefs = useRef<Partial<Record<BracketRoundKey, HTMLButtonElement | null>>>({});

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<KnockoutResponse>(`/season-predictions/europe/${code}/knockout`);
      setData(res);
      const initial: StagePicks = {};
      const raw = (res.bracket?.picks || {}) as Record<string, unknown>;
      for (const def of res.stages) {
        const stageObj = raw[def.stage];
        if (stageObj && typeof stageObj === "object" && !Array.isArray(stageObj)) {
          initial[def.stage] = {};
          for (const [k, v] of Object.entries(stageObj as Record<string, unknown>)) {
            if (v) initial[def.stage][k] = String(v);
          }
        }
      }
      setPicks(initial);
    } catch (e) {
      setError(getErrorMessage(e, "Не удалось загрузить плей-офф"));
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => { void load(); }, [load]);

  // Prefer the parent-provided teams (already loaded with names/logos), fall back
  // to the teams returned by the knockout endpoint.
  const teams = useMemo(
    () => (teamsProp && teamsProp.length ? teamsProp : (data?.teams || [])),
    [teamsProp, data?.teams],
  );

  type TeamInfo = { name: string; code: string | null; crest: string | null };
  const teamInfo = useMemo(() => {
    const map = new Map<string, TeamInfo>();
    for (const t of teams) {
      map.set(teamId(t), {
        name: String(t.team_name || t.short_name || teamId(t)),
        code: t.short_name ? String(t.short_name) : null,
        crest: t.crest_url ? String(t.crest_url) : null,
      });
    }
    return (id: string | null | undefined): TeamInfo =>
      (id && map.get(id)) || { name: id ? String(id) : "—", code: null, crest: null };
  }, [teams]);

  // Stages shown in this tab: play-offs = knockout_playoffs; bracket = 1/8 … final.
  const modeStages = useMemo(
    () => (data?.stages || []).filter((d) => (mode === "playoffs" ? d.stage === "knockout_playoffs" : BRACKET_STAGES.includes(d.stage))),
    [data?.stages, mode],
  );

  const knownByStage = useMemo(() => {
    const groups: Array<{ def: KnockoutStageDef; matches: KnockoutMatch[]; known: KnockoutMatch[] }> = [];
    for (const def of modeStages) {
      const all = (data?.matches || []).filter((m) => m.stage === def.stage);
      groups.push({ def, matches: all, known: all.filter((m) => m.known) });
    }
    return groups;
  }, [data?.matches, modeStages]);

  const modeHasKnown = useMemo(() => knownByStage.some((g) => g.known.length > 0), [knownByStage]);

  const canEdit = !!data?.can_edit;

  // A stage is locked (read-only) once its official results are confirmed by the
  // admin (winner set). Prefer the backend stage_locks; fall back to matches.
  const resultsConfirmed = useCallback((stage: string): boolean => {
    const lock = data?.stage_locks?.[stage];
    if (lock) return lock.results_confirmed;
    return (data?.matches || []).some((m) => m.stage === stage && String(m.status) !== "void" && !!m.winner_team_id);
  }, [data?.stage_locks, data?.matches]);

  const sources = data?.bracket_sources || {};

  // Winner of a given match across all stages of the current picks.
  function winnerOf(p: StagePicks, matchKey: string): string | null {
    for (const st of Object.keys(p)) { const w = p[st]?.[matchKey]; if (w) return w; }
    return null;
  }
  // Derived downstream pair teams from the user's own winners along the path.
  function derivedTeams(matchKey: string): { aId: string | null; bId: string | null } {
    const src = sources[matchKey];
    if (!src) return { aId: null, bId: null };
    return { aId: winnerOf(picks, src.a), bId: winnerOf(picks, src.b) };
  }
  // Teams for any slot: r16/playoffs from admin pairs; qf/sf/final derived.
  function matchTeams(m: KnockoutMatch): { aId: string | null; bId: string | null; ready: boolean } {
    if (m.stage === "round_of_16" || m.stage === "knockout_playoffs") {
      return { aId: m.team_a_id, bId: m.team_b_id, ready: m.known };
    }
    const d = derivedTeams(m.match_key);
    return { aId: d.aId, bId: d.bId, ready: !!d.aId && !!d.bId };
  }

  // ── Bracket round helpers (mode === "bracket") ─────────────────────────────
  function stageMatches(stageKey: string): KnockoutMatch[] {
    return (data?.matches || []).filter((m) => m.stage === stageKey).sort((a, b) => a.match_order - b.match_order);
  }
  function roundPicked(stageKey: string): number {
    return stageMatches(stageKey).filter((m) => matchTeams(m).ready && picks[stageKey]?.[m.match_key]).length;
  }
  // Hint that ties a downstream pair to its feeders ("Из пар 1–2" etc).
  function sourceHint(matchKey: string): string | null {
    const src = sources[matchKey];
    if (!src) return null;
    const fa = (data?.matches || []).find((x) => x.match_key === src.a);
    const fb = (data?.matches || []).find((x) => x.match_key === src.b);
    if (src.stage === "quarter_final") return `Из пар ${fa?.match_order ?? "?"}–${fb?.match_order ?? "?"}`;
    if (src.stage === "semi_final") return `Из 1/4 ${fa?.match_order ?? "?"}–${fb?.match_order ?? "?"}`;
    return "Победители полуфиналов";
  }
  const finalKey = stageMatches("final")[0]?.match_key || `${code}_FINAL`;
  const championId = winnerOf(picks, finalKey);
  const bracketComplete = BRACKET_ROUNDS.every((r) => roundPicked(r.key) === r.total);

  // Label for a not-yet-decided downstream slot, e.g. "Поб. пары 3", "Поб. 1/4 1".
  function feederLabel(feederKey: string): string {
    const fm = (data?.matches || []).find((x) => x.match_key === feederKey);
    if (!fm) return "Победитель";
    if (fm.stage === "round_of_16" || fm.stage === "knockout_playoffs") return `Поб. пары ${fm.match_order}`;
    if (fm.stage === "quarter_final") return `Поб. 1/4 ${fm.match_order}`;
    if (fm.stage === "semi_final") return `Поб. 1/2 ${fm.match_order}`;
    return "Победитель";
  }
  // Per-side placeholder labels for a board card (used when a feeder winner is
  // not picked yet) so empty slots read "Поб. пары N" instead of a blank box.
  function sideLabels(m: KnockoutMatch): { aLabel: string; bLabel: string } {
    const src = sources[m.match_key];
    return { aLabel: src ? feederLabel(src.a) : "—", bLabel: src ? feederLabel(src.b) : "—" };
  }
  // Bring the start of a round (its first match / the champion block) into view.
  // Runs ONLY on explicit navigation (pill tap or auto-advance), never on render,
  // so a user's manual scroll is never yanked back. Smooth with an auto fallback
  // for older Telegram WebViews.
  function scrollToRound(round: BracketRoundKey) {
    window.requestAnimationFrame(() => {
      const el = roundFirstRef.current[round];
      if (!el) return;
      try {
        el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
      } catch {
        el.scrollIntoView();
      }
    });
  }
  // Keep the active round pill fully visible (centred) inside the scrollable rail,
  // so it is never clipped on the left. block:"nearest" avoids any vertical jump.
  function scrollPillIntoView(round: BracketRoundKey) {
    window.requestAnimationFrame(() => {
      const pill = pillRefs.current[round];
      if (!pill) return;
      try {
        pill.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      } catch {
        pill.scrollIntoView();
      }
    });
  }
  // Explicit navigation to a round: set it active, bring its content into view and
  // keep its pill visible. Used by pill taps and stage auto-advance only.
  function goToRound(round: BracketRoundKey) {
    setActiveRound(round);
    scrollToRound(round);
    scrollPillIntoView(round);
  }
  // Pick a winner on the board; downstream pruning happens in pickWinner. When a
  // round becomes complete, auto-advance activeRound to the next stage AND scroll
  // to the start of that stage (final → champion).
  function boardPick(stage: string, matchKey: string, winnerId: string) {
    if (!canEdit || resultsConfirmed(stage)) return;
    pickWinner(stage, matchKey, winnerId);
    const idx = BRACKET_ROUNDS.findIndex((r) => r.key === stage);
    if (idx < 0) return;
    const stageObj = { ...(picks[stage] || {}) };
    if (stageObj[matchKey] === winnerId) return; // toggled off → no advance/scroll
    stageObj[matchKey] = winnerId;
    const ms = stageMatches(stage);
    const complete = ms.length > 0 && ms.every((m) => { const t = matchTeams(m); return !t.ready || stageObj[m.match_key]; });
    if (!complete) return;
    const nextKey: BracketRoundKey = idx < BRACKET_ROUNDS.length - 1 ? BRACKET_ROUNDS[idx + 1].key : "champion";
    setActiveRound(nextKey);
    scrollPillIntoView(nextKey);
    window.setTimeout(() => scrollToRound(nextKey), 220);
  }

  // After a winner change, drop downstream picks that no longer reference a valid
  // team in their (recomputed) pair. Few passes cover qf → sf → final depth.
  function prunePicks(p: StagePicks): StagePicks {
    const next: StagePicks = {};
    for (const st of Object.keys(p)) next[st] = { ...p[st] };
    for (let pass = 0; pass < 3; pass += 1) {
      for (const [key, src] of Object.entries(sources)) {
        const a = winnerOf(next, src.a);
        const b = winnerOf(next, src.b);
        const cur = next[src.stage]?.[key];
        if (cur && cur !== a && cur !== b) delete next[src.stage][key];
      }
    }
    return next;
  }

  function pickWinner(stage: string, matchKey: string, winner: string) {
    if (!canEdit || resultsConfirmed(stage)) return;
    setNotice("");
    setError("");
    setPicks((prev) => {
      const stageObj = { ...(prev[stage] || {}) };
      if (stageObj[matchKey] === winner) delete stageObj[matchKey];
      else stageObj[matchKey] = winner;
      return prunePicks({ ...prev, [stage]: stageObj });
    });
  }

  function buildPayloadPicks() {
    const finalWinner = picks.final ? Object.values(picks.final)[0] : undefined;
    return { ...picks, champion_team_id: finalWinner || null };
  }

  async function saveDraft() {
    setSaving("draft");
    setNotice("");
    setError("");
    try {
      await apiFetch(`/season-predictions/europe/${code}/knockout/draft`, {
        method: "PUT",
        body: JSON.stringify({ picks: buildPayloadPicks() }),
      });
      setNotice("Прогноз плей-офф сохранён.");
      await load();
    } catch (e) {
      setError(getErrorMessage(e, "Не удалось сохранить"));
    } finally {
      setSaving("");
    }
  }

  async function submit() {
    if (mode === "bracket" && !bracketComplete) {
      setError("Выбери победителей всех раундов вплоть до чемпиона.");
      return;
    }
    setSaving("submit");
    setNotice("");
    setError("");
    try {
      await apiFetch(`/season-predictions/europe/${code}/knockout/submit`, {
        method: "POST",
        body: JSON.stringify({ picks: buildPayloadPicks() }),
      });
      setNotice("Прогноз плей-офф подтверждён.");
      await load();
    } catch (e) {
      setError(getErrorMessage(e, "Не удалось подтвердить"));
    } finally {
      setSaving("");
    }
  }

  const title = mode === "playoffs" ? "Стыки" : "Сетка";
  const emptyCopy = mode === "playoffs"
    ? "Стыки откроются после подтверждения пар."
    : "Сетка откроется после подтверждения пар 1/8.";
  const modeNotice = mode === "playoffs"
    ? "Стыки сохраняются как прогноз. Очки будут добавлены позже отдельной формулой."
    : "Сетка сохраняется как прогноз. Очки будут добавлены позже отдельной формулой.";

  if (loading) return <section style={cardStyle}><div style={{ color: "var(--tg-hint)", fontWeight: 700, fontSize: 13 }}>Загрузка…</div></section>;
  if (!data) return null;

  // No known pairs in THIS section yet → future/empty state.
  if (!modeHasKnown) {
    return (
      <section style={cardStyle}>
        <div style={titleRowStyle}><h2 style={sectionTitleStyle}>{title}</h2></div>
        <div style={emptyStyle}>{emptyCopy}</div>
      </section>
    );
  }

  const bracketStatus = data.bracket?.status || "draft";
  // Editable if there is at least one open (not results-confirmed) stage with pairs;
  // locked if any shown stage's results are already confirmed.
  const modeEditable = canEdit && knownByStage.some((g) => g.known.length > 0 && !resultsConfirmed(g.def.stage));
  const modeLocked = knownByStage.some((g) => g.known.length > 0 && resultsConfirmed(g.def.stage));
  // Confirmed = admin results locked OR the user already submitted → one compact green notice.
  const bracketLockedByResults = !!data.bracket_locked_by_results;
  const isConfirmed = bracketLockedByResults || modeLocked || bracketStatus === "submitted" || bracketStatus === "completed";

  // One match row: ready → matchup (or read-only result), not ready → placeholder.
  function renderMatchRow(m: KnockoutMatch) {
    const stageKey = m.stage;
    const isPlayoffsOrR16 = stageKey === "round_of_16" || stageKey === "knockout_playoffs";
    const { aId, bId, ready } = matchTeams(m);
    const hint = isPlayoffsOrR16 ? null : sourceHint(m.match_key);
    if (!ready) {
      return (
        <div key={m.match_key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {hint && <span style={matchHintStyle}>{hint}</span>}
          <div style={matchCardStyle}>
            <PlaceholderTeamCard />
            <span style={vsStyle}>vs</span>
            <PlaceholderTeamCard />
          </div>
        </div>
      );
    }
    const sel = picks[stageKey]?.[m.match_key] || "";
    if (resultsConfirmed(stageKey) && m.winner_team_id) {
      return (
        <div key={m.match_key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {hint && <span style={matchHintStyle}>{hint}</span>}
          <ResultMatchup infoA={teamInfo(aId)} infoB={teamInfo(bId)} teamAId={aId} teamBId={bId} officialId={m.winner_team_id} userPickId={sel || null} />
        </div>
      );
    }
    return (
      <div key={m.match_key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {hint && <span style={matchHintStyle}>{hint}</span>}
        <div style={matchCardStyle}>
          <TeamButton info={teamInfo(aId)} selected={sel === aId} disabled={!canEdit} onClick={() => aId && pickWinner(stageKey, m.match_key, aId)} />
          <span style={vsStyle}>vs</span>
          <TeamButton info={teamInfo(bId)} selected={sel === bId} disabled={!canEdit} onClick={() => bId && pickWinner(stageKey, m.match_key, bId)} />
        </div>
      </div>
    );
  }

  // One team row inside a board card: real team (clickable) or placeholder label.
  function renderBoardRow(stage: string, matchKey: string, sideId: string | null, label: string, sel: string, official: string | null) {
    if (!sideId) {
      return (
        <div className={`${bstyles.teamRow} ${bstyles.teamRowEmpty}`}>
          <span className={bstyles.crestFallback}>?</span>
          <span className={bstyles.teamName}>{label}</span>
        </div>
      );
    }
    const info = teamInfo(sideId);
    const selected = sel === sideId;
    const isWinner = official != null && official === sideId;
    const isPickWrong = official != null && sel === sideId && !isWinner;
    const ro = !canEdit || resultsConfirmed(stage);
    const style: CSSProperties = {};
    const dotStyle: CSSProperties = {};
    if (official != null) {
      if (selected && isWinner) {
        // Correct pick → card stays BLUE (select), green lives only in the badge.
        style.background = ACTIVE_BG; style.border = `1px solid ${ACTIVE_BORDER}`;
        dotStyle.background = ACTIVE_DOT; dotStyle.borderColor = ACTIVE_DOT;
      } else if (isWinner) {
        // Official winner the user didn't pick → muted success tint + badge.
        style.background = SUCCESS_BG; style.border = `1px solid ${SUCCESS_BORDER}`;
        dotStyle.background = SUCCESS_DOT; dotStyle.borderColor = SUCCESS_DOT;
      } else if (isPickWrong) {
        // Wrong pick → neutral card, only a soft amber border + badge.
        style.border = `1px solid ${MISS_BORDER}`;
        dotStyle.borderColor = MISS_BORDER;
      }
      // else: losing/neutral team → default neutral row (no fill).
    } else if (selected) {
      // Editable selected → blue (neutral surface + blue tint/border, no full fill).
      style.background = ACTIVE_BG; style.border = `1px solid ${ACTIVE_BORDER}`;
      dotStyle.background = ACTIVE_DOT; dotStyle.borderColor = ACTIVE_DOT;
    }
    const resultChip = official != null
      ? isWinner && selected
        ? { label: "Угадано", tone: "success" as const }
        : isWinner
          ? { label: "Итог", tone: "success" as const }
          : isPickWrong
            ? { label: "Мимо", tone: "warning" as const }
            : null
      : null;
    const inner = (
      <>
        <BoardCrest crest={info.crest} code={info.code} name={info.name} />
        <span className={bstyles.teamName}>{info.code || info.name}</span>
        {resultChip ? (
          <span className={bstyles.teamChip} style={boardResultChipStyle(resultChip.tone)}>{resultChip.label}</span>
        ) : (
          <span className={bstyles.pickDot} style={dotStyle} />
        )}
      </>
    );
    if (ro) return <div className={`${bstyles.teamRow} ${bstyles.teamRowReadonly}`} style={style}>{inner}</div>;
    return (
      <Pressable haptic="selection" pressedScale={0.97} className={bstyles.teamRow} style={style} aria-pressed={selected} onClick={() => boardPick(stage, matchKey, sideId)}>
        {inner}
      </Pressable>
    );
  }

  // One bracket slot (match) inside a round column, with connector-arm classes.
  function renderBoardCard(m: KnockoutMatch, colIndex: number, slotIndex: number, roundKey: BracketRoundKey) {
    const stage = m.stage;
    const { aId, bId } = matchTeams(m);
    const { aLabel, bLabel } = sideLabels(m);
    const sel = picks[stage]?.[m.match_key] || "";
    const official = resultsConfirmed(stage) && m.winner_team_id ? m.winner_team_id : null;
    const isFinal = colIndex === 3;
    const slotCls = [
      bstyles.slot,
      bstyles.slotHasOut,
      isFinal ? bstyles.slotStraight : slotIndex % 2 === 0 ? bstyles.slotUpper : bstyles.slotLower,
      colIndex > 0 ? bstyles.slotHasIn : "",
    ].filter(Boolean).join(" ");
    return (
      <div key={m.match_key} className={slotCls} ref={slotIndex === 0 ? (el) => { roundFirstRef.current[roundKey] = el; } : undefined}>
        <div className={bstyles.card}>
          {renderBoardRow(stage, m.match_key, aId, aLabel, sel, official)}
          {renderBoardRow(stage, m.match_key, bId, bLabel, sel, official)}
        </div>
      </div>
    );
  }

  // Finalist codes for the small "Финал: A — B" line under the champion card.
  const finalMatch = stageMatches("final")[0];
  const finalPair = finalMatch ? matchTeams(finalMatch) : null;
  const finalSummary = finalPair && finalPair.aId && finalPair.bId
    ? `${teamInfo(finalPair.aId).code || teamInfo(finalPair.aId).name} — ${teamInfo(finalPair.bId).code || teamInfo(finalPair.bId).name}`
    : null;
  // Show the read-only legend only once some bracket stage has official results.
  const anyBracketResults = BRACKET_STAGES.some((s) => resultsConfirmed(s));

  return (
    <section style={cardStyle}>
      <div style={titleRowStyle}>
        <h2 style={sectionTitleStyle}>{title}</h2>
        <span style={statusPillStyle(bracketStatus)}>{statusLabel(bracketStatus)}</span>
      </div>

      {/* One compact notice: confirmed → single green line; otherwise a small muted hint. */}
      {bracketLockedByResults
        ? <div style={noticeSuccessCompactStyle}>Результаты плей-офф уже подтверждены. Прогноз сетки нельзя изменить.</div>
        : isConfirmed
          ? <div style={noticeSuccessCompactStyle}>Прогноз плей-офф подтверждён.</div>
        : <div style={noticeInfoCompactStyle}>{modeNotice}</div>}
      {error && <div style={noticeErrorStyle}>{error}</div>}
      {notice && !isConfirmed && <div style={noticeSuccessStyle}>{notice}</div>}

      {mode === "playoffs" ? (
        /* Play-offs = single knockout_playoffs stage list. */
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {stageMatches("knockout_playoffs").map((m) => renderMatchRow(m))}
        </div>
      ) : (
        /* Bracket = dynamic WC2026-style board: every round shown as a connected
           column, winners flow forward, champion at the end. */
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 750, color: "var(--tg-hint)", marginBottom: 6 }}>
            Выбрано {BRACKET_ROUNDS.reduce((n, r) => n + roundPicked(r.key), 0)}/15
          </div>
          {/* Round pills: tap focuses the round and keeps the active pill in view. */}
          <div className="sp-bracket-rounds" style={roundRailStyle}>
            {BRACKET_ROUNDS.map((r) => {
              const picked = roundPicked(r.key);
              const done = picked === r.total;
              return (
                <Pressable key={r.key} ref={(el) => { pillRefs.current[r.key] = el; }} haptic="selection" pressedScale={0.97} onClick={() => goToRound(r.key)} style={roundChipStyle(activeRound === r.key)}>
                  {done && activeRound !== r.key && <span style={completedCheckStyle}>✓</span>}
                  <span>{r.label} {picked}/{r.total}</span>
                </Pressable>
              );
            })}
            <Pressable ref={(el) => { pillRefs.current.champion = el; }} haptic="selection" pressedScale={0.97} onClick={() => goToRound("champion")} style={roundChipStyle(activeRound === "champion")}>
              {!!championId && activeRound !== "champion" && <span style={completedCheckStyle}>✓</span>}
              <span>Чемпион</span>
            </Pressable>
          </div>

          {activeRound === "champion" ? (
            /* Mobile-friendly focused champion view — compact centred card, no wide
               canvas and no cropped final beside a huge empty block. */
            <div ref={(el) => { roundFirstRef.current.champion = el; }} style={{ marginTop: 12, scrollMarginTop: 16 }}>
              <div
                className={bstyles.champCard}
                style={championId
                  ? { background: ACTIVE_BG, border: `1px solid ${ACTIVE_BORDER}` }
                  : { background: "color-mix(in srgb, var(--tg-secondary-bg) 50%, transparent)", border: "1px dashed color-mix(in srgb, var(--tg-hint) 22%, transparent)" }}
              >
                <span className={bstyles.champLabel} style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                  <AppIcon name="trophy" size={18} />
                  {championId ? "Твой чемпион" : "Чемпион"}
                </span>
                {championId ? (
                  <>
                    {teamInfo(championId).crest ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={teamInfo(championId).crest as string} alt={teamInfo(championId).name} className={bstyles.champCrest} />
                    ) : (
                      <span className={bstyles.crestFallback} style={{ width: 48, height: 48, fontSize: 15 }}>{(teamInfo(championId).code || teamInfo(championId).name).slice(0, 3).toUpperCase()}</span>
                    )}
                    <span className={bstyles.champName}>{teamInfo(championId).name}</span>
                    {teamInfo(championId).code && <span className={bstyles.champCode}>{teamInfo(championId).code}</span>}
                  </>
                ) : (
                  <span className={bstyles.champHint}>Появится после выбора победителя финала</span>
                )}
              </div>
              {finalSummary && <div className={bstyles.champFinalLine}>Финал: {finalSummary}</div>}
            </div>
          ) : (
            /* The dynamic bracket board (horizontally scrollable, 4 rounds). */
            <>
            {anyBracketResults && (
              <div style={bracketLegendStyle}>
                <span style={legendItemStyle}>
                  <span style={legendChipStyle("success")}>Итог</span>
                  <span style={legendTextStyle}>реальный победитель</span>
                </span>
                <span style={legendItemStyle}>
                  <span style={legendChipStyle("warning")}>Мимо</span>
                  <span style={legendTextStyle}>твой прогноз не совпал</span>
                </span>
              </div>
            )}
            <div className={bstyles.board}>
              <div className={bstyles.header}>
                {BRACKET_COLS.map((c) => <div key={c.key} className={bstyles.headerTitle}>{c.title}</div>)}
              </div>
              <div className={bstyles.canvas}>
                {BRACKET_COLS.map((c, colIndex) => (
                  <div key={c.key} className={`${bstyles.column} ${c.cls}`}>
                    {stageMatches(c.key).map((m, slotIndex) => renderBoardCard(m, colIndex, slotIndex, c.key as BracketRoundKey))}
                  </div>
                ))}
              </div>
            </div>
            </>
          )}
        </div>
      )}

      {modeEditable ? (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Pressable onClick={saveDraft} haptic="light" pressedScale={0.98} disabled={saving !== ""} style={saveBtnStyle}>
            {saving === "draft" ? "Сохраняю…" : "Сохранить"}
          </Pressable>
          <Pressable onClick={submit} haptic="medium" pressedScale={0.98} disabled={saving !== ""} style={submitBtnStyle}>
            {saving === "submit" ? "Отправляю…" : "Подтвердить"}
          </Pressable>
        </div>
      ) : isConfirmed ? null : (
        /* Not editable and not confirmed (e.g. window closed) — single muted hint. */
        <div style={{ ...noticeInfoStyle, marginTop: 12 }}>Прогноз плей-офф заблокирован.</div>
      )}
    </section>
  );
}

type TeamInfo = { name: string; code: string | null; crest: string | null };

// Read-only result of a decided knockout pair — same matchup card with crests,
// "Твой выбор" / "Победитель" markers on the team blocks + a pair status pill.
function ResultMatchup({ infoA, infoB, teamAId, teamBId, officialId, userPickId }: {
  infoA: TeamInfo;
  infoB: TeamInfo;
  teamAId: string | null;
  teamBId: string | null;
  officialId: string;
  userPickId: string | null;
}) {
  const status = !userPickId
    ? { label: "Нет прогноза", color: "var(--tg-hint)", bg: "color-mix(in srgb, var(--tg-hint) 10%, transparent)", border: "color-mix(in srgb, var(--tg-hint) 14%, transparent)" }
    : userPickId === officialId
      ? { label: "Угадано", color: SUCCESS_TEXT, bg: SUCCESS_BG, border: SUCCESS_BORDER }
      : { label: "Мимо", color: MISS_TEXT, bg: MISS_BG, border: MISS_BORDER };

  return (
    <div style={{ borderRadius: 12, padding: "7px 9px 9px", background: "color-mix(in srgb, var(--tg-secondary-bg) 55%, transparent)", border: "1px solid color-mix(in srgb, var(--tg-hint) 11%, transparent)" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
        <span style={{ display: "inline-flex", alignItems: "center", height: 18, padding: "0 8px", borderRadius: 999, fontSize: 10, fontWeight: 850, color: status.color, background: status.bg, border: `1px solid ${status.border}` }}>
          {status.label}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "stretch", gap: 8 }}>
        <ResultTeamCard info={infoA} isWinner={officialId === teamAId} isPick={!!userPickId && userPickId === teamAId} />
        <span style={vsStyle}>vs</span>
        <ResultTeamCard info={infoB} isWinner={officialId === teamBId} isPick={!!userPickId && userPickId === teamBId} />
      </div>
    </div>
  );
}

// Calm read-only team block. Correct pick → blue card; official winner the user
// missed → muted success tint; user's wrong pick → neutral + soft amber border;
// loser → neutral. Green/orange live mainly in the small chips.
function ResultTeamCard({ info, isWinner, isPick }: { info: TeamInfo; isWinner: boolean; isPick: boolean }) {
  const correctPick = isWinner && isPick;
  const wrongPick = isPick && !isWinner;
  const surface: CSSProperties = correctPick
    ? { background: ACTIVE_BG, border: `1px solid ${ACTIVE_BORDER}` }
    : isWinner
      ? { background: SUCCESS_BG, border: `1px solid ${SUCCESS_BORDER}` }
      : wrongPick
        ? { background: "color-mix(in srgb, var(--tg-secondary-bg) 66%, var(--tg-bg))", border: `1px solid ${MISS_BORDER}` }
        : { background: "color-mix(in srgb, var(--tg-secondary-bg) 66%, var(--tg-bg))", border: "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)" };
  return (
    <div style={{ ...TEAM_CARD_BASE, color: "var(--tg-text)", ...surface }}>
      <TeamCrest crest={info.crest} code={info.code} name={info.name} selected={false} />
      <span style={TEAM_NAME_TEXT}>{info.name}</span>
      <span style={{ minHeight: 12, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.04em", color: "var(--tg-hint)" }}>{info.code || ""}</span>
      <div style={TEAM_CHIPS_ZONE}>
        {isPick && <span style={chipStyle(wrongPick ? "miss" : "select")}>Твой</span>}
        {isWinner && <span style={chipStyle("success")}>Победитель</span>}
      </div>
    </div>
  );
}

// Muted placeholder card (same dimensions as a team card) for not-yet-known pairs.
function PlaceholderTeamCard() {
  return (
    <div style={{
      ...TEAM_CARD_BASE,
      justifyContent: "center",
      color: "var(--tg-hint)",
      background: "color-mix(in srgb, var(--tg-secondary-bg) 50%, transparent)",
      border: "1px dashed color-mix(in srgb, var(--tg-hint) 22%, transparent)",
    }}>
      <span style={{ width: 22, height: 22, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 900, color: "var(--tg-hint)", background: "color-mix(in srgb, var(--tg-hint) 12%, transparent)" }}>?</span>
      <span style={{ ...TEAM_NAME_TEXT, fontWeight: 750, color: "var(--tg-hint)" }}>Ожидает выбора</span>
    </div>
  );
}

// Small status chip. select=blue, success=muted green, miss=muted orange, muted=neutral.
function chipStyle(kind: "select" | "success" | "miss" | "muted"): CSSProperties {
  const base: CSSProperties = {
    display: "inline-flex", alignItems: "center", height: 15, padding: "0 6px",
    borderRadius: 999, fontSize: 9, fontWeight: 850, whiteSpace: "nowrap",
  };
  if (kind === "select") return { ...base, color: ACTIVE_TEXT, background: ACTIVE_BG, border: `1px solid ${ACTIVE_BORDER}` };
  if (kind === "success") return { ...base, color: SUCCESS_TEXT, background: SUCCESS_BG, border: `1px solid ${SUCCESS_BORDER}` };
  if (kind === "miss") return { ...base, color: MISS_TEXT, background: MISS_BG, border: `1px solid ${MISS_BORDER}` };
  return { ...base, color: "color-mix(in srgb, var(--tg-text) 62%, var(--tg-hint))", background: "color-mix(in srgb, var(--tg-hint) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)" };
}

function boardResultChipStyle(tone: "success" | "warning"): CSSProperties {
  return {
    color: tone === "success" ? SUCCESS_TEXT : MISS_TEXT,
    background: tone === "success" ? SUCCESS_BG : MISS_BG,
    border: `1px solid ${tone === "success" ? SUCCESS_BORDER : MISS_BORDER}`,
  };
}

// Compact read-only legend above the bracket board — keyed by the same chips
// that appear on the board, so the colours read as labels, not random swatches.
const bracketLegendStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  rowGap: 4,
  columnGap: 12,
  marginTop: 8,
  marginBottom: 2,
  fontSize: 10,
  fontWeight: 750,
  lineHeight: 1.3,
};
const legendItemStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5 };
const legendTextStyle: CSSProperties = { color: "var(--tg-hint)" };
function legendChipStyle(tone: "success" | "warning"): CSSProperties {
  return {
    ...boardResultChipStyle(tone),
    display: "inline-flex",
    alignItems: "center",
    height: 16,
    padding: "0 6px",
    borderRadius: 999,
    fontSize: 9.5,
    fontWeight: 850,
    flexShrink: 0,
  };
}

function TeamButton({ info, selected, disabled, onClick }: { info: { name: string; code: string | null; crest: string | null }; selected: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <Pressable
      onClick={onClick}
      haptic="selection"
      pressedScale={disabled ? 1 : 0.98}
      aria-pressed={selected}
      style={{
        ...TEAM_CARD_BASE,
        cursor: disabled ? "default" : "pointer",
        // Selected = blue (neutral surface + blue tint/border, no full fill, no glow).
        color: "var(--tg-text)",
        background: selected ? ACTIVE_BG : "color-mix(in srgb, var(--tg-secondary-bg) 70%, var(--tg-bg))",
        border: selected ? `1px solid ${ACTIVE_BORDER}` : "1px solid color-mix(in srgb, var(--tg-hint) 16%, transparent)",
        opacity: disabled && !selected ? 0.75 : 1,
      }}
    >
      <TeamCrest crest={info.crest} code={info.code} name={info.name} selected={false} />
      <span style={TEAM_NAME_TEXT}>{info.name}</span>
      <span style={{ minHeight: 12, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.04em", color: "var(--tg-hint)" }}>
        {info.code || ""}
      </span>
      {/* reserved chips zone keeps editable/result cards the same height */}
      <div style={TEAM_CHIPS_ZONE}>
        {selected && <span style={chipStyle("select")}>Выбрано</span>}
      </div>
    </Pressable>
  );
}

function TeamCrest({ crest, code, name, selected }: { crest: string | null; code: string | null; name: string; selected: boolean }) {
  const [failed, setFailed] = useState(false);
  if (crest && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={crest} alt={name} width={22} height={22} onError={() => setFailed(true)} style={{ width: 22, height: 22, objectFit: "contain", borderRadius: 4 }} />;
  }
  // Fallback: monogram chip (no logo / failed load), theme-aware.
  return (
    <span style={{
      width: 22, height: 22, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontSize: 9, fontWeight: 900,
      color: selected ? "var(--tg-button-text)" : "var(--tg-hint)",
      background: selected ? "color-mix(in srgb, var(--tg-button-text) 18%, transparent)" : "color-mix(in srgb, var(--tg-hint) 14%, transparent)",
    }}>
      {(code || name).slice(0, 3).toUpperCase()}
    </span>
  );
}

// Compact 18px crest for board team rows, with monogram fallback on load error.
function BoardCrest({ crest, code, name }: { crest: string | null; code: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (crest && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={crest} alt={name} className={bstyles.crest} onError={() => setFailed(true)} />;
  }
  return <span className={bstyles.crestFallback}>{(code || name).slice(0, 3).toUpperCase()}</span>;
}

function statusLabel(status: string): string {
  if (status === "submitted") return "Подтверждён";
  if (status === "locked") return "Заблокирован";
  if (status === "completed") return "Завершён";
  return "Черновик";
}

function statusPillStyle(status: string): CSSProperties {
  const ok = status === "submitted" || status === "completed";
  return {
    display: "inline-flex",
    alignItems: "center",
    height: 20,
    padding: "0 9px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 850,
    color: ok ? SUCCESS_TEXT : "var(--tg-hint)",
    background: ok ? SUCCESS_BG : "color-mix(in srgb, var(--tg-hint) 10%, transparent)",
    border: `1px solid ${ok ? SUCCESS_BORDER : "color-mix(in srgb, var(--tg-hint) 12%, transparent)"}`,
  };
}

const CARD_SURFACE = "linear-gradient(180deg, color-mix(in srgb, var(--tg-text) 13%, var(--tg-bg)), color-mix(in srgb, var(--tg-text) 6%, var(--tg-bg)))";
const SOFT_BORDER = "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)";

const cardStyle: CSSProperties = { borderRadius: 18, padding: "12px 14px", background: CARD_SURFACE, border: SOFT_BORDER, color: "var(--tg-text)" };
const titleRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 };
const sectionTitleStyle: CSSProperties = { margin: 0, fontSize: 14, fontWeight: 950 };
const matchCardStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto 1fr",
  alignItems: "stretch",
  gap: 8,
  borderRadius: 12,
  padding: "8px 9px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 55%, transparent)",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)",
};
const vsStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", width: 20, fontSize: 10, fontWeight: 800, color: "var(--tg-hint)" };

// Shared fixed zones so both team cards in a pair are the same height regardless
// of name length / presence of chips.
const TEAM_CARD_BASE: CSSProperties = {
  width: "100%",
  minWidth: 0,
  minHeight: 78,
  borderRadius: 10,
  padding: "7px 7px 8px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "flex-start",
  gap: 3,
  textAlign: "center",
};
const TEAM_NAME_TEXT: CSSProperties = {
  width: "100%",
  minHeight: 29,
  fontSize: 12,
  fontWeight: 850,
  lineHeight: 1.18,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};
const TEAM_CHIPS_ZONE: CSSProperties = { minHeight: 16, display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 3 };
const pendingStyle: CSSProperties = {
  borderRadius: 10,
  padding: "9px 11px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 50%, transparent)",
  border: "1px dashed color-mix(in srgb, var(--tg-hint) 20%, transparent)",
  color: "var(--tg-hint)",
  fontSize: 11.5,
  fontWeight: 700,
  lineHeight: 1.4,
};
const emptyStyle: CSSProperties = { ...pendingStyle, marginTop: 8, textAlign: "center" as const };

const matchHintStyle: CSSProperties = { fontSize: 9.5, fontWeight: 800, letterSpacing: "0.02em", color: "var(--tg-hint)", textAlign: "center" };

const roundRailStyle: CSSProperties = {
  display: "flex",
  gap: 5,
  overflowX: "auto",
  paddingBottom: 2,
  scrollPaddingInline: 8,
  scrollbarWidth: "none",
  WebkitOverflowScrolling: "touch",
};
// Native Telegram-style segmented tab. Active = tg button colour; inactive (incl.
// completed) = neutral tg-secondary surface — NO green fill. Completion is shown
// softly by a small green check rendered next to the label.
function roundChipStyle(active: boolean): CSSProperties {
  return {
    flexShrink: 0,
    minHeight: 36,
    padding: "0 13px",
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    cursor: "pointer",
    fontSize: 11.5,
    fontWeight: 800,
    whiteSpace: "nowrap",
    color: active ? "var(--tg-button-text)" : "var(--tg-text)",
    background: active ? "var(--tg-button)" : "var(--tg-secondary-bg)",
    border: active ? "1px solid transparent" : "1px solid color-mix(in srgb, var(--tg-hint) 16%, transparent)",
  };
}
// Small muted-green completion check (theme-safe — mixes with text on light theme).
const completedCheckStyle: CSSProperties = { color: "color-mix(in srgb, #22c55e 62%, var(--tg-text))", fontWeight: 900 };
const noticeBase: CSSProperties = { borderRadius: 10, padding: "8px 11px", fontSize: 12, fontWeight: 700, lineHeight: 1.4, marginTop: 8 };
const noticeInfoStyle: CSSProperties = { ...noticeBase, background: "color-mix(in srgb, var(--tg-secondary-bg) 70%, transparent)", border: "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)", color: "color-mix(in srgb, var(--tg-text) 62%, var(--tg-hint))" };
const noticeSuccessStyle: CSSProperties = { ...noticeBase, background: SUCCESS_BG, border: `1px solid ${SUCCESS_BORDER}`, color: SUCCESS_TEXT };
const noticeErrorStyle: CSSProperties = { ...noticeBase, background: "color-mix(in srgb, #e5484d 12%, var(--tg-bg))", border: "1px solid color-mix(in srgb, #e5484d 28%, transparent)", color: "color-mix(in srgb, #e5484d 82%, var(--tg-text))" };
// Compact variants keep more room for the bracket itself on small screens.
const noticeInfoCompactStyle: CSSProperties = { ...noticeInfoStyle, padding: "5px 9px", fontSize: 10.5, lineHeight: 1.3, marginTop: 6 };
const noticeSuccessCompactStyle: CSSProperties = { ...noticeSuccessStyle, padding: "5px 9px", fontSize: 11, lineHeight: 1.3, marginTop: 6 };

const saveBtnStyle: CSSProperties = {
  flex: 1,
  minHeight: 42,
  borderRadius: 12,
  border: SOFT_BORDER,
  background: "color-mix(in srgb, var(--tg-secondary-bg) 72%, var(--tg-bg))",
  color: "var(--tg-text)",
  fontSize: 13,
  fontWeight: 900,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
// Primary CTA = calm blue (not the bright tournament tone).
const submitBtnStyle: CSSProperties = { ...saveBtnStyle, border: "1px solid transparent", background: ACTIVE_SOLID, color: "#fff" };

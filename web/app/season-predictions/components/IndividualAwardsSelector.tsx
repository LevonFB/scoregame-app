import { useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { triggerHaptic } from "@/lib/haptics";
import type {
  SeasonPredictionAwardCandidate,
  SeasonPredictionAwardOption,
  SeasonPredictionAwardSelection,
  SeasonPredictionAwardsJson,
  SeasonPredictionCatalogPlayer,
  SeasonPredictionPlayersCatalogResponse,
  SeasonPredictionTeam,
  TopLeagueCode,
} from "../types";

type AwardKey = "top_scorer" | "top_assister" | "golden_glove";

const AWARDS: Array<{ key: AwardKey; label: string; pickerTitle: string; hint: string }> = [
  { key: "top_scorer", label: "Лучший бомбардир", pickerTitle: "Выбери лучшего бомбардира", hint: "Любой полевой игрок" },
  { key: "top_assister", label: "Лучший ассистент", pickerTitle: "Выбери ассистента", hint: "Любой полевой игрок" },
  { key: "golden_glove", label: "Золотая перчатка", pickerTitle: "Выбери вратаря", hint: "Только вратари" },
];

function getAwardSelection(value: SeasonPredictionAwardsJson, key: AwardKey) {
  if (key === "top_assister") return value.top_assister ?? value.top_assistant;
  return value[key];
}

function candidateToSelection(candidate: SeasonPredictionAwardCandidate, awardType: AwardKey): SeasonPredictionAwardSelection {
  return {
    award_option_id: candidate.award_option_id ?? null,
    award_type: awardType,
    player_id: candidate.player_id,
    player_name: candidate.player_name,
    team_id: candidate.team_id,
    team_name: candidate.team_name,
    position: candidate.position,
    position_group: candidate.position_group,
    photo_url: candidate.photo_url,
    source: candidate.source || "players_catalog",
  };
}

function optionToCandidate(option: SeasonPredictionAwardOption): SeasonPredictionAwardCandidate {
  return {
    id: option.id,
    award_option_id: option.id,
    player_id: option.player_id,
    player_name: option.player_name,
    team_id: option.team_id,
    team_name: option.team_name,
    position: null,
    position_group: "unknown",
    photo_url: null,
    source: "award_options",
  };
}

// Mirrors the server's normalizePlayerNameForSearch so local search matches the
// precomputed player_name_normalized values.
function normalizeNameForSearch(value: unknown): string {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Mirrors the server's isEligibleForAward.
function isEligibleForAwardKey(awardKey: AwardKey, positionGroup: unknown): boolean {
  const group = String(positionGroup || "unknown");
  if (awardKey === "golden_glove") return group === "goalkeeper";
  return group === "defender" || group === "midfielder" || group === "forward";
}

function catalogPlayerToCandidate(player: SeasonPredictionCatalogPlayer): SeasonPredictionAwardCandidate {
  return {
    id: player.id,
    award_option_id: null,
    player_id: player.player_id,
    player_name: player.player_name,
    team_id: player.team_id,
    team_name: player.team_name,
    position: player.position,
    position_group: player.position_group,
    photo_url: null,
    source: "players_catalog",
  };
}

// One catalog fetch per (tournament, catalog version) per session — the payload is
// small (no photos) and every search/team/position filter runs locally against it.
const catalogMemory = new Map<string, SeasonPredictionCatalogPlayer[]>();

function candidateKey(candidate: SeasonPredictionAwardCandidate) {
  return candidate.player_id || (candidate.award_option_id ? `award:${candidate.award_option_id}` : `${candidate.player_name}|${candidate.team_name || ""}`);
}

function compareText(a: unknown, b: unknown) {
  return String(a || "").localeCompare(String(b || ""), ["ru", "en"], { sensitivity: "base", numeric: true });
}

function teamSortName(team: SeasonPredictionTeam) {
  return team.team_name || team.short_name || team.team_id || team.id || "";
}

function teamFilterKey(team: SeasonPredictionTeam) {
  return String(team.team_id || team.id || team.team_name || team.short_name || "");
}

const DEFAULT_POSITION_ORDER = ["goalkeeper", "defender", "midfielder", "forward", "unknown"];
const SCORER_POSITION_ORDER = ["forward", "midfielder", "defender", "unknown", "goalkeeper"];
const ASSISTER_POSITION_ORDER = ["midfielder", "forward", "defender", "unknown", "goalkeeper"];
const POSITION_LABELS: Record<string, string> = {
  goalkeeper: "Вратарь",
  defender: "Защитник",
  midfielder: "Полузащитник",
  forward: "Нападающий",
  unknown: "Позиция не указана",
};

function positionRank(positionGroup: unknown, awardKey?: AwardKey) {
  const order = awardKey === "top_scorer"
    ? SCORER_POSITION_ORDER
    : awardKey === "top_assister"
      ? ASSISTER_POSITION_ORDER
      : DEFAULT_POSITION_ORDER;
  const index = order.indexOf(String(positionGroup || "unknown"));
  return index === -1 ? order.length : index;
}

function positionLabel(positionGroup: unknown) {
  return POSITION_LABELS[String(positionGroup || "unknown")] || POSITION_LABELS.unknown;
}

function positionFiltersForAward(awardKey: AwardKey) {
  if (awardKey === "top_scorer") {
    return [
      { value: "forward", label: "Нападающие" },
      { value: "midfielder", label: "Полузащитники" },
      { value: "defender", label: "Защитники" },
    ];
  }
  if (awardKey === "top_assister") {
    return [
      { value: "midfielder", label: "Полузащитники" },
      { value: "forward", label: "Нападающие" },
      { value: "defender", label: "Защитники" },
    ];
  }
  return [];
}

export function IndividualAwardsSelector({
  tournamentCode,
  catalogVersion,
  teams,
  options,
  value,
  readOnly,
  onChange,
  footnote,
}: {
  tournamentCode: TopLeagueCode;
  catalogVersion?: string | null;
  teams: SeasonPredictionTeam[];
  options: SeasonPredictionAwardOption[];
  value: SeasonPredictionAwardsJson;
  readOnly: boolean;
  onChange: (value: SeasonPredictionAwardsJson) => void;
  footnote?: string;
}) {
  const [activeAward, setActiveAward] = useState<(typeof AWARDS)[number] | null>(null);
  const [search, setSearch] = useState("");
  const [teamId, setTeamId] = useState("");
  const [positionGroup, setPositionGroup] = useState("");
  const [catalog, setCatalog] = useState<SeasonPredictionCatalogPlayer[] | null>(null);
  const [requestFailed, setRequestFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fallbackCandidates = useMemo(() => {
    if (!activeAward) return [];
    const awardType = activeAward.key;
    return options
      .filter((option) => {
        if (awardType === "top_assister") return option.award_type === "top_assister" || option.award_type === "top_assistant";
        return option.award_type === awardType;
      })
      .map(optionToCandidate);
  }, [activeAward, options]);

  const filledCount = AWARDS.filter((award) => getAwardSelection(value, award.key)?.player_name).length;
  const allFilled = filledCount === 3;

  // A new tournament or an admin catalog edit invalidates the loaded copy.
  useEffect(() => {
    setCatalog(null);
    setRequestFailed(false);
    setError("");
  }, [tournamentCode, catalogVersion]);

  // Load the whole catalog once when the picker opens; filtering is fully local,
  // so typing and switching chips never hits the network.
  useEffect(() => {
    // requestFailed blocks silent refetch loops; reopening the picker retries.
    // `loading` is intentionally NOT a guard/dep here: keeping it as a dep made the
    // effect re-run when it set loading=true, and a cancelled in-flight run then
    // stranded loading=true forever (infinite "Загрузка игроков…" on slow catalogs).
    if (!activeAward || catalog || requestFailed) return;
    const memoryKey = `${tournamentCode}|${catalogVersion || ""}`;
    const remembered = catalogMemory.get(memoryKey);
    if (remembered) {
      setCatalog(remembered);
      setRequestFailed(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const query = catalogVersion ? `?v=${encodeURIComponent(catalogVersion)}` : "";
        const res = await apiFetch<SeasonPredictionPlayersCatalogResponse>(
          `/season-predictions/top-leagues/${tournamentCode}/players-catalog${query}`,
        );
        if (cancelled) return;
        const players = res.players || [];
        catalogMemory.set(memoryKey, players);
        setCatalog(players);
        setRequestFailed(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Не удалось загрузить игроков");
        setRequestFailed(true);
      } finally {
        // Always clear loading, even if this run was cancelled — a stranded
        // loading=true is what froze the picker on "Загрузка игроков…".
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAward, catalogVersion, tournamentCode]);

  const eligibleCatalog = useMemo(() => {
    if (!activeAward || !catalog) return [];
    return catalog.filter((player) => isEligibleForAwardKey(activeAward.key, player.position_group));
  }, [activeAward, catalog]);

  const filteredCandidates = useMemo(() => {
    let list = eligibleCatalog;
    if (teamId) {
      // Most catalog rows carry only team_name (team_id is sparse), so match by
      // normalized name as a fallback — the id-only filter found almost nothing.
      const selectedTeam = teams.find((team) => teamFilterKey(team) === teamId);
      const selectedTeamName = normalizeNameForSearch(selectedTeam?.team_name || selectedTeam?.short_name || "");
      list = list.filter((player) =>
        String(player.team_id || "") === teamId
        || (!!selectedTeamName && normalizeNameForSearch(player.team_name) === selectedTeamName));
    }
    if (positionGroup) list = list.filter((player) => player.position_group === positionGroup);
    const query = normalizeNameForSearch(search);
    if (query) {
      list = list.filter((player) => (player.player_name_normalized || normalizeNameForSearch(player.player_name)).includes(query));
    }
    return list.map(catalogPlayerToCandidate);
  }, [eligibleCatalog, positionGroup, search, teamId, teams]);

  const catalogEmpty = catalog !== null && catalog.length === 0;
  const positionsUnknown = !!activeAward && !!catalog && catalog.length > 0 && eligibleCatalog.length === 0;
  const isFallback = requestFailed || catalogEmpty;
  const fallbackReason = requestFailed ? "request_failed" : catalogEmpty ? "players_catalog_empty" : null;
  const shownCandidates = isFallback ? fallbackCandidates : filteredCandidates;
  const sortedTeams = useMemo(() => {
    const byKey = new Map<string, SeasonPredictionTeam>();
    for (const team of teams) {
      const key = teamFilterKey(team);
      if (!key || byKey.has(key)) continue;
      byKey.set(key, team);
    }
    return Array.from(byKey.values()).sort((a, b) => compareText(teamSortName(a), teamSortName(b)));
  }, [teams]);
  const sortedShownCandidates = useMemo(() => {
    return [...shownCandidates].sort((a, b) => {
      if (activeAward?.key === "golden_glove") {
        const teamCompare = compareText(a.team_name || a.team_id, b.team_name || b.team_id);
        if (teamCompare !== 0) return teamCompare;
        return compareText(a.player_name, b.player_name);
      }
      const positionCompare = positionRank(a.position_group, activeAward?.key) - positionRank(b.position_group, activeAward?.key);
      if (positionCompare !== 0) return positionCompare;
      const teamCompare = compareText(a.team_name || a.team_id, b.team_name || b.team_id);
      if (teamCompare !== 0) return teamCompare;
      return compareText(a.player_name, b.player_name);
    });
  }, [activeAward?.key, shownCandidates]);

  const openPicker = (award: (typeof AWARDS)[number]) => {
    if (readOnly) return;
    setActiveAward(award);
    setSearch("");
    setTeamId("");
    setPositionGroup("");
    if (requestFailed) {
      setRequestFailed(false);
      setError("");
    }
    triggerHaptic("selection");
  };

  const selectCandidate = (candidate: SeasonPredictionAwardCandidate) => {
    if (!activeAward) return;
    const next = { ...value };
    next[activeAward.key] = candidateToSelection(candidate, activeAward.key);
    delete next.top_assistant;
    triggerHaptic("success");
    onChange(next);
    setActiveAward(null);
  };

  return (
    <section style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <h2 style={sectionTitleStyle}>Индивидуальные награды</h2>
        <span style={{ fontSize: 11, fontWeight: 950, color: allFilled ? "#34c759" : "var(--tg-hint)" }}>{filledCount}/3</span>
      </div>

      <div style={{ display: "grid", gap: 9 }}>
        {AWARDS.map((award) => {
          const selected = getAwardSelection(value, award.key);
          return (
            <button
              key={award.key}
              type="button"
              disabled={readOnly}
              onClick={() => openPicker(award)}
              style={{
                width: "100%",
                border: selected ? "1px solid rgba(52,199,89,0.30)" : "1px solid rgba(128,128,128,0.16)",
                borderRadius: 14,
                padding: "11px 12px",
                background: selected ? "rgba(52,199,89,0.10)" : "color-mix(in srgb, var(--tg-secondary-bg) 84%, transparent)",
                color: "var(--tg-text)",
                textAlign: "left",
                opacity: readOnly ? 0.72 : 1,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 950 }}>{award.label}</span>
                <span style={{ fontSize: 11, fontWeight: 850, color: selected ? "#34c759" : "var(--tg-hint)" }}>
                  {selected ? "Выбрано" : "Выбрать"}
                </span>
              </div>
              <div style={{ marginTop: 4, fontSize: 12, fontWeight: 750, color: selected ? "var(--tg-text)" : "var(--tg-hint)" }}>
                {selected ? `${selected.player_name}${selected.team_name ? ` · ${selected.team_name}` : ""}` : award.hint}
              </div>
              {selected?.position_group && (
                <div style={{ marginTop: 2, fontSize: 11, color: "var(--tg-hint)", fontWeight: 700 }}>{positionLabel(selected.position_group)}</div>
              )}
            </button>
          );
        })}
      </div>

      {footnote && <div style={footnoteStyle}>{footnote}</div>}

      {activeAward && (
        <div role="dialog" aria-modal="true" aria-labelledby="award-picker-title" style={overlayStyle}>
          <div style={sheetStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flex: "0 0 auto" }}>
              <div id="award-picker-title" style={{ fontSize: 16, fontWeight: 950 }}>{activeAward.pickerTitle}</div>
              <button type="button" onClick={() => setActiveAward(null)} style={closeButtonStyle}>Закрыть</button>
            </div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск игрока"
              style={searchStyle}
            />
            {!isFallback && (
              <div className="sg-hide-scrollbar" style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 2, flex: "0 0 auto" }}>
                <FilterChip active={!teamId} onClick={() => setTeamId("")}>Все клубы</FilterChip>
                {sortedTeams.map((team) => (
                  <FilterChip key={teamFilterKey(team)} active={teamId === teamFilterKey(team)} onClick={() => setTeamId(teamFilterKey(team))}>
                    {team.short_name || team.team_name}
                  </FilterChip>
                ))}
              </div>
            )}
            {!isFallback && activeAward.key !== "golden_glove" ? (
              <div className="sg-hide-scrollbar" style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 2, flex: "0 0 auto" }}>
                <FilterChip active={!positionGroup} onClick={() => setPositionGroup("")}>Все полевые</FilterChip>
                {positionFiltersForAward(activeAward.key).map((filter) => (
                  <FilterChip key={filter.value} active={positionGroup === filter.value} onClick={() => setPositionGroup(filter.value)}>
                    {filter.label}
                  </FilterChip>
                ))}
              </div>
            ) : !isFallback ? (
              <div style={{ fontSize: 12, color: "var(--tg-hint)", fontWeight: 800, flex: "0 0 auto" }}>Показаны только вратари.</div>
            ) : null}
            {isFallback && (
              <div style={fallbackNoteStyle}>
                {fallbackReason === "request_failed"
                  ? "Не удалось загрузить каталог игроков — показан прежний список кандидатов."
                  : "Каталог игроков пуст — показан прежний список кандидатов, фильтр по позициям недоступен."}
              </div>
            )}
            {error && <div style={fallbackNoteStyle}>{error}</div>}
            <div style={candidateListStyle}>
              {loading && <div style={emptyStyle}>Загрузка игроков…</div>}
              {!loading && sortedShownCandidates.length === 0 && (
                <div style={emptyStyle}>
                  {positionsUnknown
                    ? "Часть игроков скрыта: у них не указана позиция. Они появятся, когда позиции уточнят."
                    : catalog && catalog.length > 0
                      ? "Никто не найден. Измени поиск или фильтры."
                      : "Игроки пока не загружены"}
                </div>
              )}
              {!loading && sortedShownCandidates.map((candidate) => {
                const selected = candidateKey(candidate) === candidateKey((getAwardSelection(value, activeAward.key) || {}) as SeasonPredictionAwardCandidate);
                return (
                  <button key={candidateKey(candidate)} type="button" onClick={() => selectCandidate(candidate)} style={{
                    ...candidateButtonStyle,
                    border: selected ? "1px solid rgba(52,199,89,0.36)" : candidateButtonStyle.border,
                    background: selected ? "rgba(52,199,89,0.10)" : candidateButtonStyle.background,
                  }}>
                    <div style={avatarStyle}>{candidate.player_name.slice(0, 1).toUpperCase()}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{candidate.player_name}</div>
                      <div style={{ marginTop: 2, fontSize: 11, color: "var(--tg-hint)", fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {[candidate.team_name, !isFallback && candidate.position_group !== "unknown" ? positionLabel(candidate.position_group) : null].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} style={{
      flex: "0 0 auto",
      border: active ? "1px solid color-mix(in srgb, var(--tg-button) 48%, transparent)" : "1px solid rgba(128,128,128,0.16)",
      borderRadius: 999,
      padding: "7px 10px",
      background: active ? "color-mix(in srgb, var(--tg-button) 16%, var(--tg-bg))" : "var(--tg-secondary-bg)",
      color: active ? "var(--tg-text)" : "var(--tg-hint)",
      fontSize: 12,
      fontWeight: 850,
      whiteSpace: "nowrap",
    }}>{children}</button>
  );
}

const cardStyle = {
  borderRadius: 18,
  padding: 16,
  background: "linear-gradient(180deg, rgba(255,255,255,0.13), rgba(255,255,255,0.06)), var(--tg-bg)",
  color: "var(--tg-text)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.12)",
} as const;

const sectionTitleStyle = { margin: 0, fontSize: 15, fontWeight: 950, letterSpacing: "-0.02em" } as const;
const footnoteStyle = { marginTop: 10, fontSize: 11, fontWeight: 650, lineHeight: 1.4, color: "color-mix(in srgb, var(--tg-text) 52%, var(--tg-hint))" } as const;
const overlayStyle = { position: "fixed", inset: 0, zIndex: 1000, display: "grid", alignItems: "end", background: "rgba(0,0,0,0.48)", padding: "12px 10px max(12px, env(safe-area-inset-bottom))" } as const;
const sheetStyle = { maxHeight: "82vh", display: "flex", flexDirection: "column", gap: 10, borderRadius: 20, padding: 14, background: "var(--tg-bg)", color: "var(--tg-text)", boxShadow: "0 -22px 60px rgba(0,0,0,0.38)", overflow: "hidden" } as const;
const closeButtonStyle = { border: "none", borderRadius: 999, padding: "8px 10px", background: "var(--tg-secondary-bg)", color: "var(--tg-text)", fontSize: 12, fontWeight: 900 } as const;
const searchStyle = { width: "100%", height: 42, flex: "0 0 auto", boxSizing: "border-box" as const, border: "1px solid rgba(128,128,128,0.18)", borderRadius: 13, padding: "0 12px", background: "var(--tg-secondary-bg)", color: "var(--tg-text)", fontSize: 14, fontWeight: 800, outline: "none" } as const;
const fallbackNoteStyle = { flex: "0 0 auto", borderRadius: 12, padding: "9px 10px", background: "rgba(128,128,128,0.10)", color: "var(--tg-hint)", fontSize: 11, fontWeight: 750, lineHeight: 1.35 } as const;
const candidateListStyle = { flex: "1 1 auto", minHeight: 0, overflowY: "auto", display: "grid", alignContent: "start", gap: 8, WebkitOverflowScrolling: "touch" } as const;
const emptyStyle = { padding: 18, borderRadius: 14, background: "rgba(128,128,128,0.10)", color: "var(--tg-hint)", textAlign: "center", fontSize: 13, fontWeight: 800 } as const;
const candidateButtonStyle = { width: "100%", minHeight: 54, display: "grid", gridTemplateColumns: "36px 1fr", alignItems: "center", gap: 10, border: "1px solid rgba(128,128,128,0.14)", borderRadius: 14, padding: "8px 10px", background: "color-mix(in srgb, var(--tg-secondary-bg) 82%, transparent)", color: "var(--tg-text)", textAlign: "left" } as const;
const avatarStyle = { width: 36, height: 36, borderRadius: "50%", display: "grid", placeItems: "center", background: "color-mix(in srgb, var(--tg-button) 18%, var(--tg-secondary-bg))", color: "var(--tg-text)", fontSize: 14, fontWeight: 950 } as const;

"use client";

import { useId, useState, type CSSProperties } from "react";
import { Pressable } from "@/app/components/ui/Pressable";
import type { WeeklyChallengeOption, WeeklyChallengeQuestion } from "../types";
import { weeklyQuestionDisplayCategory } from "../weeklyTemplates";
import { resolveWeeklyGroups, type WeeklyPoolMatch } from "../weeklyGroups";

const ACCENT = "#ff8a3c";
const DONE = "#2ec060";

// Match-context line for single-match templates (home — away snapshot). Groups are
// rendered by GroupComposition instead.
function matchContext(question: WeeklyChallengeQuestion): string | null {
  const cfg = (question.config || {}) as Record<string, unknown>;
  const home = String(cfg.home_team_name || "");
  const away = String(cfg.away_team_name || "");
  if (home || away) return `${home || "?"} — ${away || "?"}`;
  return null;
}

function pluralMatches(n: number): string {
  const abs = Math.abs(n) % 100; const last = abs % 10;
  if (abs >= 11 && abs <= 19) return "матчей";
  if (last === 1) return "матч";
  if (last >= 2 && last <= 4) return "матча";
  return "матчей";
}

function pluralGroups(n: number): string {
  const abs = Math.abs(n) % 100; const last = abs % 10;
  if (abs >= 11 && abs <= 19) return "групп";
  if (last === 1) return "группа";
  if (last >= 2 && last <= 4) return "группы";
  return "групп";
}

function kickoffLabel(ts: number | null): string {
  if (!ts) return "";
  return `${new Date(ts * 1000).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" })} МСК`;
}

// "Состав групп" — expandable list of each group's member matches, resolved from the
// challenge pool snapshot. Never shows raw match ids. Falls back to "данные недоступны".
function GroupComposition({ question, matches }: { question: WeeklyChallengeQuestion; matches: WeeklyPoolMatch[] }) {
  const groups = resolveWeeklyGroups(question.config, matches);
  const [open, setOpen] = useState<string | null>(null);
  const baseId = useId();
  if (!groups) return null;
  const calc = String((question.config as Record<string, unknown>)?.calculation || "");
  const hint = calc === "average_goals_per_match"
    ? "Сравнивается среднее количество голов за матч в каждой группе."
    : calc === "draws_count" ? "Сравнивается количество ничьих в каждой группе."
    : calc === "btts_count" ? "Сравнивается, как часто забивают обе команды в каждой группе."
    : calc === "corners_count" ? "Сравнивается общее количество угловых в каждой группе."
    : "";
  return (
    <div data-testid="weekly-group-composition" style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11.5, fontWeight: 850, color: ACCENT }}>Сравниваются {groups.length} {pluralGroups(groups.length)}</div>
      <div style={{ display: "grid", gap: 5, marginTop: 6 }}>
        {groups.map((g) => {
          const panelId = `${baseId}-${g.id}`;
          const isOpen = open === g.id;
          return (
            <div key={g.id} style={{ borderRadius: 10, border: "1px solid color-mix(in srgb, var(--tg-hint) 13%, transparent)", background: "color-mix(in srgb, var(--tg-secondary-bg) 55%, transparent)", overflow: "hidden" }}>
              <button
                type="button"
                data-testid={`weekly-group-toggle-${g.id}`}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpen(isOpen ? null : g.id)}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", color: "var(--tg-text)", minHeight: 40 }}
              >
                <span style={{ minWidth: 0, fontSize: 12.5, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.title}</span>
                <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: "var(--tg-hint)" }}>{g.matches.length} {pluralMatches(g.matches.length)} {isOpen ? "▲" : "▼"}</span>
              </button>
              {isOpen && (
                <ul id={panelId} style={{ listStyle: "none", margin: 0, padding: "0 10px 8px" }}>
                  {g.matches.map((m, i) => (
                    <li key={`${m.ref}-${i}`} style={{ padding: "4px 0", borderTop: i === 0 ? "none" : "1px solid color-mix(in srgb, var(--tg-hint) 9%, transparent)" }}>
                      {m.missing ? (
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--tg-hint)" }}>Данные матча недоступны</span>
                      ) : (
                        <>
                          <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--tg-text)", overflowWrap: "anywhere" }}>{m.home} — {m.away}</div>
                          {m.kickoff_at && <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--tg-hint)" }}>{kickoffLabel(m.kickoff_at)}</div>}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {hint && <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: "var(--tg-hint)", lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

export function WeeklyChallengeQuestionCard({
  question,
  selectedId,
  readOnly,
  onSelect,
  index,
  matches = [],
}: {
  question: WeeklyChallengeQuestion;
  selectedId: string | null;
  readOnly: boolean;
  onSelect: (optionId: string) => void;
  index: number;
  matches?: WeeklyPoolMatch[];
}) {
  const isActive = question.status === "active";
  const isVoid = question.status === "void";
  // Group id → member count, for the "N матча" option sublabel (empty for non-group questions).
  const groupCounts: Record<string, number> = {};
  for (const g of resolveWeeklyGroups(question.config, matches) || []) groupCounts[g.id] = g.matches.length;
  // Tie-capable questions carry an "equal" option. A tie is not resolved automatically:
  // the admin may confirm «Равенство» or accept every tied option, so say both are possible.
  const hasEqualOption = question.options.some((o: WeeklyChallengeOption) => o.id === "equal");
  return (
    <section style={cardStyle(isVoid)} role="group" aria-label={`Вопрос ${index + 1}: ${question.title}`}>
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 850, color: ACCENT, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {question.display_category || weeklyQuestionDisplayCategory(question.question_key)}
        </span>
        <span style={statusStyle(selectedId, isActive, isVoid)}>
          {selectedId && isActive ? "Выбрано ✓" : isVoid ? "Аннулирован" : !isActive ? "Отключён" : "Не выбран"}
        </span>
      </header>

      <h3 style={titleStyle}>{question.title}</h3>
      {matchContext(question) && (
        <p style={{ margin: "4px 0 0", fontSize: 11.5, fontWeight: 750, color: ACCENT, lineHeight: 1.35 }}>{matchContext(question)}</p>
      )}
      {question.description && <p style={descriptionStyle}>{question.description}</p>}
      <GroupComposition question={question} matches={matches} />

      <div style={optionsGridStyle} role="radiogroup" aria-label={question.title}>
        {question.options.map((option: WeeklyChallengeOption) => {
          const selected = selectedId === option.id;
          const disabled = readOnly || !isActive;
          // Group options get a "N матча" sublabel so the choice is self-explanatory.
          const groupCount = groupCounts[option.id];
          const sub = typeof option.sublabel === "string"
            ? String(option.sublabel)
            : groupCount != null ? `${groupCount} ${pluralMatches(groupCount)}` : null;
          return (
            <Pressable
              key={option.id}
              onClick={() => onSelect(option.id)}
              disabled={disabled}
              haptic="selection"
              pressedScale={0.985}
              role="radio"
              aria-checked={selected}
              style={optionButtonStyle(selected, disabled)}
            >
              <span style={{ fontSize: 13, fontWeight: 900, letterSpacing: 0, lineHeight: 1.2 }}>
                {option.label}
              </span>
              {sub && (
                <span style={{ marginTop: 2, fontSize: 11, fontWeight: 700, color: selected ? ACCENT : "var(--tg-hint)" }}>
                  {sub}
                </span>
              )}
            </Pressable>
          );
        })}
      </div>

      {hasEqualOption && (
        <p style={tieHintStyle}>
          Если показатели совпадут, верным могут признать «Равенство» либо сразу все совпавшие варианты.
        </p>
      )}
    </section>
  );
}

const tieHintStyle: CSSProperties = { margin: "8px 0 0", fontSize: 11, fontWeight: 700, color: "var(--tg-hint)", lineHeight: 1.4 };

function cardStyle(isVoid: boolean) {
  return {
    borderRadius: 16,
    padding: "10px 12px 11px",
    background: CARD_SURFACE,
    border: "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)",
    boxShadow: "0 7px 18px color-mix(in srgb, var(--tg-text) 10%, transparent), inset 0 1px 0 color-mix(in srgb, var(--tg-text) 6%, transparent)",
    color: "var(--tg-text)",
    opacity: isVoid ? 0.6 : 1,
  } as const;
}

function statusStyle(selectedId: string | null, isActive: boolean, isVoid: boolean) {
  const selected = !!selectedId && isActive;
  return {
    flexShrink: 0,
    minHeight: 20,
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "0 7px",
    fontSize: 10,
    fontWeight: 850,
    color: selected ? DONE : "color-mix(in srgb, var(--tg-text) 52%, var(--tg-hint))",
    background: selected
      ? "color-mix(in srgb, #34c759 13%, var(--tg-bg))"
      : isVoid
        ? "color-mix(in srgb, var(--tg-hint) 10%, transparent)"
        : "color-mix(in srgb, var(--tg-secondary-bg) 58%, transparent)",
    border: "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)",
    letterSpacing: "0.01em",
    whiteSpace: "nowrap",
  } as const;
}

const titleStyle = {
  margin: "2px 0 0",
  fontSize: 15,
  fontWeight: 950,
  letterSpacing: 0,
  lineHeight: 1.2,
  color: "var(--tg-text)",
} as const;

const descriptionStyle = {
  margin: "5px 0 0",
  fontSize: 12,
  fontWeight: 650,
  color: "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))",
  lineHeight: 1.45,
} as const;

const optionsGridStyle = {
  marginTop: 8,
  display: "grid",
  gap: 5,
} as const;

function optionButtonStyle(selected: boolean, disabled: boolean) {
  return {
    width: "100%",
    minHeight: 38,
    borderRadius: 11,
    border: selected ? `1px solid color-mix(in srgb, ${ACCENT} 74%, var(--tg-text))` : "1px solid color-mix(in srgb, var(--tg-hint) 13%, transparent)",
    background: selected
      ? `linear-gradient(180deg, color-mix(in srgb, ${ACCENT} 18%, var(--tg-bg)), color-mix(in srgb, ${ACCENT} 10%, var(--tg-secondary-bg)))`
      : "color-mix(in srgb, var(--tg-secondary-bg) 66%, var(--tg-bg))",
    color: selected ? `color-mix(in srgb, ${ACCENT} 76%, var(--tg-text))` : "var(--tg-text)",
    padding: "8px 11px",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled && !selected ? 0.55 : 1,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "flex-start",
    textAlign: "left" as const,
    boxShadow: selected ? `0 2px 12px color-mix(in srgb, ${ACCENT} 16%, transparent)` : "none",
    transition: "background 180ms ease, border-color 180ms ease, color 180ms ease, box-shadow 180ms ease",
  } as const;
}

const CARD_SURFACE = "linear-gradient(180deg, color-mix(in srgb, var(--tg-secondary-bg) 90%, var(--tg-bg)), color-mix(in srgb, var(--tg-bg) 84%, var(--tg-secondary-bg)))";

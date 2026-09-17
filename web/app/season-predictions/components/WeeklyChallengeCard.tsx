import { Pressable } from "@/app/components/ui/Pressable";
import type { WeeklyChallenge, WeeklyChallengeActiveResponse, WeeklyChallengeQuestion } from "../types";
import { STATUS_LABELS } from "../constants";
import { SeasonPredictionStatusPill } from "./SeasonPredictionStatusPill";

const ACCENT = "#ff8a3c"; // shared accent for the weekly mini-mode
const DONE = "#2ec060";

function formatDeadline(ts: number | null | undefined): string | null {
  if (!ts) return null;
  const diffMs = ts * 1000 - Date.now();
  if (diffMs < 0) return "Дедлайн прошёл";
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 60) return `${diffMinutes} мин до дедлайна`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} ч до дедлайна`;
  const diffDays = Math.ceil(diffMs / 86400000);
  if (diffDays <= 3) return `${diffDays}д до дедлайна`;
  return new Date(ts * 1000).toLocaleString("ru-RU", { day: "numeric", month: "short", timeZone: "Europe/Moscow" });
}

export function WeeklyChallengeEmpty() {
  return (
    <section style={emptyCardStyle}>
      <span style={{
        display: "inline-flex", alignItems: "center", height: 22, padding: "0 10px", marginBottom: 10,
        borderRadius: 999, fontSize: 11, fontWeight: 900, letterSpacing: "0.04em",
        background: `color-mix(in srgb, ${ACCENT} 16%, var(--tg-bg))`,
        color: `color-mix(in srgb, ${ACCENT} 82%, var(--tg-text))`,
        border: `1px solid color-mix(in srgb, ${ACCENT} 28%, transparent)`,
      }}>
        СКОРО
      </span>
      <div style={{ fontSize: 16, fontWeight: 950, color: "var(--tg-text)", letterSpacing: 0, marginBottom: 6 }}>
        Вызов недели пока не открыт
      </div>
      <div style={{ fontSize: 13, fontWeight: 650, color: "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))", lineHeight: 1.45 }}>
        Он появится перед ближайшим футбольным уикендом — пять быстрых вопросов по выбранным матчам.
      </div>
    </section>
  );
}

export function WeeklyChallengeCard({
  data,
  onOpen,
}: {
  data: WeeklyChallengeActiveResponse;
  onOpen: () => void;
}) {
  const challenge = data.challenge as WeeklyChallenge;
  const activeQuestions = (data.questions || []).filter((q: WeeklyChallengeQuestion) => q.status === "active");
  const total = activeQuestions.length || 5;
  const entryAnswers = data.entry?.answers || {};
  const filled = activeQuestions.reduce((count: number, question: WeeklyChallengeQuestion) => {
    return entryAnswers[question.question_key] ? count + 1 : count;
  }, 0);

  const locked = data.status === "locked";
  const submitted = data.status === "submitted";
  const draft = data.status === "draft";

  let ctaLabel: string;
  if (locked) ctaLabel = "Просмотр";
  else if (submitted) ctaLabel = "Открыть";
  else if (draft) ctaLabel = "Продолжить";
  else ctaLabel = "Начать";

  const ctaColor = locked ? "var(--tg-hint)" : submitted ? "var(--tg-text)" : ACCENT;
  const deadlineLabel = formatDeadline(challenge.deadline_at);

  let nextAction: string;
  let nextActionColor: string;
  if (locked) {
    nextAction = "Вызов закрыт";
    nextActionColor = "color-mix(in srgb, var(--tg-text) 50%, var(--tg-hint))";
  } else if (submitted && filled >= total) {
    nextAction = "Ответы подтверждены";
    nextActionColor = DONE;
  } else if (filled === 0) {
    nextAction = "Следующее: ответить на 5 вопросов";
    nextActionColor = ACCENT;
  } else if (filled < total) {
    nextAction = `Следующее: осталось ${total - filled} ${pluralRu(total - filled, "вопрос", "вопроса", "вопросов")}`;
    nextActionColor = ACCENT;
  } else {
    nextAction = "Следующее: подтвердить ответы";
    nextActionColor = ACCENT;
  }

  return (
    <Pressable
      onClick={onOpen}
      haptic="light"
      pressedScale={0.985}
      aria-label={`${challenge.title} — ${ctaLabel}`}
      style={{
        width: "100%",
        textAlign: "left",
        color: "var(--tg-text)",
        background: CARD_SURFACE,
        border: "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)",
        borderRadius: 16,
        padding: 0,
        cursor: "pointer",
        overflow: "hidden",
        boxShadow: CARD_SHADOW,
      }}
    >
      <div style={{ height: 3, background: ACCENT, boxShadow: `0 0 10px color-mix(in srgb, ${ACCENT} 70%, transparent)` }} />

      <div style={{ padding: "11px 13px 13px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 850, color: ACCENT, letterSpacing: "0.12em", textTransform: "uppercase", lineHeight: 1.6 }}>
            Вызов недели · {STATUS_LABELS[challenge.status] || challenge.status}
          </span>
          <SeasonPredictionStatusPill status={data.entry?.status || null} />
        </div>

        <div style={{ fontSize: 16, fontWeight: 950, letterSpacing: 0, lineHeight: 1.12, color: "var(--tg-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 3 }}>
          {challenge.title}
        </div>

        {challenge.description && (
          <div style={{ fontSize: 12, fontWeight: 700, color: META_COLOR, letterSpacing: "0.01em", lineHeight: 1.4, marginTop: 2 }}>
            {challenge.description}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
          <StatChip label={`${filled}/${total} ответов`} green={filled === total && total > 0} />
          {data.match_pool.length > 0 && <StatChip label={`${data.match_pool.length} ${pluralRu(data.match_pool.length, "матч", "матча", "матчей")}`} />}
          {deadlineLabel && <StatChip label={deadlineLabel} />}
        </div>

        <div style={ctaRowStyle}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 12, fontWeight: 800, color: nextActionColor, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: nextActionColor, flexShrink: 0 }} />
            {nextAction}
          </span>
          <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 900, letterSpacing: 0, color: ctaColor }}>
            {ctaLabel}
          </span>
        </div>
      </div>
    </Pressable>
  );
}

function StatChip({ label, green = false }: { label: string; green?: boolean }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      height: 21,
      padding: "0 8px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 800,
      background: green ? "color-mix(in srgb, #34c759 16%, var(--tg-bg))" : CHIP_BG,
      border: "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)",
      color: green ? DONE : "color-mix(in srgb, var(--tg-text) 80%, var(--tg-hint))",
      whiteSpace: "nowrap" as const,
    }}>
      {label}
    </span>
  );
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 19) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

const CARD_SURFACE = "linear-gradient(180deg, color-mix(in srgb, var(--tg-secondary-bg) 92%, var(--tg-bg)), color-mix(in srgb, var(--tg-bg) 82%, var(--tg-secondary-bg)))";
const CARD_SHADOW = "0 8px 22px color-mix(in srgb, var(--tg-text) 12%, transparent), inset 0 1px 0 color-mix(in srgb, var(--tg-text) 7%, transparent)";
const META_COLOR = "color-mix(in srgb, var(--tg-text) 58%, var(--tg-hint))";
const CHIP_BG = "color-mix(in srgb, var(--tg-secondary-bg) 72%, var(--tg-bg))";

const ctaRowStyle = {
  marginTop: 11,
  height: 36,
  borderRadius: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "0 11px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 64%, transparent)",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)",
} as const;

const emptyCardStyle = {
  borderRadius: 18,
  padding: "20px 16px",
  background: CARD_SURFACE,
  boxShadow: CARD_SHADOW,
  textAlign: "center" as const,
} as const;

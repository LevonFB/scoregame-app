import { SegmentedControl } from "@/app/components/ui/SegmentedControl";

// "weekly-challenge" and "tasks" were extracted into standalone app sections
// (Вызов недели = its own menu item; задания = общий раздел «Задания»).
export type SeasonPredictionsTabId = "top-leagues" | "european-cups" | "ballon-dor";

const TABS: Array<{ id: SeasonPredictionsTabId; label: string }> = [
  { id: "top-leagues", label: "Топ-5 лиг" },
  { id: "european-cups", label: "Еврокубки" },
  { id: "ballon-dor", label: "Золотой мяч" },
];

// Subsection keys used by the admin visibility settings for these tabs.
export const SEASON_PREDICTIONS_TAB_SUBSECTION_KEY: Record<SeasonPredictionsTabId, string> = {
  "top-leagues": "season_predictions.top_leagues",
  "european-cups": "season_predictions.european_cups",
  "ballon-dor": "season_predictions.ballon_dor",
};

export const SEASON_PREDICTIONS_TAB_IDS = TABS.map((t) => t.id);

export function SeasonPredictionsTabs({
  value,
  onChange,
  visibleTabs,
}: {
  value: SeasonPredictionsTabId;
  onChange: (next: SeasonPredictionsTabId) => void;
  // Admin-controlled subset; undefined = all tabs. With a single visible tab the
  // switch is pointless, so it renders nothing.
  visibleTabs?: SeasonPredictionsTabId[];
}) {
  const tabs = visibleTabs ? TABS.filter((t) => visibleTabs.includes(t.id)) : TABS;
  if (tabs.length < 2) return null;
  return (
    <SegmentedControl
      value={value}
      onChange={onChange}
      ariaLabel="Разделы Прогнозов сезона"
      pressedScale={0.985}
      trackStyle={{
        gap: 4,
        padding: 4,
        borderRadius: 14,
        background: "color-mix(in srgb, var(--tg-secondary-bg) 86%, var(--tg-bg) 14%)",
        border: "1px solid color-mix(in srgb, var(--tg-hint) 18%, transparent)",
        boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--tg-text) 8%, transparent)",
      }}
      pillStyle={{
        borderRadius: 10,
        border: "1px solid color-mix(in srgb, var(--tg-button) 30%, transparent)",
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--tg-button) 16%, var(--tg-bg)), color-mix(in srgb, var(--tg-button) 9%, var(--tg-secondary-bg)))",
        boxShadow: "0 1px 8px color-mix(in srgb, var(--tg-button) 12%, transparent)",
      }}
      itemStyle={(active) => ({
        height: 36,
        borderRadius: 10,
        color: active
          ? "color-mix(in srgb, var(--tg-button) 78%, var(--tg-text))"
          : "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))",
        fontSize: 13,
        fontWeight: 900,
        letterSpacing: 0,
        transition: "color 180ms ease",
      })}
      items={tabs.map((tab) => ({ key: tab.id, content: tab.label }))}
    />
  );
}

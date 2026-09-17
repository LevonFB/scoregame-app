// Pure helpers for app section visibility (menu + route gating). No I/O.

export type SectionVisibility = "visible_to_all" | "admin_only" | "hidden";

export const APP_SECTION_VISIBILITY_VALUES: SectionVisibility[] = ["visible_to_all", "admin_only", "hidden"];

// Allowed section keys. Defaults mirror the seed; unknown keys are rejected by admin PUT.
export const APP_SECTION_KEYS = [
  "home",
  "predictions",
  "season_predictions",
  "weekly_challenge",
  "leagues",
  "leaderboard",
  "tasks",
  "shop",
  "profile",
  "info",
] as const;

export type AppSectionKey = (typeof APP_SECTION_KEYS)[number];

export function isValidSectionKey(key: unknown): key is AppSectionKey {
  return typeof key === "string" && (APP_SECTION_KEYS as readonly string[]).includes(key);
}

export function isValidVisibility(value: unknown): value is SectionVisibility {
  return typeof value === "string" && APP_SECTION_VISIBILITY_VALUES.includes(value as SectionVisibility);
}

/**
 * Whether a section is visible to a given viewer.
 * - visible_to_all → everyone (when enabled)
 * - admin_only     → admins only
 * - hidden         → nobody (admins still manage it in the admin panel, but the
 *                    public route/menu treats it as not visible)
 * A disabled section (is_enabled = 0) is never visible to regular users.
 */
export function isSectionVisible(visibility: SectionVisibility, isAdmin: boolean, isEnabled = true): boolean {
  if (!isEnabled) return false; // a disabled section is hidden from the public menu/route
  if (visibility === "visible_to_all") return true;
  if (visibility === "admin_only") return isAdmin;
  return false; // hidden
}

// ─── Subsections (tabs inside a section) ─────────────────────────────────────
// A subsection is a tab/segment inside a section (e.g. «Еврокубки» inside
// «Прогнозы сезона»). Keys are namespaced as `<parent_key>.<subsection>` and
// live in the same app_section_visibility table with parent_key set.
// A subsection is only visible when its parent is visible too. The parent may
// itself be a subsection, which is how a third level works (the task groups
// inside «Задания» → «Прогнозы сезона»).
export type AppSubsectionDef = { key: string; parent: string; title: string; sortOrder: number };

export const APP_SUBSECTIONS: AppSubsectionDef[] = [
  { key: "season_predictions.top_leagues",   parent: "season_predictions", title: "Топ-5 лиг",        sortOrder: 31 },
  { key: "season_predictions.european_cups", parent: "season_predictions", title: "Еврокубки",        sortOrder: 32 },
  { key: "season_predictions.ballon_dor",    parent: "season_predictions", title: "Золотой мяч",     sortOrder: 33 },
  { key: "leaderboard.players",              parent: "leaderboard",        title: "Игроки",           sortOrder: 61 },
  { key: "leaderboard.leagues",              parent: "leaderboard",        title: "Лиги",             sortOrder: 62 },
  { key: "leaderboard.channels",             parent: "leaderboard",        title: "Каналы",           sortOrder: 63 },
  { key: "tasks.daily",                      parent: "tasks",              title: "Ежедневные",       sortOrder: 71 },
  { key: "tasks.weekly",                     parent: "tasks",              title: "Еженедельные",     sortOrder: 72 },
  { key: "tasks.season",                     parent: "tasks",              title: "Прогнозы сезона",  sortOrder: 73 },
  // Third level: the task groups shown inside «Задания» → «Прогнозы сезона».
  // Ids mirror the section ids the tasks endpoint returns (start / top5 / europe).
  { key: "tasks.season.start",               parent: "tasks.season",       title: "Старт сезона",     sortOrder: 731 },
  { key: "tasks.season.top5",                parent: "tasks.season",       title: "Топ-5 лиг",        sortOrder: 732 },
  { key: "tasks.season.europe",              parent: "tasks.season",       title: "Еврокубки",        sortOrder: 733 },
  { key: "tasks.season.ballon_dor",          parent: "tasks.season",       title: "Золотой мяч",      sortOrder: 734 },
  { key: "tasks.weekly_challenge",           parent: "tasks",              title: "Вызов недели",     sortOrder: 74 },
  { key: "tasks.partner",                    parent: "tasks",              title: "Партнёрские",      sortOrder: 75 },
  { key: "shop.boosts",                      parent: "shop",               title: "Бусты",            sortOrder: 81 },
  { key: "shop.luck",                        parent: "shop",               title: "Фортуна",          sortOrder: 82 },
  { key: "shop.topup",                       parent: "shop",               title: "Мячи",             sortOrder: 83 },
  { key: "shop.exchange",                    parent: "shop",               title: "Обмен",            sortOrder: 84 },
];

export const APP_SUBSECTION_KEYS = APP_SUBSECTIONS.map((s) => s.key);

const SUBSECTION_BY_KEY = new Map(APP_SUBSECTIONS.map((s) => [s.key, s]));

export function isValidSubsectionKey(key: unknown): boolean {
  return typeof key === "string" && SUBSECTION_BY_KEY.has(key);
}

/** Direct parent of a subsection key (a section OR another subsection), or null. */
export function subsectionParent(key: string): string | null {
  return SUBSECTION_BY_KEY.get(key)?.parent ?? null;
}

/**
 * Registry order for resolution: parents before children, so a nested
 * subsection can read its parent's already-resolved visibility.
 */
export function subsectionDepth(key: string): number {
  return key.split(".").length - 1;
}

export const APP_SUBSECTIONS_BY_DEPTH: AppSubsectionDef[] =
  [...APP_SUBSECTIONS].sort((a, b) => subsectionDepth(a.key) - subsectionDepth(b.key));

/**
 * Whether a subsection is visible: its own rule AND the parent section's.
 * A subsection inside a hidden section can never be visible, whatever its own
 * setting says — so the admin never has to un-toggle children by hand.
 */
export function isSubsectionVisible(
  visibility: SectionVisibility,
  isAdmin: boolean,
  isEnabled: boolean,
  parentVisible: boolean,
): boolean {
  if (!parentVisible) return false;
  return isSectionVisible(visibility, isAdmin, isEnabled);
}

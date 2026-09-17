"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, setApiInitData, setApiClientTiming } from "@/lib/api";
import { bootSplashDone, bootSplashStage } from "@/lib/bootSplash";
import { DateSelector } from "./components/DateSelector";
import { MatchesList, Match, Pick, Result } from "./components/MatchesList";
import { LeaguesSection, CHANNEL_BIND_FLAG } from "./components/LeaguesSection";
import { LeagueScreen } from "./components/LeagueScreen";
import { RatingTab, RATING_TYPE_SUBSECTION_KEYS } from "./components/RatingTab";
import AchievementToast, { triggerAchievementToast } from "./components/AchievementToast";
import QuestsScreen, { TASK_SUBSECTION_KEYS, TASK_TAB_SUBSECTION_KEY } from "./components/QuestsScreen";
import { useWeeklyClaimableCount, useSeasonTaskClaimableCount, CountBadge } from "./components/ClaimableBadge";
import OffSeasonState from "./components/OffSeasonState";
import NoMatchdayState from "./components/NoMatchdayState";
import RulesContent from "./components/RulesContent";
import ProfileScreen from "./components/ProfileScreen";
import UserProfileScreen from "./components/UserProfileScreen";
import UserAvatar from "./components/UserAvatar";
import ShopScreen, { SHOP_SUBSECTION_KEYS, SHOP_TAB_SUBSECTION_KEY } from "./components/ShopScreen";
import MaintenanceScreen from "./components/MaintenanceScreen";
import { BrandLogo } from "./components/ui/BrandLogo";
import { AppIcon } from "./components/ui/AppIcon";
import { Pressable } from "./components/ui/Pressable";
import type { AppIconName } from "./components/ui/appIcons";
import { buildClientReferralLink, openReferralShare } from "./components/ReferralCard";
import { HomeActionBoard, partnerPromoIcon, partnerPromoLabel, type HomeBonus, type HomeClaim, type PartnerPromo } from "./components/HomeHudStrip";
import { HomeWeeklyChallengeCard } from "./components/HomeWeeklyChallengeCard";
import { HomeSeasonPredictionsCard } from "./components/HomeSeasonPredictionsCard";
import { HomeLeaguesCarousel } from "./components/HomeLeaguesCarousel";
import { HomeRatingCarousel } from "./components/HomeRatingCarousel";
import { SeasonPredictionsFeature } from "./season-predictions/SeasonPredictionsFeature";
import { SEASON_PREDICTIONS_TAB_IDS, SEASON_PREDICTIONS_TAB_SUBSECTION_KEY, type SeasonPredictionsTabId } from "./season-predictions/components/SeasonPredictionsTabs";
import { WeeklyChallengeFeature } from "./weekly-challenge/WeeklyChallengeFeature";
import { formatTimeLeft } from "@/lib/timeLeft";

type CoreTab = "home" | "matches" | "seasonPredictions" | "weeklyChallenge" | "league" | "rating";
type MenuSection = CoreTab | "quests" | "shop" | "profile" | "rules" | "admin";

const MENU_APP_ICONS: Partial<Record<MenuSection, AppIconName>> = {
  matches: "daily_predictions",
  seasonPredictions: "season_predictions",
  weeklyChallenge: "weekly_challenge",
  league: "leagues",
  rating: "rating",
  quests: "quests",
  shop: "shop",
  profile: "profile",
};

// Запрос на личные сообщения от бота: показывается только после первого
// сохранённого прогноза и откладывается, а не гасится навсегда. Ключ v2 —
// прежний "bot-pm-cta-dismissed-v1" закрывал баннер одним тапом и без срока,
// из-за чего человек больше никогда его не видел.
const BOT_PM_SNOOZE_KEY = "bot-pm-cta-snooze-v2";
const BOT_PM_LEGACY_DISMISS_KEY = "bot-pm-cta-dismissed-v1";
const BOT_PM_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const BOT_PM_MAX_SHOWS = 3;
// Пауза перед просьбой на самом первом визите: человек успевает увидеть день
// и понять, о чём приложение, до того как у него что-то просят.
const BOT_PM_FIRST_VISIT_DELAY_MS = 20 * 1000;
const APP_VISITS_KEY = "app-visits-v1";
// Нативный попап показывается сам ОДИН раз за всё время, а не каждое открытие:
// повторно дёргать системный запрос — верный способ получить твёрдый отказ.
// Дальше человека зовёт только баннер, по своим правилам снуза.
const BOT_PM_AUTO_ASK_KEY = "bot-pm-auto-asked-v1";

// Счётчик открытий приложения. Нужен только затем, чтобы отличить первый визит
// от повторного: тому, кто вернулся и до сих пор не сыграл, напоминание нужнее
// всех, а по правилу «только после прогноза» он не получал его никогда.
function bumpAppVisits(): number {
  if (typeof window === "undefined") return 0;
  try {
    const next = (Number(window.localStorage.getItem(APP_VISITS_KEY)) || 0) + 1;
    window.localStorage.setItem(APP_VISITS_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}

function readBotPmAutoAsked(): boolean {
  if (typeof window === "undefined") return true; // на сервере не спрашиваем
  try {
    return window.localStorage.getItem(BOT_PM_AUTO_ASK_KEY) === "1";
  } catch {
    // Недоступный localStorage не должен превращаться в попап на каждом открытии.
    return true;
  }
}

function markBotPmAutoAsked(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BOT_PM_AUTO_ASK_KEY, "1");
  } catch { /* не смогли запомнить — защитой остаётся ref в пределах сессии */ }
}

function readBotPmSnooze(): { count: number; until: number } {
  if (typeof window === "undefined") return { count: 0, until: 0 };
  try {
    const raw = window.localStorage.getItem(BOT_PM_SNOOZE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { count: Number(parsed?.count) || 0, until: Number(parsed?.until) || 0 };
    }
    // Разовая миграция со старого флага: прежний отказ засчитывается как одно
    // откладывание без срока — эти люди получают второй шанс, но уже по новым
    // правилам (после прогноза и с лимитом показов).
    if (window.localStorage.getItem(BOT_PM_LEGACY_DISMISS_KEY) === "1") {
      window.localStorage.removeItem(BOT_PM_LEGACY_DISMISS_KEY);
      const migrated = { count: 1, until: 0 };
      window.localStorage.setItem(BOT_PM_SNOOZE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch { /* повреждённый localStorage — считаем, что отказов не было */ }
  return { count: 0, until: 0 };
}

// Дни недели в винительном падеже с предлогом: «в среду», «во вторник».
const WEEKDAY_ACCUSATIVE = [
  "в воскресенье",
  "в понедельник",
  "во вторник",
  "в среду",
  "в четверг",
  "в пятницу",
  "в субботу",
];

// "Завтра" / "в понедельник, 18 августа" — label for the nearest matchday when
// the selected day is empty. Compared against Moscow "today", like everywhere else.
function formatUpcomingDayLabel(day: string) {
  const todayMsk = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());
  const diffDays = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${todayMsk}T00:00:00Z`)) / 86400000);
  if (diffDays === 1) return "завтра";
  const date = new Date(`${day}T00:00:00Z`);
  const dateStr = date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
  if (diffDays <= 7) {
    return `${WEEKDAY_ACCUSATIVE[date.getUTCDay()]}, ${dateStr}`;
  }
  return dateStr;
}

function SectionUnavailable() {
  return (
    <div style={{ padding: "48px 24px", textAlign: "center", maxWidth: 600, margin: "0 auto" }}>
      <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.6 }}>🔒</div>
      <div style={{ fontSize: 17, fontWeight: 900, color: "var(--tg-text)", marginBottom: 6 }}>Раздел временно недоступен</div>
      <div style={{ fontSize: 14, color: "var(--tg-hint)", fontWeight: 650, lineHeight: 1.5 }}>
        Этот раздел сейчас закрыт.
      </div>
    </div>
  );
}

function PageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const screen = searchParams.get("screen");

  const [initData, setInitData] = useState("");
  // Theme is now handled by CSS variables

  const [matches, setMatches] = useState<Match[]>([]);
  // Schedule preview for an empty day: nearest future day that has matches
  // (served by /day/today so it costs no extra request).
  const [nextDay, setNextDay] = useState<string | null>(null);
  const [nextMatches, setNextMatches] = useState<Match[]>([]);
  const [serverPicks, setServerPicks] = useState<Record<string, Pick>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [jokerMatchId, setJokerMatchId] = useState<string | null>(null);

  const [results, setResults] = useState<Record<string, Result>>({});
  const [me, setMe] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPermissions, setAdminPermissions] = useState<string[]>([]);

  // App section visibility (admin-controlled menu/route gating).
  // null = not loaded yet → safe fallback (everything visible).
  const [sectionVisibility, setSectionVisibility] = useState<Record<string, boolean> | null>(null);
  // Subsection (tab-inside-a-section) visibility, keyed `<section>.<subsection>`.
  // Same fallback: null / unknown key = visible.
  const [subsectionVisibility, setSubsectionVisibility] = useState<Record<string, boolean> | null>(null);
  // Stage 9 — home leaderboard load reduction flags (default false => current
  // behavior: no dedupe, eager league loading). Delivered via /app-sections/visibility.
  const [homeRatingDedupeV2, setHomeRatingDedupeV2] = useState<boolean>(false);
  const [homeLeaguesLazyLoadV2, setHomeLeaguesLazyLoadV2] = useState<boolean>(false);
  // Becomes true once the visibility/flags request settles (success OR failure),
  // so home cards only decide eager-vs-lazy after the backend flags are known. On
  // failure we keep defaults => eager fallback (current behavior, never a regression).
  const [flagsGateReady, setFlagsGateReady] = useState<boolean>(false);
  // Lets other screens open the general "Задания" overlay on a specific tab.
  const [questsTabRequest, setQuestsTabRequest] = useState<{ tab: "daily" | "weekly" | "partner" | "season" | "weekly_challenge"; token: number; seasonTarget?: { section: string; subsection: string } }>({ tab: "daily", token: 0 });
  // Deep-link from the home card into "Прогнозы сезона" on a specific tab.
  const [seasonPredictionsTabRequest, setSeasonPredictionsTabRequest] = useState<{ tab: SeasonPredictionsTabId; token: number }>({ tab: "top-leagues", token: 0 });

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [isPicking, setIsPicking] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string>("");
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [matchesLoadedOnce, setMatchesLoadedOnce] = useState(false);
  // Day-list load failure: shown as an explicit error state with retry so a
  // provider/API outage is never presented as "сегодня матчей нет".
  const [dayLoadError, setDayLoadError] = useState(false);

  // Maintenance mode state
  const [showMaintenance, setShowMaintenance] = useState(false);
  // countdownTo: unix seconds of the launch moment (0 = plain maintenance notice)
  const [maintenanceData, setMaintenanceData] = useState<{ message: string; image: string; countdownTo: number }>({ message: '', image: '', countdownTo: 0 });

  // Leagues state
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null);
  const [showLeagueScreen, setShowLeagueScreen] = useState(false);

  // Keep-alive: track which tabs have been visited so they stay mounted
  const [tabMounted, setTabMounted] = useState<Record<string, boolean>>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      if (urlTab === 'rating') return { rating: true, league: false };
      if (urlTab === 'league' || urlTab === 'leagues') return { rating: false, league: true };
    }
    return { rating: false, league: false };
  });

  // UI State - home plus app sections
  const [activeTab, setActiveTab] = useState<CoreTab>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      if (urlTab === 'rating') return 'rating';
      if (urlTab === 'league' || urlTab === 'leagues') return 'league';
      if (urlTab === 'season-predictions' || urlTab === 'seasonPredictions') return 'seasonPredictions';
      if (urlTab === 'weekly-challenge' || urlTab === 'weeklyChallenge') return 'weeklyChallenge';
      if (urlTab === 'matches') return 'matches';
      if (urlTab === 'home') return 'home';
      // Returning from the bot's channel-bind flow: the app was restarted, so land
      // on leagues where the bind session is restored instead of dropping the user
      // on home as if nothing happened.
      try {
        if (localStorage.getItem(CHANNEL_BIND_FLAG) === "1") return 'league';
      } catch { }
    }
    return 'home';
  });
  const [menuOpen, setMenuOpen] = useState(false);

  // Load admin-controlled section visibility (best-effort; menu falls back to
  // fully visible until this resolves, so it never disappears).
  //
  // Перезапрашиваем, когда появился initData. Первый заход неизбежно анонимный:
  // этот эффект срабатывает на монтировании, а initData приезжает позже —
  // telegram-web-app.js опрашивается таймером. Без повторного запроса сервер
  // навсегда считал бы зрителя не-админом, и разделы с видимостью `admin_only`
  // не показывались бы даже администратору.
  useEffect(() => {
    let active = true;
    apiFetch<{ sections: Record<string, { visible: boolean }>; subsections?: Record<string, { visible: boolean }>; flags?: { homeRatingDedupeV2?: boolean; homeLeaguesLazyLoadV2?: boolean } }>("/app-sections/visibility")
      .then((res) => {
        if (!active || !res?.sections) return;
        const map: Record<string, boolean> = {};
        for (const [key, val] of Object.entries(res.sections)) map[key] = !!val?.visible;
        setSectionVisibility(map);
        if (res.subsections) {
          const subs: Record<string, boolean> = {};
          for (const [key, val] of Object.entries(res.subsections)) subs[key] = !!val?.visible;
          setSubsectionVisibility(subs);
        }
        setHomeRatingDedupeV2(!!res?.flags?.homeRatingDedupeV2);
        setHomeLeaguesLazyLoadV2(!!res?.flags?.homeLeaguesLazyLoadV2);
      })
      .catch(() => { /* keep fallback */ })
      .finally(() => { if (active) setFlagsGateReady(true); });
    return () => { active = false; };
  }, [initData]);

  // Overlay states
  const [showRules, setShowRules] = useState(false);
  const [showAchievements, setShowAchievements] = useState(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      return urlTab === 'tasks' || urlTab === 'achievements' || urlTab === 'quests';
    }
    return false;
  });
  const [showProfile, setShowProfile] = useState(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('tab') === 'profile';
    }
    return false;
  });
  const [viewUserKey, setViewUserKey] = useState<string | null>(null);
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);
  // Keep-alive: overlays stay mounted after first open
  const [questsMounted, setQuestsMounted] = useState(false);
  const [profileMounted, setProfileMounted] = useState(false);
  // Скролл-контейнер приложения — нужен, чтобы сбрасывать позицию при переходах.
  const appShellRef = useRef<HTMLElement | null>(null);
  const [headerBalls, setHeaderBalls] = useState<number>(0);
  const [headerProfile, setHeaderProfile] = useState<{ displayName: string; photoUrl: string | null } | null>(null);
  const [botPmEnabled, setBotPmEnabled] = useState<boolean | null>(null);
  const [showBotPmCta, setShowBotPmCta] = useState(false);
  // Поднимается в момент вступления по ссылке-приглашению: такой человек попал
  // в приложение напрямую, минуя /start, и в bot_users его нет.
  const [justJoinedLeague, setJustJoinedLeague] = useState(false);
  // То же самое для пришедшего по реферальной ссылке (?startapp=ref_/src_): он тоже
  // вошёл мимо /start, и позвать его боту нечем. Поднимаем только когда атрибуция
  // реально произошла — повторный переход по своей же ссылке не считается приходом.
  const [justArrivedByReferral, setJustArrivedByReferral] = useState(false);
  // Оба входа по ссылке ведут себя одинаково: попап сразу, баннер — только как запасной.
  const arrivedByInvite = justJoinedLeague || justArrivedByReferral;
  // Нативный попап показываем один раз; если его отклонили (или клиент попапа
  // не умеет) — поднимаем баннер с объяснением.
  const [botPmAutoAskFailed, setBotPmAutoAskFailed] = useState(false);
  const botPmAutoAskedRef = useRef(false);
  // Тот же факт, но как state: баннерному эффекту нужно перерисоваться, когда попап
  // в этой сессии уже показан, а ref ре-рендер не вызывает.
  const [botPmAutoAskedThisSession, setBotPmAutoAskedThisSession] = useState(false);
  const [appVisits, setAppVisits] = useState(0);
  const [botPmBusy, setBotPmBusy] = useState(false);
  const [botPmNotice, setBotPmNotice] = useState<string | null>(null);
  const [showShop, setShowShop] = useState(false);
  const [dayBoostUsage, setDayBoostUsage] = useState<{ boost_type: string; match_id?: string; dc_variant?: string } | null>(null);
  const [availableBoosts, setAvailableBoosts] = useState<{ id: number; type: string }[]>([]);
  // Unopened case inventory — arrives with the boosts payload (/bootstrap and /me/boosts),
  // so the home "Открыть кейсы" bar costs zero extra requests.
  const [myCases, setMyCases] = useState<{ case_type: string; quantity: number }[]>([]);
  // Партнёрское задание для плашки на главной; приходит в /bootstrap и равно
  // null, когда звать некуда: заданий нет или это уже выполнено.
  const [partnerPromo, setPartnerPromo] = useState<PartnerPromo | null>(null);
  // Shop tab the home bar lands on when it opens the shop.
  const [shopInitialTab, setShopInitialTab] = useState<'boosts' | 'luck' | 'topup' | 'exchange'>('boosts');
  const [seasonState, setSeasonState] = useState<{
    name?: string;
    status?: string;
    predictionsOpen: boolean;
    matchMode?: "club" | "national_teams";
    current?: any;
    nextUpcoming?: any;
  } | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchStartY, setTouchStartY] = useState<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
    setTouchStartY(e.touches[0].clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX === null || touchStartY === null) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX - touchStartX;
    const diffY = currentY - touchStartY;

    if (Math.abs(diffX) > Math.abs(diffY)) {
      if (diffX > 50 && touchStartX < 40) {
        if (!menuOpen) setMenuOpen(true);
        setTouchStartX(null);
      } else if (diffX < -50 && menuOpen) {
        setMenuOpen(false);
        setTouchStartX(null);
      }
    }
  };

  const handleTouchEnd = () => {
    setTouchStartX(null);
    setTouchStartY(null);
  };

  const showCoreSection = !showAchievements && !showProfile && !showShop && !showRules;

  // "Правила" — обычная вкладка: открытие любого другого экрана её закрывает.
  useEffect(() => {
    if (showAchievements || showShop || showProfile) setShowRules(false);
  }, [showAchievements, showShop, showProfile]);
  // Переключение core-вкладки также закрывает вкладку правил.
  useEffect(() => { setShowRules(false); }, [activeTab]);

  useEffect(() => {
    const urlTab = searchParams.get("tab");

    if (urlTab === "profile") {
      setShowProfile(true);
      setShowAchievements(false);
      setShowShop(false);
      setActiveTab("home");
      return;
    }

    if (urlTab === "tasks" || urlTab === "achievements" || urlTab === "quests") {
      setShowAchievements(true);
      setShowProfile(false);
      setShowShop(false);
      setActiveTab("home");
      return;
    }

    if (urlTab === "shop") {
      setShowShop(true);
      setShowAchievements(false);
      setShowProfile(false);
      setActiveTab("home");
      return;
    }

    setShowAchievements(false);
    setShowProfile(false);
    setShowShop(false);

    if (urlTab === "rating") {
      setActiveTab("rating");
      return;
    }

    if (urlTab === "league" || urlTab === "leagues") {
      setActiveTab("league");
      return;
    }

    if (urlTab === "season-predictions" || urlTab === "seasonPredictions") {
      setActiveTab("seasonPredictions");
      return;
    }

    if (urlTab === "matches") {
      setActiveTab("matches");
      return;
    }

    setActiveTab("home");
  }, [searchParams]);

  // Map UI menu sections → backend visibility section keys.
  const SECTION_KEY_BY_MENU: Partial<Record<MenuSection, string>> = {
    home: "home",
    matches: "predictions",
    seasonPredictions: "season_predictions",
    weeklyChallenge: "weekly_challenge",
    league: "leagues",
    rating: "leaderboard",
    quests: "tasks",
    shop: "shop",
    profile: "profile",
    rules: "info",
  };

  // Visible unless explicitly hidden by loaded settings. Unknown keys / not-yet-
  // loaded settings → visible (safe fallback so the menu never empties out).
  const sectionVisible = (section: MenuSection): boolean => {
    if (section === "admin") return isAdmin;
    const key = SECTION_KEY_BY_MENU[section];
    if (!key || !sectionVisibility) return true;
    return sectionVisibility[key] !== false;
  };

  // Same fallback for tabs inside a section: hidden only when the backend says so.
  // Passed down to the screens that own those tabs, keyed `<section>.<subsection>`.
  const subsectionVisible = (key: string): boolean => {
    if (!subsectionVisibility) return true;
    return subsectionVisibility[key] !== false;
  };

  // Open the general "Задания" overlay, optionally on a specific tab.
  const openTasks = (
    tab: "daily" | "weekly" | "partner" | "season" | "weekly_challenge" = "daily",
    seasonTarget?: { section: string; subsection: string },
  ) => {
    setMenuOpen(false);
    setShowProfile(false);
    setShowShop(false);
    setShowAchievements(true);
    setQuestsTabRequest((r) => ({ tab, token: r.token + 1, seasonTarget }));
  };

  const navigateAppSection = (section: MenuSection, opts?: { seasonTab?: SeasonPredictionsTabId }) => {
    setMenuOpen(false);
    // Route guard: block navigation to a section hidden for this viewer.
    if (!sectionVisible(section)) {
      setActiveTab("home");
      return;
    }
    if (section === "admin") {
      window.location.href = "/admin";
      return;
    }
    if (section === "weeklyChallenge") {
      setShowAchievements(false);
      setShowProfile(false);
      setShowShop(false);
      setActiveTab("weeklyChallenge");
      // Always land on the overview; detail opens only via the card's "Открыть".
      return;
    }
    if (section === "rules") {
      setShowProfile(false);
      setShowShop(false);
      setShowAchievements(false);
      setShowRules(true);
      return;
    }
    if (section === "quests") {
      setShowProfile(false);
      setShowShop(false);
      setShowAchievements(true);
      return;
    }
    if (section === "shop") {
      setShowProfile(false);
      setShowAchievements(false);
      setShowShop(true);
      return;
    }
    if (section === "profile") {
      setShowAchievements(false);
      setShowShop(false);
      setShowProfile(true);
      return;
    }
    setShowAchievements(false);
    setShowProfile(false);
    setShowShop(false);
    if (section === "seasonPredictions") {
      // Deep-link opens the requested tab (token>0); plain navigation resets to the default.
      setSeasonPredictionsTabRequest((r) =>
        opts?.seasonTab ? { tab: opts.seasonTab, token: r.token + 1 } : { tab: "top-leagues", token: 0 },
      );
    }
    setActiveTab(section);
    if (section === "league" || section === "rating") {
      setTabMounted(prev => ({ ...prev, [section]: true }));
    }
  };

  const openMatchInPredictions = (matchId: string) => {
    navigateAppSection("matches");
    window.setTimeout(() => {
      document.getElementById(`match-card-${matchId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 180);
  };

  const dismissBotPmCta = () => {
    if (typeof window !== "undefined") {
      // «Позже» больше не гасит баннер навсегда: копим число откладываний и
      // возвращаемся через BOT_PM_SNOOZE_MS, пока не упрёмся в BOT_PM_MAX_SHOWS.
      const state = readBotPmSnooze();
      window.localStorage.setItem(
        BOT_PM_SNOOZE_KEY,
        JSON.stringify({ count: state.count + 1, until: Date.now() + BOT_PM_SNOOZE_MS }),
      );
    }
    setShowBotPmCta(false);
    setBotPmNotice(null);
  };

  const openBotChat = () => {
    // @ts-ignore
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink("https://t.me/scoregameee_Bot");
      return;
    }
    window.open("https://t.me/scoregameee_Bot", "_blank", "noopener,noreferrer");
  };

  // auto = попап вызван сам, без нажатия на баннер (приход по приглашению).
  // В этом режиме нельзя ни уводить человека в чат бота, ни писать ему «отказ»:
  // он ничего не нажимал. Любая неудача просто поднимает баннер с объяснением.
  const handleEnableBotMessages = (opts?: { auto?: boolean }) => {
    const auto = opts?.auto === true;
    // @ts-ignore
    const tg = window.Telegram?.WebApp;
    if (!tg?.requestWriteAccess) {
      if (auto) {
        setBotPmAutoAskFailed(true);
        return;
      }
      setBotPmNotice("В этой версии Telegram нет быстрого запроса. Открой бота и нажми /start.");
      openBotChat();
      return;
    }

    setBotPmBusy(true);
    setBotPmNotice(null);

    tg.requestWriteAccess(async (granted?: boolean) => {
      if (!granted) {
        setBotPmBusy(false);
        if (auto) {
          setBotPmAutoAskFailed(true);
          return;
        }
        setBotPmNotice("Разрешение не выдано. Включить сообщения можно будет позже.");
        return;
      }

      try {
        const refreshedInitData = String(tg.initData || "");
        if (refreshedInitData) {
          setApiInitData(refreshedInitData);
          setInitData(refreshedInitData);
        }

        const res = await apiFetch<any>("/me/enable-bot-pm", {
          method: "POST",
          headers: refreshedInitData ? { "x-telegram-init-data": refreshedInitData } : undefined,
        });

        if (res.ok) {
          setBotPmEnabled(true);
          setShowBotPmCta(false);
          if (typeof window !== "undefined") {
            window.localStorage.removeItem(BOT_PM_SNOOZE_KEY);
            window.localStorage.removeItem(BOT_PM_LEGACY_DISMISS_KEY);
          }
          setInfo("Сообщения от бота включены. Теперь напоминания и системные уведомления будут приходить в личку.");
          setTimeout(() => setInfo(""), 4500);
        } else if (auto) {
          setBotPmAutoAskFailed(true);
        }
      } catch (e: any) {
        const msg = String(e?.message || "");
        // Разрешение выдано, но записать его не удалось. При авто-вызове человеку
        // нечего сообщать — он ничего не запускал; отдаём вопрос баннеру, где у
        // него будет кнопка «Включить» и та же ошибка уже к месту.
        if (auto) {
          setBotPmAutoAskFailed(true);
        } else if (msg.includes("BOT_WRITE_ACCESS_NOT_AVAILABLE")) {
          setBotPmNotice("Telegram ещё не передал доступ боту. Закрой и заново открой приложение, затем попробуй ещё раз.");
        } else {
          setBotPmNotice(msg.split(" | url=")[0] || "Не удалось включить сообщения от бота.");
        }
      } finally {
        setBotPmBusy(false);
      }
    });
  };

  // Listen for open-achievements event from toast
  useEffect(() => {
    const handler = () => {
      setShowProfile(false);
      setShowShop(false);
      setShowAchievements(true);
    };
    window.addEventListener('open-achievements', handler);
    return () => window.removeEventListener('open-achievements', handler);
  }, []);

  // Listen for maintenance events from apiFetch interceptor
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!isAdmin) {
        setMaintenanceData({ message: detail?.message || '', image: detail?.image || '', countdownTo: Number(detail?.countdownTo) || 0 });
        setShowMaintenance(true);
      }
    };
    window.addEventListener('maintenance', handler);
    return () => window.removeEventListener('maintenance', handler);
  }, [isAdmin]);

  // --- Telegram initData
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let viewportEventsAttached = false;
    let activeWebApp: NonNullable<Window["Telegram"]>["WebApp"] | null = null;
    // Diagnostic (2026-08-15): the poll below can spend up to 6s waiting for
    // Telegram before a single request goes out. Timestamps are relative to
    // navigation start, so they are directly comparable to the server phases.
    let tgFoundAtMs = 0;

    const applyViewportHeight = (tg: NonNullable<Window["Telegram"]>["WebApp"]) => {
      const telegramHeight = Number(tg.viewportStableHeight || tg.viewportHeight || 0);
      const innerHeight = Number(window.innerHeight || 0);
      // Заниженную высоту Telegram отдаёт в двух случаях: открыта клавиатура и
      // приложение свёрнуто. В первом случае верим клиенту, иначе контент уедет
      // под клавиатуру; во втором — берём высоту окна, иначе после разворота
      // оболочка остаётся низкой и экран выглядит пустым.
      const typing = !!document.activeElement
        && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      const viewportHeight = typing
        ? (telegramHeight || innerHeight)
        : Math.max(telegramHeight, innerHeight);
      if (viewportHeight > 0) {
        document.documentElement.style.setProperty("--sg-viewport-height", `${Math.round(viewportHeight)}px`);
      }
    };

    const handleViewportChanged = () => {
      if (activeWebApp) applyViewportHeight(activeWebApp);
    };

    /**
     * Возврат из свёрнутого состояния.
     *
     * Свёрнутое мини-приложение отдаёт высоту свёрнутой шторки, и она остаётся
     * в `--sg-viewport-height`: после разворота оболочка оставалась низкой, а
     * экран выглядел пустым — видно только шапку. Событие `viewportChanged`
     * приходит не всегда, поэтому пересчитываем высоту сами, а `expand()`
     * просит клиент вернуть полную высоту. Повтор через полсекунды нужен для
     * случая, когда в момент возврата клиент ещё отдаёт старое значение.
     */
    const handleResume = () => {
      if (!activeWebApp) return;
      if (document.visibilityState === "hidden") return;
      activeWebApp.expand?.();
      applyViewportHeight(activeWebApp);
      window.setTimeout(() => {
        if (activeWebApp) applyViewportHeight(activeWebApp);
      }, 500);
    };

    const tick = () => {
      if (cancelled) return;
      attempts += 1;

      // @ts-ignore
      const tg = window.Telegram?.WebApp;
      if (!tg) {
        return void setTimeout(tick, 50);
      }
      if (!tgFoundAtMs) tgFoundAtMs = performance.now();

      try {
        tg.ready?.();
        tg.expand?.();
        tg.disableVerticalSwipes?.();
        activeWebApp = tg;
        applyViewportHeight(tg);
        if (!viewportEventsAttached) {
          if (typeof tg.onEvent === "function") tg.onEvent("viewportChanged", handleViewportChanged);
          document.addEventListener("visibilitychange", handleResume);
          window.addEventListener("focus", handleResume);
          window.addEventListener("resize", handleViewportChanged);
          window.addEventListener("orientationchange", handleResume);
          viewportEventsAttached = true;
        }
        // Force header color
        tg.setHeaderColor?.(tg.themeParams?.secondary_bg_color || "#f2f2f7");
        tg.setBackgroundColor?.(tg.themeParams?.secondary_bg_color || "#f2f2f7");

        // Inject CSS variables if not present (older clients)
        if (tg.themeParams) {
          const r = document.documentElement;
          const t = tg.themeParams;
          if (t.bg_color) r.style.setProperty('--tg-bg', t.bg_color);
          if (t.text_color) r.style.setProperty('--tg-text', t.text_color);
          if (t.hint_color) r.style.setProperty('--tg-hint', t.hint_color);
          if (t.link_color) r.style.setProperty('--tg-link', t.link_color);
          if (t.button_color) r.style.setProperty('--tg-button', t.button_color);
          if (t.button_text_color) r.style.setProperty('--tg-button-text', t.button_text_color);
          if (t.secondary_bg_color) r.style.setProperty('--tg-secondary-bg', t.secondary_bg_color);
        }
      } catch { }

      const nextInitData = tg.initData ?? "";
      if (!nextInitData) {
        if (attempts < 120) {
          setTimeout(tick, 50);
        } else {
          // No initData is coming (opened outside Telegram): nothing to wait for.
          bootSplashDone();
        }
        return;
      }
      bootSplashStage(35, "Загружаем профиль и матчи");

      setApiClientTiming({
        tgMs: tgFoundAtMs,
        initDataMs: performance.now(),
        polls: attempts,
      });
      setApiInitData(nextInitData);
      setInitData(nextInitData);

      // Handle Telegram Mini App deep links
      const startParam = String(tg.initDataUnsafe?.start_param || "").trim().toLowerCase();
      if (startParam) {
        if (startParam.startsWith("join_")) {
          const inviteCode = startParam.replace("join_", "");
          handleJoinInvite(inviteCode, tg.initData);
        } else if (startParam.startsWith("ig_")) {
          // Paid-ads deep link (Instagram): land on home — the ad promises the
          // game, not a bare match list. The source itself is stored server-side
          // from the signed initData by /referral/claim.
          handleReferralClaim(tg.initData);
          setShowAchievements(false);
          setShowProfile(false);
          setShowShop(false);
          setActiveTab("home");
        } else if (startParam.startsWith("ref_") || startParam.startsWith("src_")) {
          // Referral / channel attribution: the server re-reads start_param from
          // the signed initData, this call just triggers the claim + welcome toast.
          handleReferralClaim(tg.initData);
          setShowAchievements(false);
          setShowProfile(false);
          setShowShop(false);
          setActiveTab("matches");
        } else if (startParam === "home" || startParam === "main") {
          setShowAchievements(false);
          setShowProfile(false);
          setShowShop(false);
          setActiveTab("home");
        } else if (startParam === "rating") {
          setShowAchievements(false);
          setShowProfile(false);
          setShowShop(false);
          setActiveTab("rating");
        } else if (startParam === "league" || startParam === "leagues") {
          setShowAchievements(false);
          setShowProfile(false);
          setShowShop(false);
          setActiveTab("league");
        } else if (startParam === "profile") {
          setShowAchievements(false);
          setShowShop(false);
          setShowProfile(true);
          setActiveTab("matches");
        } else if (startParam === "tasks" || startParam === "quests" || startParam === "achievements") {
          setShowProfile(false);
          setShowShop(false);
          setShowAchievements(true);
          setActiveTab("matches");
        } else if (startParam === "shop") {
          setShowAchievements(false);
          setShowProfile(false);
          setShowShop(true);
          setActiveTab("matches");
        } else {
          setShowAchievements(false);
          setShowProfile(false);
          setShowShop(false);
          setActiveTab("matches");
        }
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (viewportEventsAttached) {
        activeWebApp?.offEvent?.("viewportChanged", handleViewportChanged);
        document.removeEventListener("visibilitychange", handleResume);
        window.removeEventListener("focus", handleResume);
        window.removeEventListener("resize", handleViewportChanged);
        window.removeEventListener("orientationchange", handleResume);
      }
    };
  }, []);

  // Achievements feature removed (2026-06-26): the legacy startup /achievements
  // fetch (which only flushed pending unlock toasts) is gone — the backend no
  // longer unlocks achievements, so this request was pure waste on every open.

  // Maintenance status now arrives with the /bootstrap payload (loadData);
  // the standalone startup /maintenance/status request is gone. The legacy
  // fallback path inside loadData still checks it the old way.

  // Referral claim (deep link ref_/src_): best-effort, silent on any failure.
  const handleReferralClaim = async (initDataStr: string) => {
    try {
      const res = await apiFetch<{ ok: boolean; attached?: boolean; referrer_name?: string | null; invitee_reward_label?: string | null }>("/referral/claim", {
        method: "POST",
        body: JSON.stringify({ initData: initDataStr }),
      });
      if (res?.ok && res.attached) {
        const who = res.referrer_name ? `Тебя пригласил(а) ${res.referrer_name}. ` : "";
        setInfo(`${who}Сделай первый прогноз — получишь подарок: ${res.invitee_reward_label || "награду"} 🎁`);
        setTimeout(() => setInfo(""), 7000);
        setJustArrivedByReferral(true);
      }
    } catch { /* attribution must never disturb onboarding */ }
  };

  // Deep link join handler
  const handleJoinInvite = async (code: string, initDataStr: string) => {
    try {
      const res = await apiFetch<{ ok: boolean; league: { id: string; name: string }; alreadyMember: boolean }>("/leagues/join", {
        method: "POST",
        body: JSON.stringify({ initData: initDataStr, invite_code: code })
      });

      if (res.ok) {
        setInfo(res.alreadyMember ? `Ты уже в лиге "${res.league.name}"` : `Ты вступил в лигу "${res.league.name}"!`);
        setTimeout(() => setInfo(""), 4000);
        // Пришедшего по ссылке-приглашению оставляем на матчах: таблица лиги с
        // нулями не объясняет, что делать, а первым экраном должен быть прогноз.
        // О вступлении сообщает тост, сама лига предвыбрана во вкладке «Лига».
        setSelectedLeagueId(res.league.id);
        setShowLeagueScreen(false);
        setActiveTab("matches");
        if (!res.alreadyMember) setJustJoinedLeague(true);
      } else {
        setErr("Не удалось вступить в лигу");
      }
    } catch (e: any) {
      const msg = e?.message === "LEAGUE_FULL"
        ? "Лига заполнена (максимум 25 участников). Попроси создателя завести новую лигу."
        : (e.message || "Ошибка");
      setErr(msg);
    }
  };

  // Keep-alive: mark overlays as mounted on first open so they stay in DOM
  useEffect(() => { if (showAchievements) setQuestsMounted(true); }, [showAchievements]);
  useEffect(() => { if (showProfile) setProfileMounted(true); }, [showProfile]);

  // Весь экран — один скролл-контейнер, и при смене раздела scrollTop раньше
  // оставался прежним: со старой (длинной) вкладки попадали ниже всего контента
  // новой — sticky-шапка на месте, под ней пустота. Новый раздел всегда
  // открываем сверху.
  useEffect(() => {
    appShellRef.current?.scrollTo({ top: 0 });
  }, [activeTab, showAchievements, showProfile, showShop, showRules, showLeagueScreen]);

  // Telegram BackButton: while any layer is open, the native back arrow/gesture
  // closes the topmost layer instead of the whole Mini App.
  useEffect(() => {
    // @ts-ignore
    const tg = window.Telegram?.WebApp;
    if (!tg?.BackButton) return;

    const closeTopLayer = () => {
      if (menuOpen) { setMenuOpen(false); return; }
      if (viewUserKey) { setViewUserKey(null); return; }
      if (showShop) { setShowShop(false); return; }
      if (showAchievements) { setShowAchievements(false); return; }
      if (showProfile) { setShowProfile(false); return; }
      if (showRules) { setShowRules(false); return; }
      if (activeTab === "league" && showLeagueScreen) { setShowLeagueScreen(false); return; }
    };

    const hasLayer =
      menuOpen || !!viewUserKey || showShop || showAchievements || showProfile || showRules ||
      (activeTab === "league" && showLeagueScreen);

    if (!hasLayer) {
      tg.BackButton.hide?.();
      return;
    }

    tg.BackButton.onClick?.(closeTopLayer);
    tg.BackButton.show?.();
    return () => {
      tg.BackButton.offClick?.(closeTopLayer);
    };
  }, [menuOpen, viewUserKey, showShop, showAchievements, showProfile, showRules, showLeagueScreen, activeTab]);

  // --- Clock tick
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  // --- Apply helpers for startup payload sections. Shared by the /bootstrap
  // path and the legacy per-endpoint fallback so both set identical state.
  const applyResults = (rows: any[]) => {
    const m: Record<string, Result> = {};
    for (const r of (rows || [])) {
      m[r.matchId] = r;
    }
    setResults(m);
  };

  const applyPicks = (rows: any[]) => {
    const pMap: Record<string, Pick> = {};
    let jokerId: string | null = null;
    for (const p of (rows || [])) {
      pMap[p.matchId] = p;
      if (p.isJoker) jokerId = p.matchId;
    }
    setServerPicks(pMap);
    if (!isPicking) {
      setPicks(structuredClone(pMap));
      setJokerMatchId(jokerId);
    }
  };

  const applyBoosts = (res: any) => {
    setDayBoostUsage(res.dayUsage || null);
    setAvailableBoosts(res.available || []);
    setMyCases(res.cases || []);
    setHeaderBalls(res.balls ?? headerBalls);
  };

  const applySeasonProgress = (res: any) => {
    setHeaderBalls(res.balls ?? 0);
    setSeasonState({
      name: res.seasonName,
      status: res.seasonStatus,
      predictionsOpen: !!res.predictionsOpen,
      matchMode: res.matchMode || "club",
      current: res.displaySeason?.current || null,
      nextUpcoming: res.displaySeason?.nextUpcoming || null,
    });
  };

  const applyProfile = (u: any) => {
    setHeaderProfile({
      displayName: String(u.displayName || u.first_name || "Игрок"),
      photoUrl: u.photoUrl || null,
    });
    setBotPmEnabled(!!u.botPmEnabled);
  };

  // Pre-/bootstrap startup path. Kept as a fallback for the deploy window when
  // the static frontend is newer than api-worker, or if /bootstrap errors.
  const loadLegacyStartup = async (shouldForceProviderRefresh: boolean) => {
    const resultsP = apiFetch<any>(`/results?date=${selectedDate}${shouldForceProviderRefresh ? `&_ts=${Date.now()}` : ""}`);
    const picksP = apiFetch<any>("/picks", {
      method: "POST",
      body: JSON.stringify({ initData, day: selectedDate }),
    });
    const leaderboardP = apiFetch<any>("/leaderboard", {
      method: "POST",
      body: JSON.stringify({ initData }),
    });

    const [resRes, picksRes, lbRes] = await Promise.all([resultsP, picksP, leaderboardP]);
    if (resRes.ok) applyResults(resRes.results);
    if (picksRes.ok) applyPicks(picksRes.picks);
    if (lbRes.ok) {
      setMe(lbRes.me);
      setIsAdmin(lbRes.isAdmin);
    }

    loadBoosts();
    apiFetch<any>("/me/season-progress")
      .then((res) => { if (res.ok) applySeasonProgress(res); })
      .catch(() => { });
    apiFetch<any>("/me/profile")
      .then((res) => { if (res.ok && res.user) applyProfile(res.user); })
      .catch(() => { });

    try {
      const meRes = await apiFetch<any>("/me", { headers: { "x-telegram-init-data": initData } });
      const isAdm = !!(meRes.ok && meRes.data?.isAdmin);
      setIsAdmin(isAdm);
      setAdminPermissions(isAdm ? (meRes.data.permissions || []) : []);
      if (isAdm) {
        setShowMaintenance(false);
      } else {
        const mres = await apiFetch<any>("/maintenance/status").catch(() => null);
        if (mres?.maintenance) {
          setMaintenanceData({ message: mres.message || "", image: mres.image || "", countdownTo: Number(mres.countdownTo) || 0 });
          setShowMaintenance(true);
        }
      }
    } catch (err) {
      console.error("Admin check failed", err);
      setIsAdmin(false);
      setAdminPermissions([]);
    }
  };

  // --- Load Data
  const loadData = async (forceToday = false) => {
    if (!initData) return;
    const shouldForceProviderRefresh = forceToday;

    setErr(null);
    setDayLoadError(false);
    setMatchesLoading(true);

    try {
      // Two parallel requests: the shared, edge-cached day payload and the
      // combined per-user /bootstrap (replaces 8 separate startup requests).
      const matchesUrl = shouldForceProviderRefresh
        ? `/day/today?force=true&date=${selectedDate}`
        : `/day/today?date=${selectedDate}`;

      const matchesP = apiFetch<any>(matchesUrl);
      const bootstrapP = apiFetch<any>("/bootstrap", {
        method: "POST",
        body: JSON.stringify({ initData, day: selectedDate }),
      });

      // Startup splash progress: each settled request (ok or not) is a real milestone.
      let settledCount = 0;
      const markSettled = (remaining: string) => () => {
        settledCount += 1;
        bootSplashStage(settledCount === 1 ? 65 : 90, settledCount === 1 ? remaining : "Почти готово");
      };
      matchesP.then(markSettled("Загружаем профиль"), markSettled("Загружаем профиль"));
      bootstrapP.then(markSettled("Матчи дня"), markSettled("Матчи дня"));

      // Each payload is applied as it lands, not in the order it is written here.
      // /bootstrap is the startup identity (admin, maintenance, profile, boosts)
      // and usually answers in ~1s; awaiting the day payload first made a slow
      // /day/today (an empty day can cost seconds) look like a stuck login.
      // The day's match mode has to survive whichever order wins, so it is kept
      // in a local and re-applied after the season payload sets its global one.
      let dayMatchMode: string | null = null;

      const dayTask = (async () => {
        // A day-list failure must not abort the bootstrap path: picks/balances
        // still load, and the tab shows an explicit error state instead of a
        // fake "нет матчей".
        let matchesRes: any = null;
        try {
          matchesRes = await matchesP;
        } catch (dayErr) {
          console.error("[DAY] load failed:", dayErr);
          setDayLoadError(true);
          setMatchesLoading(false);
          setMatchesLoadedOnce(true);
          return;
        }

        if (matchesRes?.ok) {
          setMatches(matchesRes.matches || []);
          setNextDay(matchesRes.nextDay || null);
          setNextMatches(matchesRes.nextMatches || []);
          if (matchesRes.matchMode) {
            dayMatchMode = matchesRes.matchMode;
            setSeasonState((prev) => prev ? { ...prev, matchMode: matchesRes.matchMode } : prev);
          }
          setMatchesLoading(false); // <- show matches immediately!
          setMatchesLoadedOnce(true);
        } else {
          console.error("[DAY] load error:", matchesRes.error);
          setDayLoadError(true);
        }
      })();

      const bootTask = (async () => {
        let boot: any = null;
        try {
          boot = await bootstrapP;
        } catch (bootErr) {
          console.error("[BOOTSTRAP] failed, falling back to legacy endpoints:", bootErr);
        }

        if (boot?.ok) {
          setIsAdmin(!!boot.isAdmin);
          setAdminPermissions(boot.permissions || []);

          if (boot.maintenance?.enabled && !boot.isAdmin) {
            // Maintenance for non-admins: the payload carries no game data.
            setMaintenanceData({ message: boot.maintenance.message || "", image: boot.maintenance.image || "", countdownTo: Number(boot.maintenance.countdownTo) || 0 });
            setShowMaintenance(true);
            return;
          }
          setShowMaintenance(false);

          if (shouldForceProviderRefresh) {
            // /bootstrap ran in parallel with the forced provider refresh, so
            // re-fetch results to pick up just-updated scores.
            try {
              const fresh = await apiFetch<any>(`/results?date=${selectedDate}&_ts=${Date.now()}`);
              applyResults(fresh.ok ? fresh.results : (boot.results || []));
            } catch {
              applyResults(boot.results || []);
            }
          } else {
            applyResults(boot.results || []);
          }

          applyPicks(boot.picks || []);
          if (boot.me) setMe(boot.me);
          if (boot.boosts?.ok) applyBoosts(boot.boosts);
          if (boot.seasonProgress?.ok) {
            applySeasonProgress(boot.seasonProgress);
            // Keep the day-specific match mode from /day/today on top of the
            // global one from the season payload. Only needed when the day
            // payload already landed; if it lands later it applies its own.
            const mode = dayMatchMode;
            if (mode) {
              setSeasonState((prev) => prev ? { ...prev, matchMode: mode } : prev);
            }
          }
          if (boot.profile) applyProfile(boot.profile);
          setPartnerPromo(boot.partnerPromo || null);
        } else {
          await loadLegacyStartup(shouldForceProviderRefresh);
        }
      })();

      // Both chains own their errors; this only holds the `finally` below until
      // the slower of the two is done.
      await Promise.allSettled([dayTask, bootTask]);
    } catch (e: any) {
      console.error(e);
      setErr("Не удалось загрузить данные. Проверь соединение и попробуй ещё раз.");
    } finally {
      setMatchesLoading(false);
      setMatchesLoadedOnce(true);
      // Startup data is applied (or failed into its own error state): lift the splash.
      // Later reloads (date switch, pull-to-refresh) call this again as a no-op.
      bootSplashDone();
    }
  };

  useEffect(() => {
    loadData();
  }, [initData, selectedDate]);

  // Load boosts for current day
  const loadBoosts = async () => {
    if (!initData) return;
    try {
      const res = await apiFetch<any>('/me/boosts', {
        method: 'POST',
        body: JSON.stringify({ initData, day: selectedDate }),
      });
      if (res.ok) {
        setDayBoostUsage(res.dayUsage || null);
        setAvailableBoosts(res.available || []);
        setMyCases(res.cases || []);
        setHeaderBalls(res.balls ?? headerBalls);
      }
    } catch (e) {
      console.error('[BOOSTS] load error:', e);
    }
  };
  // No standalone boosts effect: startup/date-change boosts arrive with the
  // /bootstrap payload inside loadData; loadBoosts() re-syncs after apply/remove.

  const handleApplyBoost = async (boostId: number, matchId: string, dcVariant?: string) => {
    if (seasonState && !seasonState.predictionsOpen) {
      setErr("Сезон закрыт. Бусты недоступны.");
      return;
    }
    try {
      const res = await apiFetch<any>('/boosts/apply', {
        method: 'POST',
        body: JSON.stringify({ initData, boostId, day: selectedDate, matchId, dcVariant }),
      });
      if (res.ok) {
        await loadBoosts();
      } else {
        alert(res.error || 'Ошибка применения буста');
      }
    } catch (e: any) {
      alert(e.message || 'Ошибка');
    }
  };

  const handleRemoveBoost = async () => {
    if (seasonState && !seasonState.predictionsOpen) {
      setErr("Сезон закрыт. Изменение бустов недоступно.");
      return;
    }
    try {
      const res = await apiFetch<any>('/boosts/remove', {
        method: 'POST',
        body: JSON.stringify({ initData, day: selectedDate }),
      });
      if (res.ok) {
        await loadBoosts();
      } else {
        alert(res.error || 'Ошибка снятия буста');
      }
    } catch (e: any) {
      alert(e.message || 'Ошибка');
    }
  };

  // Season header + profile arrive with /bootstrap on startup. This effect only
  // re-fetches the profile after an explicit update (profileRefreshKey bump).
  useEffect(() => {
    if (!initData || profileRefreshKey === 0) return;
    apiFetch<any>("/me/profile")
      .then((res) => {
        if (res.ok && res.user) applyProfile(res.user);
      })
      .catch(() => { });
  }, [initData, profileRefreshKey]);

  useEffect(() => {
    setAppVisits(bumpAppVisits());
  }, []);

  useEffect(() => {
    if (botPmEnabled === null || typeof window === "undefined") return;
    if (botPmEnabled) {
      setShowBotPmCta(false);
      return;
    }
    const { count, until } = readBotPmSnooze();
    if (count >= BOT_PM_MAX_SHOWS || Date.now() < until) {
      setShowBotPmCta(false);
      return;
    }

    // Тому, кого в этот заход спрашивает нативный попап (эффект ниже), баннер не
    // нужен: он вступает лишь запасным вариантом — если попап отклонили или клиент
    // его не умеет. Это и приход по ссылке, и обычное открытие без /start.
    if (arrivedByInvite || botPmAutoAskedThisSession) {
      setShowBotPmCta(botPmAutoAskFailed);
      return;
    }

    // Дальше — те, кого нативный попап уже спрашивал раньше (один раз за всё время),
    // и он остался без ответа. Прежнее правило («после прогноза или со второго
    // визита») исходило из того, что в приложение попадают через /start. На деле
    // половина входов идёт мимо: кнопка меню бота открывает Mini App до всякого
    // /start, ссылка-приглашение — тем более. Для такого человека второго визита
    // может не быть: звать его некому, он не в bot_users. Поэтому баннер поднимаем
    // уже на первом — но только когда день загрузился и ему есть что увидеть.
    if (!matchesLoadedOnce) {
      setShowBotPmCta(false);
      return;
    }

    const hasSavedPick = Object.keys(serverPicks).length > 0;
    const returning = appVisits >= 2;
    if (hasSavedPick || returning) {
      setShowBotPmCta(true);
      return;
    }

    const timer = window.setTimeout(() => setShowBotPmCta(true), BOT_PM_FIRST_VISIT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [botPmEnabled, serverPicks, appVisits, matchesLoadedOnce, arrivedByInvite, botPmAutoAskFailed, botPmAutoAskedThisSession]);

  // Автозапрос доступа. Спрашиваем и тех, кто пришёл по ссылке (лига / рефералка), и
  // тех, кто просто открыл Mini App мимо /start — кнопкой меню бота или прямой ссылкой.
  // У всех троих одна и та же беда: их нет в bot_users, и позвать их обратно нечем,
  // так что просьба должна прозвучать, пока человек в приложении.
  //
  // Разница только в моменте. Пришедшего по ссылке спрашиваем сразу: контекст очевиден,
  // его только что позвал знакомый. Открывшему приложение самому даём сначала увидеть
  // день — иначе системный попап встречает его на пустом экране.
  //
  // Барьеров два: ref не даёт дёрнуть попап дважды в одной сессии (в т.ч. на повторном
  // прогоне эффекта), а localStorage-ключ — во все следующие. Один автопопап за всё
  // время; дальше человека зовёт только баннер со своим снузом.
  useEffect(() => {
    if (botPmEnabled !== false) return;
    if (botPmAutoAskedRef.current) return;
    // Прошлые «Позже» по баннеру попап не отменяют: баннер легко пролистать не глядя,
    // и отложить его — не то же самое, что отказаться от напоминаний. Такой человек
    // получает ровно одну попытку системным попапом, а не давление: ключ ниже держит
    // его одноразовым для всех одинаково.
    if (!arrivedByInvite && !matchesLoadedOnce) return;
    if (readBotPmAutoAsked()) return;
    botPmAutoAskedRef.current = true;
    markBotPmAutoAsked();
    setBotPmAutoAskedThisSession(true);
    handleEnableBotMessages({ auto: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivedByInvite, botPmEnabled, matchesLoadedOnce]);

  // Admin status arrives with the /bootstrap payload (or via the legacy
  // fallback path inside loadData) — no standalone /me request on startup.

  // Тик часов чаще (15с), пока пользователь не редактирует пики
  useEffect(() => {
    if (isPicking) return;
    const t = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(t);
  }, [isPicking]);

  const isLocked = useMemo(() => {
    return (m: Match) => {
      const unlockMs = m.unlockTime ? new Date(m.unlockTime).getTime() : 0;
      const lockMs = new Date(m.lockTime).getTime();
      // Locked if: before unlock time OR after lock time
      return nowMs < unlockMs || nowMs >= lockMs;
    };
  }, [nowMs]);

  // Dirty state check
  const hasChanges = useMemo(() => {
    for (const m of matches) {
      if (isLocked(m)) continue;
      const mid = m.id;
      const p = picks[mid];
      const s = serverPicks[mid];

      // New pick (and not 0:0 default if we want to be strict, but actually we treat existing pick object as source of truth)
      // If p exists but s doesn't -> dirty
      if (p && !s) return true;

      // Both exist -> compare
      if (p && s) {
        if (p.home !== s.home) return true;
        if (p.away !== s.away) return true;
        if (p.isJoker !== s.isJoker) return true;
      }
    }
    return false;
  }, [matches, picks, serverPicks, isLocked]);

  const saveAll = async () => {
    if (seasonState && !seasonState.predictionsOpen) {
      setErr("Сезон закрыт. Приём прогнозов остановлен.");
      return;
    }
    setIsSaving(true);
    try {
      const promises = [];
      for (const m of matches) {
        if (isLocked(m)) continue;
        const mid = m.id;
        const p = picks[mid];
        const s = serverPicks[mid];

        // Check dirty for this specific match
        let dirty = false;
        if (p && !s) dirty = true;
        else if (p && s) {
          if (p.home !== s.home || p.away !== s.away || p.isJoker !== s.isJoker) dirty = true;
        }

        if (dirty && p) {
          const endpoint = p.isJoker ? "/joker" : "/pick";
          promises.push(apiFetch<any>(endpoint, {
            method: "POST",
            body: JSON.stringify({
              initData,
              day: selectedDate,
              matchId: mid,
              home: p.home,
              away: p.away
            })
          }));
        }
      }

      const results = await Promise.all(promises);

      // Collect achievement toasts
      const allNew = [];
      for (const r of results) {
        if (r.newAchievements) allNew.push(...r.newAchievements);
      }
      if (allNew.length) triggerAchievementToast(allNew);

      // Update server picks to match current
      setServerPicks(JSON.parse(JSON.stringify(picks)));

      // Haptic
      // @ts-ignore
      if (typeof window !== 'undefined' && window.Telegram?.WebApp?.HapticFeedback) {
        // @ts-ignore
        window.Telegram.WebApp.HapticFeedback.notificationOccurred("success");
      }

      setInfo("Сохранено");
      setTimeout(() => setInfo(""), 2000);
    } catch (e: any) {
      setErr("Не удалось сохранить: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const onUpdatePick = (mid: string, patch: Partial<Pick>) => {
    setPicks((prev) => {
      const old = prev[mid] || { matchId: mid, home: 0, away: 0, isJoker: false, updatedAt: "" };
      return { ...prev, [mid]: { ...old, ...patch } };
    });
  };

  // Impl handleSave for single match
  const handleSave = async (matchId: string, home: number, away: number) => {
    if (!initData) return;
    if (seasonState && !seasonState.predictionsOpen) {
      throw new Error("Сезон закрыт. Приём прогнозов остановлен.");
    }
    setIsSaving(true);
    const currentAdvancesAnswer = picks[matchId]?.advancesAnswer ?? null;
    const currentBonusAnswers = picks[matchId]?.bonusAnswers ?? {};
    const currentGoalscorerPick = picks[matchId]?.goalscorerPick ?? undefined;
    try {
      // Optimistic update
      setPicks((prev) => ({
        ...prev,
        [matchId]: {
          matchId,
          home,
          away,
          isJoker: jokerMatchId === matchId,
          advancesAnswer: currentAdvancesAnswer,
          bonusAnswers: currentBonusAnswers,
          goalscorerPick: currentGoalscorerPick,
          updatedAt: new Date().toISOString()
        }
      }));

      const res = await apiFetch<any>("/pick", {
        method: "POST",
        body: JSON.stringify({
          initData,
          day: selectedDate,
          matchId,
          home,
          away,
          advancesAnswer: currentAdvancesAnswer,
          bonusAnswers: currentBonusAnswers,
        }),
      });

      if (!res.ok) throw new Error(res.error);

      // Update server state (just this pick)
      setServerPicks(prev => {
        const savedPick = res.picks.find((p: any) => p.matchId === matchId);
        return {
          ...prev,
          [matchId]: savedPick
            ? {
                ...savedPick,
                goalscorerPick: currentGoalscorerPick,
              }
            : {
                ...(prev[matchId] || {}),
                goalscorerPick: currentGoalscorerPick,
              }
        };
      });

      if (res.newAchievements?.length > 0) {
        triggerAchievementToast(res.newAchievements);
      }

    } catch (e: any) {
      setErr(e.message);
      throw e;
    } finally {
      setIsSaving(false);
    }
  };

  const handleGoalscorerSelect = async (matchId: string, playerId: string, playerName: string) => {
    if (!initData) return;
    if (seasonState && !seasonState.predictionsOpen) {
      setErr("Сезон закрыт. Приём прогнозов остановлен.");
      return;
    }
    setIsSaving(true);
    try {
      const res = await apiFetch<any>("/picks/goalscorer", {
        method: "PUT",
        body: JSON.stringify({
          initData,
          matchId,
          playerId,
          playerName
        }),
      });
      if (!res.ok) throw new Error(res.error || "Не удалось сохранить");

      setPicks(prev => {
        const p = prev[matchId] || { matchId, home: 0, away: 0, isJoker: false, updatedAt: new Date().toISOString() };
        return {
          ...prev,
          [matchId]: {
            ...p,
            goalscorerPick: { playerId, playerName }
          }
        };
      });

      if (res.newAchievements?.length > 0) {
        triggerAchievementToast(res.newAchievements);
      }
      setInfo("Выбор автора гола сохранён");
      setTimeout(() => setInfo(""), 2000);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Impl handleJoker
  const handleJoker = async (matchId: string) => {
    if (!initData) return;
    if (seasonState && !seasonState.predictionsOpen) {
      setErr("Сезон закрыт. Джокер недоступен.");
      return;
    }
    const p = picks[matchId];
    if (!p) {
      setErr("Сначала сделай прогноз, потом ставь джокера");
      setTimeout(() => setErr(null), 2000);
      return;
    }

    // Toggle: if this match already has joker, remove it
    const isCurrentlyJoker = jokerMatchId === matchId || p.isJoker;

    setIsSaving(true);
    if (!isCurrentlyJoker) {
      setJokerMatchId(matchId); // optimistic
    } else {
      setJokerMatchId(null); // optimistic
    }

    try {
      if (!isCurrentlyJoker) {
        const res = await apiFetch<any>("/joker", {
          method: "POST",
          // keepalive: игрок ставит джокера и тут же сворачивает приложение —
          // без этого браузер обрывает незавершённый запрос, и джокер пропадает.
          keepalive: true,
          body: JSON.stringify({
            initData,
            day: selectedDate,
            matchId,
            home: p.home,
            away: p.away,
          }),
        });

        if (!res.ok) throw new Error(res.error);

        const map: Record<string, Pick> = {};
        let jId = null;
        (res.picks || []).forEach((pp: any) => {
          map[pp.matchId] = pp;
          if (pp.isJoker) jId = pp.matchId;
        });
        setServerPicks(map);
        // Локальный пик тоже помечаем: часть карточек читает isJoker прямо из
        // него, и без этого значок появлялся только после перезагрузки экрана.
        setPicks(prev => {
          const next = { ...prev };
          for (const mid of Object.keys(next)) {
            next[mid] = { ...next[mid], isJoker: Boolean(map[mid]?.isJoker) };
          }
          return next;
        });
        setJokerMatchId(jId);

        await loadBoosts();

        if (res.newAchievements?.length > 0) {
          triggerAchievementToast(res.newAchievements);
        }
      } else {
        const res = await apiFetch<any>("/pick", {
          method: "POST",
          body: JSON.stringify({
            initData,
            day: selectedDate,
            matchId,
            home: p.home,
            away: p.away,
            joker: false,
          }),
        });

        if (!res.ok) throw new Error(res.error);

        const map: Record<string, Pick> = {};
        let jId = null;
        (res.picks || []).forEach((pp: any) => {
          map[pp.matchId] = pp;
          if (pp.isJoker) jId = pp.matchId;
        });
        setServerPicks(map);
        setPicks(prev => {
          const next = { ...prev };
          if (next[matchId]) next[matchId] = { ...next[matchId], isJoker: false };
          return next;
        });
        setJokerMatchId(jId);
      }
    } catch (e: any) {
      setErr(e.message);
      if (!isCurrentlyJoker) {
        setJokerMatchId(serverPicks[matchId]?.isJoker ? matchId : null);
      } else {
        setJokerMatchId(matchId);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const onSetJoker = (mid: string) => {
    handleJoker(mid);
  };

  const onAdminSetResult = (mid: string, home: number, away: number) => {
    setResults(prev => ({
      ...prev,
      [mid]: { ...prev[mid], matchId: mid, home, away }
    }));
  };
  const onAdminSaveResult = async (mid: string) => {
    const r = results[mid];
    if (!r) return;
    try {
      await apiFetch("/admin/result", {
        method: "POST",
        headers: { "x-telegram-init-data": initData },
        body: JSON.stringify({
          matchId: mid,
          home: r.home,
          away: r.away
        })
      });
      alert("Результат сохранён");
    } catch (e: any) {
      alert(e.message);
    }
  };

  // Calculate points map...
  const pointsMap = useMemo(() => {
    const map: Record<string, any> = {};
    matches.forEach(m => {
      const p = picks[m.id];
      const r = results[m.id];

      if (p && r && r.finalAt) {
        let base = 0; let reason = "miss";
        const npH = Number(p.home); const npA = Number(p.away);
        const nrH = Number(r.home); const nrA = Number(r.away);

        if (npH === nrH && npA === nrA) { base = 5; reason = "exact"; }
        else if (npH - npA === nrH - nrA && nrH !== nrA && npH !== npA) { base = 3; reason = "diff"; }
        else {
          const oP = npH === npA ? 0 : (npH > npA ? 1 : -1);
          const oR = nrH === nrA ? 0 : (nrH > nrA ? 1 : -1);
          if (oP === oR) { base = 2; reason = "outcome"; }
        }

        const mult = p.isJoker ? 2 : 1;
        let total = base * mult;
        let bonus = 0;

        if (base === 0 && !p.isJoker && dayBoostUsage?.boost_type === 'double_chance' && dayBoostUsage?.match_id === m.id && dayBoostUsage?.dc_variant) {
          const oR = nrH === nrA ? 0 : (nrH > nrA ? 1 : -1);
          const variant = dayBoostUsage.dc_variant;
          let hit = false;
          if (variant === '1X') hit = oR === 1 || oR === 0;
          if (variant === 'X2') hit = oR === 0 || oR === -1;
          if (variant === '12') hit = oR === 1 || oR === -1;

          if (hit) {
            total = 2;
            reason = "double_chance";
          }
        }

        // Bonus questions (incl. advances_team) reward STARS only, never match
        // points (2026-06-26). The displayed day total is match-result points
        // only; bonus-question star rewards are shown separately in the match
        // questions UI. `bonus` stays 0 here to keep this preview in sync with
        // the server's scores_agg.

        map[m.id] = { total, base, mult, reason, bonus };
      }
    });
    return map;
  }, [matches, results, picks, dayBoostUsage]);

  const weeklyClaimable = useWeeklyClaimableCount();
  const seasonClaimable = useSeasonTaskClaimableCount();
  const questsClaimable = weeklyClaimable + seasonClaimable;
  // HUD count is weekly-challenge + season claimables — route the tap to whichever
  // category actually holds unclaimed rewards (weekly wins ties), never to "daily"
  // where these rewards don't live.
  const claimableTargetTab: "weekly_challenge" | "season" = weeklyClaimable > 0 ? "weekly_challenge" : "season";
  // Unopened cases (daily free + premium) — the bar only shows when the shop and its
  // "Фортуна" subsection, where cases are actually opened, are both visible.
  const unopenedCases = myCases.reduce((n, c) => n + Math.max(0, Number(c.quantity) || 0), 0);
  const casesBarVisible = unopenedCases > 0 && sectionVisible("shop") && subsectionVisible(SHOP_TAB_SUBSECTION_KEY.luck);
  // Плашка ведёт на вкладку «Партнёрские», поэтому гаснет вместе с ней: и когда
  // закрыт весь раздел заданий, и когда админка спрятала саму вкладку.
  const partnerPromoVisible = Boolean(partnerPromo)
    && sectionVisible("quests")
    && subsectionVisible(TASK_TAB_SUBSECTION_KEY.partner);

  const openCasesInShop = () => {
    setShopInitialTab("luck");
    navigateAppSection("shop");
  };

  // Верхний ряд — то, что уже начислено и ждёт нажатия, со счётчиком.
  const homeClaims: HomeClaim[] = [];
  if (questsClaimable > 0) {
    homeClaims.push({
      key: "rewards",
      icon: "game_star",
      label: "Награды",
      action: "Забрать",
      count: questsClaimable,
      onClick: () => openTasks(claimableTargetTab),
    });
  }
  if (casesBarVisible) {
    homeClaims.push({
      key: "cases",
      icon: "case_basic",
      label: "Кейсы",
      action: "Открыть",
      count: unopenedCases,
      onClick: openCasesInShop,
    });
  }

  // Нижняя полоса — предложения: их ещё нужно выполнить, счётчика тут нет.
  const homeBonuses: HomeBonus[] = [];
  if (partnerPromoVisible && partnerPromo) {
    homeBonuses.push({
      key: "partner",
      icon: partnerPromoIcon(partnerPromo),
      label: partnerPromoLabel(partnerPromo),
      // «+10» с иконкой мяча вместо «+10 мячей»: в узкую полосу влезают обе подписи.
      reward: partnerPromo.reward.type === "balls" ? `+${partnerPromo.reward.amount}` : `+${partnerPromo.reward.label}`,
      rewardIcon: partnerPromo.reward.type === "balls" ? "ball" : undefined,
      onClick: () => openTasks("partner"),
    });
  }
  homeBonuses.push({
    key: "referral",
    icon: "share_invite",
    label: "Позвать друга",
    hint: "тебе кейс, другу жетон",
    onClick: () => {
      const uid = Number((window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { id?: number } } } } }).Telegram?.WebApp?.initDataUnsafe?.user?.id || me?.id || 0);
      const link = buildClientReferralLink(uid);
      if (link) openReferralShare(link);
    },
  });

  const menuItems: Array<{ section: MenuSection; label: string; icon?: string; adminOnly?: boolean; accent?: boolean }> = [
    { section: "home", label: "Главная", icon: "⌂", accent: activeTab === "home" && showCoreSection },
    { section: "matches", label: "Матчи дня", accent: activeTab === "matches" && showCoreSection },
    { section: "seasonPredictions", label: "Прогнозы сезона", accent: activeTab === "seasonPredictions" && showCoreSection },
    { section: "weeklyChallenge", label: "Вызов недели", accent: activeTab === "weeklyChallenge" && showCoreSection },
    { section: "league", label: "Лиги", accent: activeTab === "league" && showCoreSection },
    { section: "rating", label: "Рейтинг", accent: activeTab === "rating" && showCoreSection },
    { section: "quests", label: "Задания", accent: showAchievements },
    { section: "shop", label: "Магазин", accent: showShop },
    { section: "profile", label: "Профиль", accent: showProfile },
    { section: "rules", label: "Информация", icon: "i" },
    { section: "admin", label: "Админ-панель", icon: "⚙", adminOnly: true },
  ];


  return (
    <main ref={appShellRef} className="sg-app-shell" style={{
      padding: "0 0 calc(42px + env(safe-area-inset-bottom, 0px)) 0",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      maxWidth: 600,
      margin: "0 auto",
      height: "var(--sg-viewport-height, 100dvh)",
      minHeight: 0,
      overflowY: "auto",
      overscrollBehaviorY: "contain",
      WebkitOverflowScrolling: "touch",
      position: "relative",
      background: "var(--tg-secondary-bg)"
    }}
    onTouchStart={handleTouchStart}
    onTouchMove={handleTouchMove}
    onTouchEnd={handleTouchEnd}
    >
      <AchievementToast />

      {/* Maintenance Screen */}
      {showMaintenance && (
        <MaintenanceScreen
          message={maintenanceData.message}
          image={maintenanceData.image}
          countdownTo={maintenanceData.countdownTo}
          onRefresh={() => {
            apiFetch<any>('/maintenance/status')
              .then(res => {
                if (!res.maintenance) {
                  setShowMaintenance(false);
                  window.location.reload();
                }
              })
              .catch(() => { });
          }}
        />
      )}

      {/* Overlays */}
      {initData && viewUserKey && (
        <UserProfileScreen profileKey={viewUserKey} onClose={() => setViewUserKey(null)} />
      )}

      {/* App Header */}
      <div style={{
        position: "sticky",
        top: 0,
        zIndex: 42,
        display: "grid",
        gridTemplateColumns: "44px 1fr auto",
        alignItems: "center",
        gap: 8,
        padding: "12px 14px 8px",
        background: "color-mix(in srgb, var(--tg-secondary-bg) 88%, transparent)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        color: "var(--tg-text)",
      }}>
        <button type="button" onClick={() => setMenuOpen(true)} aria-label="Открыть меню" style={{ width: 40, height: 40, border: "none", borderRadius: 14, background: "var(--tg-bg)", color: "var(--tg-text)", fontSize: 25, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>☰</button>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0 }}>
          <BrandLogo width={70} height={34} />
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>
          <button onClick={() => { setShowProfile(false); setShowAchievements(false); setShowShop(true); }} style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--tg-bg)", border: "none", borderRadius: 16, padding: "4px 10px", cursor: "pointer", color: "var(--tg-text)", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
            <AppIcon name="ball" size={22} loading="eager" />
            <span style={{ fontSize: 13, fontWeight: 800 }}>{headerBalls}</span>
          </button>
          <button onClick={() => { setShowAchievements(false); setShowShop(false); setShowProfile(true); }} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 0 }}>
            <UserAvatar photoUrl={headerProfile?.photoUrl || null} name={headerProfile?.displayName || "Игрок"} size={32} />
          </button>
          {isAdmin && showCoreSection && activeTab === "matches" && (
            <button
              onClick={() => loadData(seasonState?.predictionsOpen !== false)}
              title="Обновить результаты"
              aria-label="Обновить результаты"
              style={{ background: "var(--tg-bg)", color: "var(--tg-text)", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}
            >
              ↻
            </button>
          )}
          {isAdmin && (
            <button onClick={() => window.location.href = "/admin"} style={{ background: "var(--tg-bg)", color: "var(--tg-text)", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>⚙</button>
          )}
        </div>
      </div>

      <div style={{ 
        position: "fixed", inset: 0, zIndex: 120, display: "flex",
        pointerEvents: menuOpen ? "auto" : "none",
        visibility: menuOpen ? "visible" : "hidden",
        transition: "visibility 0.3s"
      }}>
        <button type="button" aria-label="Закрыть меню" onClick={() => setMenuOpen(false)} style={{ 
          flex: 1, border: "none", background: "rgba(0,0,0,0.48)", cursor: "pointer",
          opacity: menuOpen ? 1 : 0, transition: "opacity 0.3s ease" 
        }} />
        <aside style={{ 
          order: -1, width: "min(82vw, 360px)", height: "100%", padding: "22px 18px calc(22px + env(safe-area-inset-bottom, 0px))", 
          background: "var(--tg-secondary-bg)", color: "var(--tg-text)", boxShadow: "18px 0 48px rgba(0,0,0,0.28)", 
          overflowY: "auto", WebkitOverflowScrolling: "touch",
          transform: menuOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 28 }}>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.03em", flexShrink: 0 }}>Меню</div>
            <BrandLogo width={66} height={32} />
            <button type="button" onClick={() => setMenuOpen(false)} style={{ width: 36, height: 36, borderRadius: 18, border: "none", background: "var(--tg-bg)", color: "var(--tg-text)", fontSize: 18, cursor: "pointer", flexShrink: 0 }}>×</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {menuItems.filter(item => (!item.adminOnly || isAdmin) && sectionVisible(item.section)).map((item) => {
              const appIcon = MENU_APP_ICONS[item.section];
              return (
              <button key={item.section} type="button" onClick={() => navigateAppSection(item.section)} style={{ minHeight: 54, border: "none", borderRadius: 16, background: item.accent ? "color-mix(in srgb, var(--tg-button) 12%, transparent)" : "transparent", color: item.accent ? "var(--tg-button)" : "var(--tg-text)", display: "grid", gridTemplateColumns: "40px 1fr", alignItems: "center", gap: 15, padding: "0 12px", textAlign: "left", fontSize: 17, fontWeight: 850, cursor: "pointer" }}>
                <span style={{ width: 40, height: 40, display: "inline-flex", alignItems: "center", justifyContent: "center", color: item.accent ? "var(--tg-button)" : "var(--tg-hint)", textAlign: "center", flexShrink: 0 }}>
                  {appIcon ? <AppIcon name={appIcon} size={32} /> : <span style={{ fontSize: 21, lineHeight: 1 }}>{item.icon}</span>}
                </span>
                <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span>{item.label}</span>
                  {item.section === "quests" && <CountBadge count={questsClaimable} />}
                  {item.section === "shop" && <CountBadge count={casesBarVisible ? unopenedCases : 0} />}
                </span>
              </button>
              );
            })}
          </div>
          <button onClick={() => {
            setMenuOpen(false);
            // @ts-ignore — personal referral link, falls back to the plain bot link
            const uid = Number(window.Telegram?.WebApp?.initDataUnsafe?.user?.id || me?.id || 0);
            const link = buildClientReferralLink(uid) || "https://t.me/scoregameee_Bot";
            openReferralShare(link);
          }} style={{ marginTop: 24, width: "100%", minHeight: 48, borderRadius: 16, border: "1px solid color-mix(in srgb, var(--tg-button) 26%, transparent)", background: "color-mix(in srgb, var(--tg-button) 12%, transparent)", color: "var(--tg-button)", fontSize: 15, fontWeight: 850, cursor: "pointer" }}>Пригласить друга</button>
        </aside>
      </div>

      {showCoreSection && activeTab === "home" && (
        <div style={{ padding: "6px 16px 0", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Короткие действия одним списком тонких строк: прежние двухстрочные
              полосы отжимали матчи дня под сгиб экрана. */}
          <HomeActionBoard claims={homeClaims} bonuses={homeBonuses} />

          {matchesLoading ? (
            <section style={{ position: "relative", overflow: "hidden", minHeight: 176, borderRadius: 26, padding: 22, color: "var(--tg-text)", background: "var(--tg-bg)", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 16px 34px rgba(0,0,0,0.14)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: 28, animation: "spin 1s linear infinite" }}>⏳</div>
            </section>
          ) : matches.length > 0 ? (
            <div style={{ margin: "0 -16px" }}>
              <div style={{ marginBottom: 12, padding: "0 20px" }}>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, letterSpacing: "-0.03em", color: "var(--tg-text)" }}>Матчи дня</h1>
              </div>
              <div className="sg-hide-scrollbar" style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8, padding: "0 16px 8px", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}>
                {matches.map(m => {
                  const d = new Date(m.startTime);
                  // Date and time must share one timezone: getDate() is device-local and can
                  // drift a day from the MSK clock time around midnight.
                  const dateMsk = d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
                  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
                  const timeStr = `${dateMsk} в ${time} МСК`;
                  const mid = String(m.id);
                  const result = results[mid];
                  const status = String(m.status || "").toUpperCase();
                  const started = Date.now() >= new Date(m.startTime).getTime();
                  const finished = !!result?.finalAt || ["FINISHED", "AWARDED", "FT", "FULL_TIME"].includes(status);
                  const live = !finished && (started || ["IN_PLAY", "PAUSED", "LIVE", "HT"].includes(status));
                  const scoreText = finished && result ? `${result.home}:${result.away}` : "-";
                  const localPick = picks[mid];
                  const savedPick = serverPicks[mid];
                  const localPickWasSaved = typeof localPick?.updatedAt === "string" && localPick.updatedAt.trim().length > 0;
                  const myPick = savedPick ? (localPick || savedPick) : localPickWasSaved ? localPick : undefined;
                  const hasPrediction = !!myPick;
                  const actionLabel = finished ? "Посмотреть результаты" : live ? "Посмотреть прогноз" : hasPrediction ? "Изменить прогноз" : "Сделать прогноз";

                  // Personal stake: the user's own prediction + points once finished.
                  // Reuse the authoritative pointsMap so boosts (joker ×2, double chance) and bonus questions are included.
                  const pointsInfo = finished && myPick && result ? pointsMap[m.id] : null;
                  const pickPoints: number | null = pointsInfo ? Number(pointsInfo.total) : null;
                  const dcApplied = dayBoostUsage?.boost_type === 'double_chance' && dayBoostUsage?.match_id === m.id;
                  const dcTriggered = pointsInfo?.reason === "double_chance";
                  const dcMissed = !!(finished && dcApplied && !dcTriggered);
                  const pointsTone = pickPoints == null ? null : pickPoints >= 5 ? "#34c759" : pickPoints >= 2 ? "var(--tg-button)" : "var(--tg-hint)";
                  // Countdown to the prediction deadline (only while intake is open and < 24h left)
                  const unlockMs = m.unlockTime ? new Date(m.unlockTime).getTime() : 0;
                  const lockMs = new Date(m.lockTime).getTime();
                  const lockLeftMs = !finished && !live && nowMs >= unlockMs && nowMs < lockMs ? lockMs - nowMs : null;
                  const showLockCountdown = lockLeftMs != null && lockLeftMs < 24 * 3600000;

                  return (
                    <Pressable key={m.id} haptic="selection" onClick={() => openMatchInPredictions(mid)} style={{
                      fontFamily: "inherit",
                      textAlign: "center",
                      scrollSnapAlign: "center",
                      flex: matches.length === 1 ? "0 0 100%" : "0 0 85%",
                      position: "relative",
                      overflow: "hidden",
                      minHeight: 152,
                      borderRadius: 24,
                      padding: 16,
                      cursor: "pointer",
                      color: "var(--tg-text)",
                      background: "radial-gradient(circle at 18% 0%, color-mix(in srgb, var(--tg-button) 28%, transparent), transparent 34%), linear-gradient(135deg, var(--tg-bg), color-mix(in srgb, var(--tg-bg) 72%, var(--tg-button)))",
                      border: "1px solid rgba(255,255,255,0.06)",
                      boxShadow: "0 16px 34px rgba(0,0,0,0.14)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "space-between"
                    }}>
                      <div style={{ position: "absolute", inset: 0, opacity: 0.08, backgroundImage: "linear-gradient(120deg, transparent 0 42%, var(--tg-button) 43%, transparent 44%), linear-gradient(40deg, transparent 0 58%, var(--tg-button) 59%, transparent 60%)", pointerEvents: "none" }} />
                      
                      <div style={{ position: "relative", zIndex: 1, fontSize: 13, fontWeight: 700, color: "var(--tg-text)", opacity: 0.8, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                        <span>{finished ? "Завершён" : live ? "Матч идёт" : timeStr}</span>
                        {live && (
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#34c759", boxShadow: "0 0 0 4px rgba(52,199,89,0.18)" }} />
                        )}
                        {showLockCountdown && (
                          <span style={{
                            padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 900,
                            color: lockLeftMs! < 3600000 ? "#ff9500" : "var(--tg-button)",
                            background: `color-mix(in srgb, ${lockLeftMs! < 3600000 ? "#ff9500" : "var(--tg-button)"} 14%, transparent)`,
                          }}>
                            до закрытия {formatTimeLeft(lockLeftMs!)}
                          </span>
                        )}
                      </div>
                      
                      <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 16, width: "100%", justifyContent: "center", marginBottom: 14 }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                          {m.homeCrest ? (
                            <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(255,255,255,0.9)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
                              <img src={m.homeCrest} width={32} height={32} style={{ objectFit: "contain" }} alt={m.home} />
                            </div>
                          ) : (
                            <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>⚽</div>
                          )}
                          <div style={{ fontSize: 14, fontWeight: 700, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", width: "100%", whiteSpace: "nowrap" }}>{m.home}</div>
                        </div>
                        
                        <div style={{ fontSize: finished ? 26 : 24, fontWeight: 950, color: "var(--tg-text)", opacity: finished ? 1 : 0.5, flexShrink: 0, paddingBottom: 24, minWidth: finished ? 58 : "auto", textAlign: "center" }}>{scoreText}</div>
                        
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                          {m.awayCrest ? (
                            <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(255,255,255,0.9)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
                              <img src={m.awayCrest} width={32} height={32} style={{ objectFit: "contain" }} alt={m.away} />
                            </div>
                          ) : (
                            <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>⚽</div>
                          )}
                          <div style={{ fontSize: 14, fontWeight: 700, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", width: "100%", whiteSpace: "nowrap" }}>{m.away}</div>
                        </div>
                      </div>
                      
                      {/* Personal stake row: the user's own prediction (and points once finished) */}
                      {myPick && (
                        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 12, fontSize: 13, fontWeight: 800 }}>
                          <span style={{ color: "var(--tg-hint)" }}>Твой прогноз</span>
                          <span style={{ color: "var(--tg-text)" }}>{myPick.home}:{myPick.away}</span>
                          {myPick.isJoker && (
                            <span title="Джокер" style={{ display: "inline-flex", alignItems: "center" }}>
                              <AppIcon name="joker" size={18} />
                            </span>
                          )}
                          {dcApplied && (
                            <span
                              title={dcTriggered ? "Двойной шанс сработал" : dcMissed ? "Двойной шанс не сыграл" : "Двойной шанс"}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 4,
                                padding: "2px 8px 2px 6px", borderRadius: 999, fontWeight: 900, fontSize: 11,
                                color: dcTriggered ? "#34c759" : dcMissed ? "var(--tg-hint)" : "#007aff",
                                background: dcTriggered ? "rgba(52,199,89,0.16)" : dcMissed ? "rgba(128,128,128,0.12)" : "rgba(0,122,255,0.12)",
                                border: `1px solid ${dcTriggered ? "rgba(52,199,89,0.42)" : dcMissed ? "rgba(128,128,128,0.25)" : "rgba(0,122,255,0.28)"}`,
                                opacity: dcMissed ? 0.7 : 1,
                              }}
                            >
                              <AppIcon name="double_chance" size={16} />
                              {dayBoostUsage?.dc_variant || "1X2"}
                              {dcTriggered && <span style={{ fontSize: 11 }}>✓</span>}
                            </span>
                          )}
                          {pickPoints != null && (
                            <span style={{
                              padding: "2px 8px", borderRadius: 999, fontWeight: 900, fontSize: 12,
                              color: pointsTone || "var(--tg-hint)",
                              background: `color-mix(in srgb, ${pointsTone || "var(--tg-hint)"} 14%, transparent)`,
                              border: `1px solid color-mix(in srgb, ${pointsTone || "var(--tg-hint)"} 28%, transparent)`,
                            }}>
                              {pickPoints > 0 ? `+${pickPoints}` : "0"}
                            </span>
                          )}
                        </div>
                      )}

                      <div
                        style={{
                          position: "relative",
                          zIndex: 1,
                          minHeight: 44,
                          width: "100%",
                          borderRadius: 999,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "var(--tg-button)",
                          color: "var(--tg-button-text)",
                          fontSize: 15,
                          fontWeight: 900,
                          boxShadow: "0 4px 12px color-mix(in srgb, var(--tg-button) 40%, transparent)"
                        }}
                      >
                        {actionLabel}
                      </div>
                    </Pressable>
                  );
                })}
              </div>
            </div>
          ) : nextDay && nextMatches.length > 0 ? (
            /* Empty day — show the nearest matchday instead of a blank card.
               One button for the whole card, like the "нет матчей" variant below. */
            <button type="button" onClick={() => { setSelectedDate(nextDay); navigateAppSection("matches"); }} style={{ display: "block", width: "100%", textAlign: "left", fontFamily: "inherit", cursor: "pointer", position: "relative", overflow: "hidden", borderRadius: 20, padding: 16, color: "var(--tg-text)", background: "radial-gradient(circle at 18% 0%, color-mix(in srgb, var(--tg-button) 28%, transparent), transparent 34%), linear-gradient(135deg, var(--tg-bg), color-mix(in srgb, var(--tg-bg) 72%, var(--tg-button)))", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 16px 34px rgba(0,0,0,0.14)" }}>
              <div style={{ position: "absolute", inset: 0, opacity: 0.08, backgroundImage: "linear-gradient(120deg, transparent 0 42%, var(--tg-button) 43%, transparent 44%), linear-gradient(40deg, transparent 0 58%, var(--tg-button) 59%, transparent 60%)" }} />
              <div style={{ position: "relative", display: "flex", flexDirection: "column" }}>
                <h1 style={{ margin: 0, fontSize: 19, lineHeight: 1.1, letterSpacing: "-0.03em", fontWeight: 950 }}>Ближайшие матчи</h1>
                <p style={{ margin: "6px 0 12px", fontSize: 13, lineHeight: 1.4, color: "var(--tg-hint)", fontWeight: 600 }}>
                  Сегодня матчей нет — играем {formatUpcomingDayLabel(nextDay)}
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                  {nextMatches.slice(0, 3).map(m => {
                    const time = new Date(m.startTime).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
                    return (
                      /* Both crests on the left so long club names get the full
                         width and wrap onto a second line instead of clipping. */
                      <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 14, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                          {m.homeCrest ? (
                            <img src={m.homeCrest} width={18} height={18} style={{ objectFit: "contain" }} alt={m.home} />
                          ) : (
                            <span style={{ fontSize: 14 }}>⚽</span>
                          )}
                          {m.awayCrest ? (
                            <img src={m.awayCrest} width={18} height={18} style={{ objectFit: "contain" }} alt={m.away} />
                          ) : (
                            <span style={{ fontSize: 14 }}>⚽</span>
                          )}
                        </div>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, lineHeight: 1.25, overflowWrap: "anywhere" }}>
                          {m.home} — {m.away}
                        </span>
                        <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 800, color: "var(--tg-hint)" }}>{time}</span>
                      </div>
                    );
                  })}
                </div>

                <span style={{ minHeight: 38, display: "inline-flex", alignItems: "center", borderRadius: 999, padding: "0 16px", background: "var(--tg-button)", color: "var(--tg-button-text)", fontSize: 14, fontWeight: 900, alignSelf: "flex-start" }}>
                  Сделать прогноз
                </span>
              </div>
            </button>
          ) : (
            <button type="button" onClick={() => navigateAppSection("matches")} style={{ display: "block", width: "100%", textAlign: "left", fontFamily: "inherit", cursor: "pointer", position: "relative", overflow: "hidden", borderRadius: 20, padding: 16, color: "var(--tg-text)", background: "radial-gradient(circle at 18% 0%, color-mix(in srgb, var(--tg-button) 28%, transparent), transparent 34%), linear-gradient(135deg, var(--tg-bg), color-mix(in srgb, var(--tg-bg) 72%, var(--tg-button)))", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 16px 34px rgba(0,0,0,0.14)" }}>
              {/* Whole card is one button (same mechanics as the weekly-challenge card); the inner pill is decorative */}
              <div style={{ position: "absolute", inset: 0, opacity: 0.08, backgroundImage: "linear-gradient(120deg, transparent 0 42%, var(--tg-button) 43%, transparent 44%), linear-gradient(40deg, transparent 0 58%, var(--tg-button) 59%, transparent 60%)" }} />
              <div style={{ position: "relative", display: "flex", flexDirection: "column" }}>
                <h1 style={{ margin: 0, fontSize: 19, lineHeight: 1.1, letterSpacing: "-0.03em", fontWeight: 950 }}>Матчи дня</h1>
                <p style={{ margin: "6px 0 12px", maxWidth: 310, fontSize: 13, lineHeight: 1.4, color: "var(--tg-hint)", fontWeight: 600 }}>Сегодня матчей нет. Посмотри расписание на другие дни.</p>
                <span style={{ minHeight: 38, display: "inline-flex", alignItems: "center", borderRadius: 999, padding: "0 16px", background: "var(--tg-button)", color: "var(--tg-button-text)", fontSize: 14, fontWeight: 900, alignSelf: "flex-start" }}>
                  Перейти к расписанию
                </span>
              </div>
            </button>
          )}

          {/* Вызов недели — under "Матчи дня", links into the mode */}
          {sectionVisible("weeklyChallenge") && (
            <HomeWeeklyChallengeCard initData={initData} nowMs={nowMs} onOpen={() => navigateAppSection("weeklyChallenge")} />
          )}

          {/* Прогнозы сезона — phase-aware card (лиги → еврокубки → компакт); deep-links to the tab with the current action */}
          {sectionVisible("seasonPredictions") && (
            <HomeSeasonPredictionsCard
              initData={initData}
              nowMs={nowMs}
              onOpen={(tab) => navigateAppSection("seasonPredictions", { seasonTab: tab })}
            />
          )}

          {initData && sectionVisible("league") && (
            <HomeLeaguesCarousel
              initData={initData}
              me={me}
              flagsReady={flagsGateReady}
              lazyLoadV2={homeLeaguesLazyLoadV2}
              onOpenLeague={(id) => { setSelectedLeagueId(id); setShowLeagueScreen(true); navigateAppSection("league"); }}
              onOpenLeaguesTab={() => navigateAppSection("league")}
            />
          )}

          {initData && sectionVisible("rating") && (
            <HomeRatingCarousel
              currentDay={selectedDate}
              me={me}
              flagsReady={flagsGateReady}
              dedupeV2={homeRatingDedupeV2}
              onOpenRating={() => navigateAppSection("rating")}
            />
          )}

        </div>
      )}

      {showCoreSection && activeTab === "matches" && <DateSelector value={selectedDate} onChange={setSelectedDate} />}

      {showCoreSection && activeTab === "matches" && showBotPmCta && (
        <div style={{ padding: "0 16px", marginBottom: 10 }}>
          <div
            style={{
              background: "var(--tg-bg)",
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.06)",
              boxShadow: "0 10px 24px rgba(0,0,0,0.12)",
              padding: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "var(--tg-text)", marginBottom: 6 }}>
                  Напомнить про матчи?
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.45, color: "var(--tg-hint)" }}>
                  Пришлём напоминание, когда откроются прогнозы и когда матч вот-вот начнётся, а вечером — сколько очков ты набрал.
                </div>
              </div>
              <button
                type="button"
                onClick={dismissBotPmCta}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--tg-hint)",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  lineHeight: 1,
                  padding: "4px 2px",
                  whiteSpace: "nowrap",
                }}
                aria-label="Напомнить позже"
              >
                Позже
              </button>
            </div>

            {botPmNotice && (
              <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.4, color: "var(--tg-hint)" }}>
                {botPmNotice}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button
                type="button"
                onClick={() => handleEnableBotMessages()}
                disabled={botPmBusy}
                style={{
                  flex: 1,
                  minHeight: 42,
                  borderRadius: 12,
                  border: "none",
                  background: "var(--tg-button)",
                  color: "var(--tg-button-text)",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: botPmBusy ? "default" : "pointer",
                  opacity: botPmBusy ? 0.7 : 1,
                }}
              >
                {botPmBusy ? "Запрашиваем доступ…" : "Включить напоминания"}
              </button>
              <button
                type="button"
                onClick={openBotChat}
                style={{
                  minWidth: 108,
                  minHeight: 42,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "var(--tg-secondary-bg)",
                  color: "var(--tg-text)",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Открыть бота
              </button>
            </div>
          </div>
        </div>
      )}

      {info && <div style={{ marginBottom: 10, padding: "0 16px", color: "#34c759", fontWeight: "700", textAlign: "center" }}>{info}</div>}
      {err && <div style={{ marginBottom: 10, padding: "0 16px", color: "var(--tg-destructive)", textAlign: "center" }}>{err}</div>}

      {showCoreSection && activeTab === "matches" && matches.length === 0 && matchesLoading && (
        <div style={{ margin: "20px 16px", padding: 32, textAlign: "center", background: "var(--tg-bg)", borderRadius: 16 }}>
          <div style={{ fontSize: 28, marginBottom: 8, animation: "spin 1s linear infinite" }}>⏳</div>
          <div style={{ opacity: 0.6 }}>Загрузка матчей…</div>
        </div>
      )}

      {showCoreSection && activeTab === "matches" && matches.length === 0 && !matchesLoading && dayLoadError && (
        <div style={{ margin: "20px 16px", padding: 32, textAlign: "center", background: "var(--tg-bg)", borderRadius: 16 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📡</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "var(--tg-text)", marginBottom: 6 }}>Не удалось загрузить матчи</div>
          <div style={{ fontSize: 14, color: "var(--tg-hint)", marginBottom: 16 }}>Проверь соединение и попробуй ещё раз.</div>
          <button
            type="button"
            onClick={() => loadData()}
            style={{ padding: "10px 24px", background: "var(--tg-button)", color: "var(--tg-button-text)", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer" }}
          >
            Повторить
          </button>
        </div>
      )}

      {showCoreSection && activeTab === "matches" && matches.length === 0 && !matchesLoading && !dayLoadError && matchesLoadedOnce && seasonState?.predictionsOpen !== false && (
        <NoMatchdayState
          selectedDate={selectedDate}
          onGoToday={() => setSelectedDate(new Date().toISOString().split("T")[0])}
          nextDay={nextDay}
          onGoNextDay={nextDay ? () => setSelectedDate(nextDay) : undefined}
        />
      )}

      {showCoreSection && activeTab === "matches" && matches.length === 0 && !matchesLoading && !dayLoadError && matchesLoadedOnce && !seasonState?.predictionsOpen && ["finished", "finalizing", "archived", "upcoming"].includes(seasonState?.status || "") && (
        !seasonState?.predictionsOpen && ["finished", "finalizing", "archived", "upcoming"].includes(seasonState?.status || "") ? (
          <OffSeasonState nextStartsAt={seasonState?.nextUpcoming?.startsAt || null} />
        ) : (
          <div style={{ margin: "20px 16px", padding: 32, textAlign: "center", background: "var(--tg-bg)", borderRadius: 16 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>📭</div>
            <div style={{ opacity: 0.6 }}>Матчей нет</div>
            <button onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])} style={{ marginTop: 16, padding: "8px 16px", background: "var(--tg-button)", color: "var(--tg-button-text)", border: "none", borderRadius: 8 }}>На сегодня</button>
          </div>
        )
      )}

      {showCoreSection && activeTab === "matches" && (
        <div style={{ padding: "0 16px" }}>
          {matches.length > 0 && seasonState?.predictionsOpen !== false && (
            <>
              {/* Boost Balance Block (Ultra-Compact) */}
              {(() => {
                const ejCount = availableBoosts?.filter(b => b.type === 'extra_joker').length || 0;
                const dcCount = availableBoosts?.filter(b => b.type === 'double_chance').length || 0;

                const ejUsed = dayBoostUsage?.boost_type === 'extra_joker';
                const dcUsed = dayBoostUsage?.boost_type === 'double_chance';

                const getStatus = (count: number, isUsed: boolean, isOtherUsed: boolean) => {
                  if (isUsed) return 'active';
                  if (isOtherUsed) return 'blocked';
                  if (count > 0) return 'available';
                  return 'empty';
                };

                const ejStatus = getStatus(ejCount, ejUsed, dcUsed);
                const dcStatus = getStatus(dcCount, dcUsed, ejUsed);

                const renderBadge = (icon: "joker" | "double_chance", name: string, count: number, status: string) => {
                  let statusText = '';
                  if (status === 'active') statusText = 'Активен';
                  else if (status === 'blocked') statusText = 'Недоступен';
                  else statusText = `x${count}`;

                  const opacity = (status === 'empty' || status === 'blocked') ? 0.5 : 1;

                  const bg = status === 'active'
                    ? 'var(--tg-theme-button-color, rgba(0,122,255,0.15))'
                    : 'var(--tg-theme-secondary-bg-color, rgba(128,128,128,0.1))';
                  const color = status === 'active'
                    ? 'var(--tg-theme-button-text-color, var(--tg-theme-text-color, #000))'
                    : 'var(--tg-theme-text-color, #000)';

                  return (
                    <div style={{
                      flex: '1 1 0',
                      minWidth: 0,
                      maxWidth: '100%',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                      background: bg, color: color,
                      padding: '6px 8px', borderRadius: 8,
                      fontSize: 12, fontWeight: 500, lineHeight: 1, minHeight: 34,
                      opacity: opacity,
                      border: '1px solid var(--tg-theme-hint-color, rgba(128,128,128,0.1))',
                      overflow: 'hidden', whiteSpace: 'nowrap'
                    }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, lineHeight: 1 }}>
                        <AppIcon name={icon} size={22} />
                        {name}
                      </span>
                      <span style={{ flexShrink: 0, fontWeight: status === 'active' ? 700 : 500, lineHeight: 1 }}>· {statusText}</span>
                    </div>
                  );
                };

                return (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: "var(--tg-theme-text-color, #000)" }}>
                      Бусты
                    </div>
                    {/* Fixed 2-column layout so it never wraps/jumps */}
                    <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                      {renderBadge('joker', 'Доп. джокер', ejCount, ejStatus)}
                      {renderBadge('double_chance', 'Двойной шанс', dcCount, dcStatus)}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--tg-theme-hint-color, #888)", lineHeight: 1.2 }}>
                      1 буст на игровой день
                    </div>
                  </div>
                );
              })()}
            </>
          )}
          <MatchesList
            matches={matches}
            picks={picks}
            results={results}
            pointsMap={pointsMap}
            isLocked={isLocked}
            jokerMatchId={jokerMatchId}
            isPicking={isPicking}
            onUpdatePick={onUpdatePick}
            onSave={handleSave}
            onSetJoker={handleJoker}
            onIsPicking={setIsPicking}
          isAdmin={isAdmin}
          canEditScore={adminPermissions.includes("all") || adminPermissions.includes("score_edit")}
            onAdminSetResult={onAdminSetResult}
            onAdminSaveResult={onAdminSaveResult}
            initData={initData}
            serverPicks={serverPicks}
            dayBoostUsage={dayBoostUsage}
            availableBoosts={availableBoosts}
            onApplyBoost={handleApplyBoost}
            onRemoveBoost={handleRemoveBoost}
            predictionsOpen={seasonState?.predictionsOpen !== false}
            seasonStatusLabel={seasonState?.status === "finished" ? "Сезон завершён" : seasonState?.status === "finalizing" ? "Подводим итоги сезона" : "Сезон закрыт"}
            onGoalscorerSelect={handleGoalscorerSelect}
          />
        </div>
      )}

      {showCoreSection && activeTab === "seasonPredictions" && (
        sectionVisible("seasonPredictions") ? (
          <SeasonPredictionsFeature
            embedded
            onOpenTasks={(target) => openTasks("season", target)}
            requestTab={seasonPredictionsTabRequest}
            visibleTabs={SEASON_PREDICTIONS_TAB_IDS.filter((id) => subsectionVisible(SEASON_PREDICTIONS_TAB_SUBSECTION_KEY[id]))}
          />
        ) : (
          <SectionUnavailable />
        )
      )}

      {showCoreSection && activeTab === "weeklyChallenge" && (
        sectionVisible("weeklyChallenge")
          ? <WeeklyChallengeFeature embedded onOpenTasks={() => openTasks("weekly_challenge")} />
          : <SectionUnavailable />
      )}

      {showCoreSection && (tabMounted.league || activeTab === "league") && (
        <div style={{ display: activeTab === "league" ? undefined : "none" }}>
          {!showLeagueScreen && (
            <LeaguesSection
              initData={initData}
              selectedLeagueId={selectedLeagueId}
              onSelectLeague={(id) => { setSelectedLeagueId(id); if (id) setShowLeagueScreen(true); }}
            />
          )}
          {showLeagueScreen && selectedLeagueId && (
            <LeagueScreen
              initData={initData}
              leagueId={selectedLeagueId}
              currentDay={selectedDate}
              matches={matches}
              results={results}
              onBack={() => setShowLeagueScreen(false)}
              onDeleted={() => { setShowLeagueScreen(false); setSelectedLeagueId(null); }}
              refreshKey={profileRefreshKey}
              onViewUser={(profileKey) => setViewUserKey(profileKey)}
            />
          )}
        </div>
      )}

      {showCoreSection && (tabMounted.rating || activeTab === "rating") && (
        <div style={{ display: activeTab === "rating" ? undefined : "none" }}>
      <RatingTab
        currentDay={selectedDate}
        refreshKey={profileRefreshKey}
        onViewUser={(profileKey) => setViewUserKey(profileKey)}
        hiddenSubsections={RATING_TYPE_SUBSECTION_KEYS.filter((key) => !subsectionVisible(key))}
      />
    </div>
  )
}

{
  initData && questsMounted && (
    <div style={{ display: showAchievements ? undefined : "none" }}>
      <QuestsScreen
        embedded
        onClose={() => setShowAchievements(false)}
        onGoToShop={() => { setShowAchievements(false); setShowShop(true); }}
        requestTab={questsTabRequest}
        onOpenSeasonPredictions={() => navigateAppSection("seasonPredictions")}
        onOpenWeeklyChallenge={() => navigateAppSection("weeklyChallenge")}
        onBalanceChange={(n) => setHeaderBalls(n)}
        hiddenSubsections={TASK_SUBSECTION_KEYS.filter((key) => !subsectionVisible(key))}
      />
    </div>
  )
}
{ initData && showShop && <ShopScreen embedded balls={headerBalls} onClose={() => { setShowShop(false); setShopInitialTab("boosts"); }} onBalanceUpdate={(n) => setHeaderBalls(n)} initialTab={shopInitialTab} onCasesUpdate={(cases) => setMyCases(cases)} hiddenSubsections={SHOP_SUBSECTION_KEYS.filter((key) => !subsectionVisible(key))} /> }
{
  initData && showRules && (
    <div style={{ background: "var(--tg-secondary-bg)", color: "var(--tg-text)", minHeight: "100%" }}>
      <div style={{
        background: "var(--tg-secondary-bg)",
        padding: "12px 16px",
        borderBottom: "0.5px solid var(--tg-separator, rgba(128,128,128,0.1))",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}>
        <button
          type="button"
          onClick={() => setShowRules(false)}
          aria-label="Назад"
          style={{ width: 36, height: 36, flexShrink: 0, border: "none", borderRadius: 12, background: "var(--tg-bg)", color: "var(--tg-text)", fontSize: 22, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}
        >←</button>
        <span aria-hidden="true" style={{ fontSize: 24 }}>ℹ️</span>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Информация</h1>
      </div>
      <RulesContent paddingBottom={80} />
    </div>
  )
}
{
  initData && profileMounted && (
    <div style={{ display: showProfile ? undefined : "none" }}>
      <ProfileScreen
        embedded
        onClose={() => setShowProfile(false)}
        onOpenAchievements={() => { setShowProfile(false); setShowAchievements(true); }}
        onOpenShop={() => { setShowProfile(false); setShowShop(true); }}
        onProfileUpdated={() => {
          setProfileRefreshKey((prev) => prev + 1);
          loadData();
        }}
        balls={headerBalls}
        me={me}
      />
    </div>
  )
}

    </main >
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "var(--tg-secondary-bg)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--tg-hint)" }}>Загрузка…</div>}>
      <PageContent />
    </Suspense>
  );
}

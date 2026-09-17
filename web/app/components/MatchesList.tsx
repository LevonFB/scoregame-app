"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Stepper } from "./Stepper";
import { apiFetch } from "@/lib/api";
import { readUgPlayerSnapshot, saveUgPlayerSnapshot, resolveUgPlayerLabel, getBonusAnswerDisplayLabel, isUgAnswerCorrect, UG_NONE_ANSWER, UG_NONE_LABEL, type UgPlayerSnapshot } from "@/lib/bonusAnswerLabels";
import { formatTimeLeft } from "@/lib/timeLeft";
import { MotionCard } from "./ui/MotionCard";
import { Pressable } from "./ui/Pressable";
import { ActionDialog } from "./ui/ActionDialog";
import { BottomSheet } from "./ui/BottomSheet";
import { AppIcon } from "./ui/AppIcon";

export type Match = {
  id: string;
  competition?: string;
  competitionLabel?: string;
  competitionType?: string;
  matchType?: string;
  apiProvider?: string;
  home: string;
  away: string;
  homeCrest?: string;
  awayCrest?: string;
  startTime: string;
  lockTime: string;
  unlockTime?: string; // 24h before match start
  status?: string; // SCHEDULED, IN_PLAY, PAUSED, FINISHED, etc.
  advancesQuestionEnabled?: boolean;
  advancesPointsAward?: number;
  advancesCorrectAnswer?: "home" | "away" | null;
  advancesResolved?: boolean;
  bonusQuestions?: BonusQuestion[];
  goalscorerEnabled?: boolean;
  goalscorerResolved?: boolean;
  goalscorers?: string[];
};

export type BonusAnswerOption = { key: string; label: string; reward_enabled: boolean; reward_stars: number; sort_order: number };

export type BonusQuestion = {
  questionType: "advances_team" | "first_goal_team" | "player_scores" | "player_assists" | "extra_time_or_penalty" | "extra_time" | "penalty_shootout" | "total_goals" | "total_corners" | "total_yellow_cards" | "red_card" | "user_goalscorer" | "both_teams_score" | "first_goal_minute" | "clean_sheet" | "team_total_goals" | "penalty_awarded" | "stat_leader";
  enabled: boolean;
  title: string;
  pointsAward: number;
  correctAnswer?: string | null;
  resolved?: boolean;
  targetPlayerId?: string | null;
  targetPlayerName?: string | null;
  answerOptions?: BonusAnswerOption[] | null;
  ruleJson?: object | null;
  playerConfig?: { reward_enabled: boolean; reward_stars: number; player_pool: string } | null;
  status?: string | null;
};

const NO_GOALSCORER_PICK_ID = "none";
const NO_GOALSCORER_PICK_LABEL = "Никто";

export type Pick = {
  matchId: string;
  home: number;
  away: number;
  isJoker: boolean;
  advancesAnswer?: "home" | "away" | null;
  bonusAnswers?: Record<string, string | null>;
  goalscorerPick?: { playerId: string; playerName: string };
  updatedAt: string;
};

export type Result = {
  matchId: string;
  home: number;
  away: number;
  finalAt: string;
};

type LeaguePicksGroup = {
  leagueId: string;
  leagueName: string;
  members: {
    userId: number;
    name: string;
    isJoker: boolean;
    home?: number;
    away?: number;
    isHidden: boolean;
  }[];
};

function fmtTime(iso: string) {
  const d = new Date(iso);
  const t = d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  });
  return `${t} МСК`;
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 19) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function getBonusQuestionOptions(q: BonusQuestion, match: Match): { key: string; label: string; rewardStars?: number; rewardEnabled?: boolean }[] {
  // Use server-provided answerOptions when available (for star-reward types)
  if (q.answerOptions && q.answerOptions.length > 0) {
    const sorted = [...q.answerOptions].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    return sorted.map(opt => {
      // Replace team keys with actual team names
      const label = opt.key === "home" ? match.home : opt.key === "away" ? match.away : opt.label;
      return { key: opt.key, label, rewardStars: opt.reward_stars, rewardEnabled: opt.reward_enabled };
    });
  }
  if (q.questionType === "advances_team") {
    return [
      { key: "home", label: match.home },
      { key: "away", label: match.away },
    ];
  }
  if (q.questionType === "first_goal_team") {
    return [
      { key: "home", label: match.home },
      { key: "away", label: match.away },
      { key: "none", label: "Никто" },
    ];
  }
  // Фолбэки на случай вопроса без answerOptions: у командных вопросов набор вариантов
  // не yes/no, и без своей ветки они отрисовались бы как «Да / Нет».
  if (q.questionType === "stat_leader") {
    return [
      { key: "home", label: match.home },
      { key: "away", label: match.away },
      { key: "none", label: "Поровну" },
    ];
  }
  if (q.questionType === "clean_sheet") {
    return [
      { key: "home", label: match.home },
      { key: "away", label: match.away },
      { key: "both", label: "Обе (0:0)" },
      { key: "none", label: "Ни одна" },
    ];
  }
  return [
    { key: "yes", label: "Да" },
    { key: "no", label: "Нет" },
  ];
}

function getBonusAnswerLabel(q: BonusQuestion, answer: string | null | undefined, match: Match) {
  return getBonusQuestionOptions(q, match).find(option => option.key === answer)?.label || null;
}

function GameStarReward({ amount, size = 14 }: { amount: number; size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
      <span>+{amount}</span>
      <AppIcon name="game_star" size={size} />
    </span>
  );
}

function BoostIcon({ name, size = 20 }: { name: "joker" | "double_chance"; size?: number }) {
  return <AppIcon name={name} size={size} />;
}

function StatusChip({ status, color, locked }: { status: string; color: string; locked: boolean }) {
  if (status === "Live" || status === "Матч идёт") {
    return (
      <div style={{
        background: "#34c759", color: "#fff",
        padding: "2px 8px", borderRadius: 6,
        fontSize: 11, fontWeight: 700,
        display: "flex", alignItems: "center", gap: 4
      }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", animation: "pulse 1s infinite" }} />
        МАТЧ ИДЁТ
      </div>
    );
  }

  if (locked) {
    return (
      <div style={{ color: "var(--tg-hint)", fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
        {status === "Завершён" ? "✓" : "🔒"} {status}
      </div>
    );
  }

  return (
    <div style={{ color: "var(--tg-link)", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
      {status}
    </div>
  );
}

export function MatchesList({
  matches,
  picks,
  results,
  pointsMap,
  isLocked,
  jokerMatchId,
  isPicking,
  onUpdatePick,
  onSave,
  onSetJoker,
  onIsPicking,
  isAdmin,
  canEditScore = false,
  onAdminSetResult,
  onAdminSaveResult,
  initData,
  serverPicks,
  dayBoostUsage,
  availableBoosts,
  onApplyBoost,
  onRemoveBoost,
  predictionsOpen = true,
  seasonStatusLabel,
  onGoalscorerSelect,
}: {
  matches: Match[];
  picks: Record<string, Pick>;
  results: Record<string, Result>;
  pointsMap: Record<string, any>;
  isLocked: (m: Match) => boolean;
  jokerMatchId: string | null;
  isPicking: boolean;
  onUpdatePick: (mid: string, patch: Partial<Pick>) => void;
  onSave: (matchId: string, home: number, away: number) => Promise<void>;
  onSetJoker: (mid: string) => void;
  onIsPicking: (v: boolean) => void;
  isAdmin: boolean;
  canEditScore?: boolean;
  onAdminSetResult: (mid: string, home: number, away: number) => void;
  onAdminSaveResult: (mid: string) => void;
  initData: string;
  serverPicks: Record<string, Pick>;
  dayBoostUsage?: { boost_type: string; match_id?: string; dc_variant?: string } | null;
  availableBoosts?: { id: number; type: string }[];
  onApplyBoost?: (boostId: number, matchId: string, dcVariant?: string) => Promise<void>;
  onRemoveBoost?: () => Promise<void>;
  predictionsOpen?: boolean;
  seasonStatusLabel?: string;
  onGoalscorerSelect?: (matchId: string, playerId: string, playerName: string) => Promise<void>;
}) {
  const [friendPicksMatchId, setFriendPicksMatchId] = useState<string | null>(null);
  const [friendPicksData, setFriendPicksData] = useState<LeaguePicksGroup[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [cardSaveStatus, setCardSaveStatus] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const [dcPickerMatchId, setDcPickerMatchId] = useState<string | null>(null);
  const [confirmExtraJokerMatchId, setConfirmExtraJokerMatchId] = useState<string | null>(null);
  const [cancelExtraJokerMatchId, setCancelExtraJokerMatchId] = useState<string | null>(null);
  const [confirmDc, setConfirmDc] = useState<{ matchId: string, variant: string } | null>(null);
  const [expandedQuestions, setExpandedQuestions] = useState<Record<string, boolean>>({});
  const [questionPageByMatch, setQuestionPageByMatch] = useState<Record<string, number>>({});

  // Goalscorer selection state
  const [gsPickerMatchId, setGsPickerMatchId] = useState<string | null>(null);
  const [gsData, setGsData] = useState<{ home: { id: string, name: string }[], away: { id: string, name: string }[] }>({ home: [], away: [] });
  const [loadingGs, setLoadingGs] = useState(false);
  const [savingGs, setSavingGs] = useState(false);

  // Squad data for user_goalscorer bonus question (per match, separate from legacy picker)
  const [ugSquadData, setUgSquadData] = useState<Record<string, { home: { id: string; name: string }[]; away: { id: string; name: string }[]; loading?: boolean; error?: string }>>({});
  // Player selector UI state per match
  const [ugSelectorOpen, setUgSelectorOpen] = useState<Record<string, boolean>>({});
  const [ugSearchQuery, setUgSearchQuery] = useState<Record<string, string>>({});
  const [ugTeamFilter, setUgTeamFilter] = useState<Record<string, "all" | "home" | "away">>({});
  // Locally persisted player_id → name/team snapshot so a saved answer still
  // shows the player name after reload, before (or without) loading the squad.
  const [ugLabelSnapshot, setUgLabelSnapshot] = useState<UgPlayerSnapshot>(() => readUgPlayerSnapshot());
  const ugAutoLoadAttempted = useRef<Set<string>>(new Set());

  // Load squads for a match
  const loadSquads = async (matchId: string) => {
    setGsPickerMatchId(matchId);
    setLoadingGs(true);
    setGsData({ home: [], away: [] });
    try {
      const res = await apiFetch<{ ok: boolean, homeSquad: any[], awaySquad: any[] }>(`/matches/${matchId}/squad`, {
        method: "GET",
      });
      if (res.ok) {
        setGsData({ home: res.homeSquad || [], away: res.awaySquad || [] });
      } else {
        alert("Не удалось загрузить составы (возможно, они еще не объявлены)");
        setGsPickerMatchId(null);
      }
    } catch (e) {
      console.error(e);
      alert("Ошибка при загрузке составов");
      setGsPickerMatchId(null);
    } finally {
      setLoadingGs(false);
    }
  };

  const closeGsPicker = () => {
    setGsPickerMatchId(null);
    setGsData({ home: [], away: [] });
  };

  const loadUGSquad = async (matchId: string) => {
    setUgSquadData(prev => ({ ...prev, [matchId]: { ...(prev[matchId] || { home: [], away: [] }), loading: true, error: undefined } }));
    try {
      const res = await apiFetch<{ ok: boolean; homeSquad: { id: string; name: string }[]; awaySquad: { id: string; name: string }[] }>(`/matches/${matchId}/squad`);
      if (res.ok) {
        setUgSquadData(prev => ({ ...prev, [matchId]: { home: res.homeSquad || [], away: res.awaySquad || [], loading: false } }));
      } else {
        setUgSquadData(prev => ({ ...prev, [matchId]: { home: [], away: [], loading: false, error: "Список игроков недоступен" } }));
      }
    } catch {
      setUgSquadData(prev => ({ ...prev, [matchId]: { home: [], away: [], loading: false, error: "Ошибка загрузки" } }));
    }
  };

  // After a reload the saved user_goalscorer answer is just a player_id. If
  // neither the local snapshot nor loaded squad data can name it, fetch the
  // squad once (the endpoint is D1-cached) so the UI shows a name, not an id.
  useEffect(() => {
    for (const m of matches) {
      const mid = m.id;
      const hasUgQuestion = (m.bonusQuestions || []).some(q => q.enabled && q.questionType === "user_goalscorer");
      if (!hasUgQuestion) continue;
      const savedAnswer = picks[mid]?.bonusAnswers?.user_goalscorer;
      if (!savedAnswer || savedAnswer === UG_NONE_ANSWER) continue;
      if (ugLabelSnapshot[savedAnswer]?.n) continue;
      const squad = ugSquadData[mid];
      if (squad) {
        // Squad loaded — persist the resolved name so future reloads need no fetch.
        if (!squad.loading && !squad.error) {
          const inHome = squad.home.find(pl => pl.id === savedAnswer);
          const inAway = inHome ? undefined : squad.away.find(pl => pl.id === savedAnswer);
          const found = inHome || inAway;
          if (found) {
            setUgLabelSnapshot(prev =>
              prev[savedAnswer]?.n ? prev : saveUgPlayerSnapshot(prev, savedAnswer, found.name, inHome ? m.home : m.away)
            );
          }
        }
        continue;
      }
      if (ugAutoLoadAttempted.current.has(mid)) continue;
      ugAutoLoadAttempted.current.add(mid);
      loadUGSquad(mid);
    }
  }, [matches, picks, ugSquadData, ugLabelSnapshot]);

  const handleSelectGoalscorer = async (matchId: string, playerId: string, playerName: string) => {
    if (!onGoalscorerSelect) return;
    setSavingGs(true);
    try {
      await onGoalscorerSelect(matchId, playerId, playerName);
      closeGsPicker();
    } catch (e) {
      alert("Не удалось сохранить выбор");
    } finally {
      setSavingGs(false);
    }
  };

  // Helper to load friends picks
  const loadFriendPicks = async (matchId: string) => {
    setFriendPicksMatchId(matchId);
    setLoadingFriends(true);
    setFriendPicksData([]);
    try {
      const res = await apiFetch<{ ok: boolean; leagues: LeaguePicksGroup[] }>(`/matches/${matchId}/league-picks`, {
        method: "POST",
        body: JSON.stringify({ initData })
      });
      if (res.ok) {
        setFriendPicksData(res.leagues || []);
      }
    } catch (e) {
      console.error(e);
      alert("Не удалось загрузить прогнозы друзей");
    } finally {
      setLoadingFriends(false);
    }
  };

  // Helper to close modal
  const closeFriendPicks = () => {
    setFriendPicksMatchId(null);
    setFriendPicksData([]);
  };

  return (
    <>
      <style>{`
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
      `}</style>

      {matches.map((m, index) => {
        const mid = String(m.id);
        const p = picks[mid] || { matchId: mid, home: 0, away: 0, isJoker: false, advancesAnswer: null, bonusAnswers: {}, updatedAt: "" };
        const locked = isLocked(m);
        const canEdit = !locked && predictionsOpen;
        const joker = jokerMatchId === mid || p.isJoker;
        const r = results[mid];
        const pts = pointsMap[mid];
        const matchStatus = (m.status || "").toUpperCase();
        const finished = !!r?.finalAt || ["FINISHED", "AWARDED", "FT", "FULL_TIME"].includes(matchStatus);
        const live = !finished && ["IN_PLAY", "PAUSED", "LIVE", "HT"].includes(matchStatus);
        const fallbackAdvancesQuestion: BonusQuestion | null = m.advancesQuestionEnabled === true
          ? {
              questionType: "advances_team",
              enabled: true,
              title: "Кто пройдёт дальше?",
              pointsAward: m.advancesPointsAward || 1,
              correctAnswer: m.advancesCorrectAnswer || null,
              resolved: m.advancesResolved === true,
            }
          : null;
        const bonusQuestions = ((m.bonusQuestions || []).filter(q => q.enabled) as BonusQuestion[]);
        const normalizedBonusQuestions = bonusQuestions.length > 0
          ? bonusQuestions
          : fallbackAdvancesQuestion
            ? [fallbackAdvancesQuestion]
            : [];
        const hasAdvancesQuestion = normalizedBonusQuestions.some(q => q.questionType === "advances_team");
        const hasGoalscorerQuestion = m.goalscorerEnabled === true;
        const hasMatchQuestions = normalizedBonusQuestions.length > 0 || hasGoalscorerQuestion;
        const showMatchQuestions = hasMatchQuestions;
        const questionsExpanded = expandedQuestions[mid] === true;
        const bonusAnswers = p.bonusAnswers || {};
        const selectedAdvancesRaw = bonusAnswers.advances_team || p.advancesAnswer || null;
        const selectedAdvancesTeam = selectedAdvancesRaw === "home" ? m.home : selectedAdvancesRaw === "away" ? m.away : null;
        const correctAdvancesTeam = m.advancesCorrectAnswer === "home" ? m.home : m.advancesCorrectAnswer === "away" ? m.away : null;
        const advancesHit = !!(hasAdvancesQuestion && m.advancesResolved && selectedAdvancesRaw && m.advancesCorrectAnswer && selectedAdvancesRaw === m.advancesCorrectAnswer);
        const selectedBonusCount = normalizedBonusQuestions.filter(q => bonusAnswers[q.questionType] || (q.questionType === "advances_team" && p.advancesAnswer)).length;
        const selectedQuestionCount = selectedBonusCount + (p.goalscorerPick ? 1 : 0);
        const totalQuestionCount = normalizedBonusQuestions.length + (hasGoalscorerQuestion ? 1 : 0);
        const resolvedBonusQuestions = normalizedBonusQuestions.filter(q => q.resolved);
        let correctBonusCount = 0;
        let earnedBonusStars = 0;
        for (const q of resolvedBonusQuestions) {
          const answer = bonusAnswers[q.questionType] || (q.questionType === "advances_team" ? (p.advancesAnswer ?? null) : null);
          if (!answer || !q.correctAnswer) continue;
          let isCorrect = false;
          if (q.questionType === "user_goalscorer") {
            isCorrect = isUgAnswerCorrect(answer, q.correctAnswer);
          } else {
            isCorrect = answer === q.correctAnswer;
          }
          if (isCorrect) {
            correctBonusCount++;
            if (q.questionType === "user_goalscorer") {
              earnedBonusStars += q.playerConfig?.reward_stars || 0;
            } else {
              const opt = q.answerOptions?.find(o => o.key === answer);
              earnedBonusStars += opt?.reward_stars || 0;
            }
          }
        }
        const questionSummary = selectedQuestionCount > 0
          ? [
              ...normalizedBonusQuestions.map(q => {
                const answer = bonusAnswers[q.questionType] || (q.questionType === "advances_team" ? p.advancesAnswer : null);
                const label = getBonusAnswerDisplayLabel(
                  q.questionType,
                  answer,
                  getBonusAnswerLabel(q, answer, m),
                  ugSquadData[mid],
                  ugLabelSnapshot,
                  { homeTeam: m.home, awayTeam: m.away }
                );
                return label ? `${q.title}: ${label}` : null;
              }),
              p.goalscorerPick ? `Гол: ${p.goalscorerPick.playerName}` : null,
            ].filter(Boolean).join(" · ")
          : `${totalQuestionCount} ${pluralRu(totalQuestionCount, "доступен", "доступно", "доступно")}`;
        const questionPages = [
          ...normalizedBonusQuestions.map(q => ({ kind: "bonus" as const, question: q, key: q.questionType })),
          ...(hasGoalscorerQuestion ? [{ kind: "goalscorer" as const, key: "goalscorer" }] : []),
        ];
        const activeQuestionIndex = Math.min(questionPageByMatch[mid] ?? 0, Math.max(0, questionPages.length - 1));
        const activeQuestion = questionPages[activeQuestionIndex] || null;
        const setQuestionPage = (nextIndex: number) => {
          if (questionPages.length === 0) return;
          const normalized = (nextIndex + questionPages.length) % questionPages.length;
          setQuestionPageByMatch(prev => ({ ...prev, [mid]: normalized }));
        };

        // Auto-initialize picks for unlocked cards so 0-0 is always in state
        if (canEdit && !picks[mid]) {
          // Schedule initialization on next tick to avoid setState during render
          setTimeout(() => onUpdatePick(mid, { home: 0, away: 0, advancesAnswer: null, bonusAnswers: {} }), 0);
        }

        // Check if this card is dirty (different from server)
        const sp = serverPicks[mid];
        const isDirty = picks[mid] && (
          !sp ||
          p.home !== sp.home ||
          p.away !== sp.away ||
          (p.advancesAnswer || null) !== (sp?.advancesAnswer || null) ||
          JSON.stringify(p.bonusAnswers || {}) !== JSON.stringify(sp?.bonusAnswers || {})
        );
        const saveStatus = cardSaveStatus[mid];

        const handleCardSave = async () => {
          setCardSaveStatus(prev => ({ ...prev, [mid]: 'saving' }));
          try {
            await onSave(mid, p.home, p.away);
            setCardSaveStatus(prev => ({ ...prev, [mid]: 'saved' }));
            setTimeout(() => setCardSaveStatus(prev => {
              const n = { ...prev };
              delete n[mid];
              return n;
            }), 3000);
          } catch {
            setCardSaveStatus(prev => ({ ...prev, [mid]: 'error' }));
          }
        };
        const [adminH, adminA] = (() => {
          const cur = r ? { home: r.home, away: r.away } : { home: 0, away: 0 };
          return [cur.home, cur.away] as const;
        })();

        let statusText = "Приём открыт";
        let statusColor = "";

        // Check if before unlock time
        const now = Date.now();
        const unlockMs = m.unlockTime ? new Date(m.unlockTime).getTime() : 0;
        const lockMs = new Date(m.lockTime).getTime();
        const notYetUnlocked = unlockMs > 0 && now < unlockMs;
        const boostsOpen = canEdit;
        const afterLockTime = now >= lockMs;

        if (!predictionsOpen && !afterLockTime) {
          statusText = seasonStatusLabel || "Сезон закрыт";
        } else if (notYetUnlocked) {
          statusText = "Ещё не открыто";
        } else if (afterLockTime) {
          if (finished) {
            statusText = "Завершён";
          } else if (live) {
            statusText = "Матч идёт";
          } else {
            // Fallback: if status is still SCHEDULED but lock time passed, show Live
            statusText = "Матч идёт";
          }
        }

        const haptic = (style: "light" | "medium" | "heavy" = "light") => {
          // @ts-ignore
          if (typeof window !== 'undefined' && window.Telegram?.WebApp?.HapticFeedback) {
            // @ts-ignore
            window.Telegram.WebApp.HapticFeedback.impactOccurred(style);
          }
        };

        const toggleJoker = (mid: string) => {
          if (!initData) return;

          const matchPick = picks[mid];
          const isJoker = (jokerMatchId === mid) || matchPick?.isJoker;

          const totalJokerCount = matches.filter(match => {
            const matchMid = String(match.id);
            const pick = picks[matchMid];
            return (jokerMatchId === matchMid) || pick?.isJoker;
          }).length;

          // If we are ADDING a joker
          if (!isJoker) {
            // Check if this action uses the extra joker capability
            const hasExtraJokerApplied = dayBoostUsage?.boost_type === 'extra_joker';
            const extraJokerAvailable = !dayBoostUsage && availableBoosts && availableBoosts.some(b => b.type === 'extra_joker');
            const hasExtraJokerCapability = hasExtraJokerApplied || extraJokerAvailable;

            // If user already has 1 or more jokers placed, and they have the extra joker capability,
            // this click is for their SECOND joker. Always ask for confirmation.
            if (totalJokerCount >= 1 && hasExtraJokerCapability) {
              setConfirmExtraJokerMatchId(mid);
              haptic("medium");
              return;
            }
          } else {
            // We are REMOVING a joker
            // If the user has 2 jokers on the board, removing one effectively cancels the "extra joker".
            // The prompt requests asking for confirmation when removing the "extra joker".
            if (totalJokerCount >= 2) {
              setCancelExtraJokerMatchId(mid);
              haptic("medium");
              return;
            }
          }

          onSetJoker(mid);
          haptic("medium");
        };

        const dcOnThisMatch = dayBoostUsage?.boost_type === 'double_chance' && dayBoostUsage?.match_id === mid;

        return (
          <MotionCard
            key={mid}
            id={`match-card-${mid}`}
            delayIndex={index}
            style={{
              borderRadius: 16,
              marginBottom: 16,
              background: "var(--tg-bg)",
              color: "var(--tg-text)",
              // Added subtle border for contrast against dark bg
              border: "1px solid var(--tg-separator, rgba(128,128,128,0.1))",
              boxShadow: "0 12px 28px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.04)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Header: [Status] [Time] ... [Joker] */}
            <div style={{
              padding: "10px 14px", // compact
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              borderBottom: "1px solid rgba(128,128,128,0.05)" // subtle separator for header
            }}>
              {/* Left Group — can shrink and wrap so it never slides under the boost buttons */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, rowGap: 4, flexWrap: "wrap", flex: "1 1 auto", minWidth: 0 }}>
                <StatusChip status={statusText} color={statusColor} locked={locked || !predictionsOpen} />
                <div style={{ width: 1, height: 12, background: "var(--tg-hint)", opacity: 0.3 }} /> {/* divider */}
                <div style={{ fontSize: 13, fontWeight: 400, color: "var(--tg-hint)" }}>
                  {fmtTime(m.startTime)}
                </div>
                {/* Countdown to the prediction deadline while intake is open */}
                {canEdit && !notYetUnlocked && !afterLockTime && (
                  <>
                    <div style={{ width: 1, height: 12, background: "var(--tg-hint)", opacity: 0.3 }} />
                    <div style={{
                      fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
                      color: lockMs - now < 3600000 ? "#ff9500" : "var(--tg-hint)",
                    }}>
                      до закрытия {formatTimeLeft(lockMs - now)}
                    </div>
                  </>
                )}
                {dcOnThisMatch && (
                  <>
                    <div style={{ width: 1, height: 12, background: "var(--tg-hint)", opacity: 0.3 }} />
                    <Pressable
                      onClick={(e) => {
                         e.stopPropagation();
                         if (canEdit && onRemoveBoost) onRemoveBoost();
                      }}
                      disabled={!canEdit}
                      style={{
                        background: 'rgba(0,122,255,0.1)', color: '#007aff', border: 'none',
                        fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6,
                        cursor: canEdit ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 6
                      }}
                    >
                      <BoostIcon name="double_chance" size={20} /> 1X2{!locked ? ' ✕' : ''}
                    </Pressable>
                  </>
                )}
              </div>

              {/* Right Group: Joker Toggle */}
              {(boostsOpen || joker) && (() => {
                // Extra joker boost: either already applied OR available for purchase (will auto-apply on backend)
                const hasExtraJoker = dayBoostUsage?.boost_type === 'extra_joker'
                  || (!dayBoostUsage && availableBoosts && availableBoosts.some(b => b.type === 'extra_joker'));
                // Max jokers allowed: 2 with extra_joker, 1 normally
                const maxJokers = hasExtraJoker ? 2 : 1;
                // Count all jokers currently set across all matches
                const totalJokerCount = matches.filter(match => {
                  const matchMid = String(match.id);
                  const matchPick = picks[matchMid];
                  return (jokerMatchId === matchMid) || matchPick?.isJoker;
                }).length;
                // Joker disabled conditions:
                // - match is locked
                // - DC is on this specific match
                // - joker limit reached and this match doesn't already have joker
                const jokerDisabled = !boostsOpen || dcOnThisMatch || (!joker && totalJokerCount >= maxJokers);

                // DC button: show until prediction intake closes, if no boost is used today and this match has no joker.
                const canShowDC = boostsOpen && availableBoosts && availableBoosts.some(b => b.type === 'double_chance') && !dayBoostUsage && !joker;

                return (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', position: 'relative', zIndex: 2, flexShrink: 0 }}>
                    {/* Double Chance button вЂ” available if no boost used this day and this match has no joker */}
                    {canShowDC && (
                      <Pressable
                        onClick={(e) => {
                          e.stopPropagation();
                          setDcPickerMatchId(dcPickerMatchId === mid ? null : mid)
                        }}
                        style={{
                          background: 'rgba(0,122,255,0.12)',
                          border: 'none',
                          color: 'var(--tg-link)',
                          fontSize: 11, fontWeight: 700,
                          padding: '8px 14px', borderRadius: 12,
                          cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 6,
                          outline: 'none', WebkitTapHighlightColor: 'transparent',
                          minHeight: '32px'
                        }}
                      >
                        <BoostIcon name="double_chance" size={22} /> 1X2
                      </Pressable>
                    )}
                    {/* Main Joker / Extra Joker Button */}
                    <Pressable
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!jokerDisabled) toggleJoker(mid);
                      }}
                      disabled={jokerDisabled}
                      haptic="none"
                      style={{
                        background: joker ? '#ffcc00' : 'rgba(128,128,128,0.1)',
                        border: 'none',
                        color: joker ? '#000' : 'var(--tg-hint)',
                        fontSize: 11, fontWeight: 700,
                        padding: '8px 14px', borderRadius: 12,
                        cursor: jokerDisabled ? 'default' : 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6,
                        transition: 'all 0.2s',
                        opacity: jokerDisabled && !joker ? 0.4 : 1,
                        outline: 'none', WebkitTapHighlightColor: 'transparent',
                        minHeight: '32px',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {joker ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", lineHeight: 1 }}>
                          <BoostIcon name="joker" size={20} /> x2
                        </span>
                      ) : hasExtraJoker && totalJokerCount >= 1 ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", lineHeight: 1 }}>
                          <BoostIcon name="joker" size={20} /> Доп. джокер
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", lineHeight: 1 }}>
                          <BoostIcon name="joker" size={20} /> x2
                        </span>
                      )}
                    </Pressable>
                  </div>
                );
              })()}
            </div>

            {(m.competitionLabel || m.competition || m.matchType) && (
              <div style={{
                padding: "8px 14px 0",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                flexWrap: "wrap",
              }}>
                <div style={{
                  fontSize: 12,
                  color: "var(--tg-hint)",
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "100%",
                }}>
                  {m.competitionLabel || m.competition}
                </div>
                {m.matchType && (
                  <div style={{
                    padding: "4px 8px",
                    borderRadius: 999,
                    background: m.matchType === "national_team" ? "rgba(255,204,0,0.16)" : "rgba(128,128,128,0.12)",
                    color: m.matchType === "national_team" ? "#ffcc00" : "var(--tg-hint)",
                    fontSize: 10,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}>
                    {m.matchType === "national_team" ? "National Teams" : "Club"}
                  </div>
                )}
              </div>
            )}

            {/* Teams Row */}
            <div style={{ padding: "16px", display: "flex", gap: 16, alignItems: "center" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Home */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, height: 32 }}>
                  {m.homeCrest && (
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: "rgba(255,255,255,0.9)", // visibility bg
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.1)"
                    }}>
                      <img src={m.homeCrest} alt="" width={20} height={20} style={{ objectFit: "contain" }} />
                    </div>
                  )}
                  <span style={{ fontSize: 17, fontWeight: 600 }}>{m.home}</span>
                </div>
                {/* Away */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, height: 32 }}>
                  {m.awayCrest && (
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: "rgba(255,255,255,0.9)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.1)"
                    }}>
                      <img src={m.awayCrest} alt="" width={20} height={20} style={{ objectFit: "contain" }} />
                    </div>
                  )}
                  <span style={{ fontSize: 17, fontWeight: 600 }}>{m.away}</span>
                </div>
              </div>

              {/* Inputs / Result */}
              <div>
                {!locked ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-end" }}>
                    <Stepper value={p.home} onChange={(v) => onUpdatePick(mid, { home: v })} disabled={!predictionsOpen} />
                    <Stepper value={p.away} onChange={(v) => onUpdatePick(mid, { away: v })} disabled={!predictionsOpen} />
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-end" }}>
                    {r ? (
                      <>
                        <div style={{ height: 32, display: "flex", alignItems: "center", fontSize: 20, fontWeight: 700 }}>
                          {r.home}
                        </div>
                        <div style={{ height: 32, display: "flex", alignItems: "center", fontSize: 20, fontWeight: 700 }}>
                          {r.away}
                        </div>
                      </>
                    ) : (
                      <div style={{ color: "var(--tg-hint)", fontSize: 13 }}>?</div>
                    )}

                  </div>
                )}
              </div>
            </div>

            {showMatchQuestions && (
              <div style={{
                margin: "0 14px 4px",
                borderRadius: 16,
                overflow: "hidden",
                background: "rgba(255,255,255,0.035)",
                border: "1px solid rgba(128,128,128,0.09)",
              }}>
                <Pressable
                  onClick={() => setExpandedQuestions(prev => ({ ...prev, [mid]: !questionsExpanded }))}
                  pressedScale={0.985}
                  style={{
                    width: "100%",
                    minHeight: 48,
                    padding: "10px 12px",
                    border: "none",
                    background: "linear-gradient(90deg, rgba(255,255,255,0.055), rgba(255,255,255,0.018))",
                    color: "var(--tg-text)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    cursor: "pointer",
                  }}
                >
                  {(() => {
                    let iconText: string;
                    let iconBg: string;
                    let iconColor: string;
                    let titleNode: React.ReactNode;
                    let subtitleNode: React.ReactNode;

                    if (finished && resolvedBonusQuestions.length > 0) {
                      iconText = correctBonusCount > 0 ? "✓" : "○";
                      iconBg = correctBonusCount > 0 ? "rgba(52,199,89,0.16)" : "rgba(128,128,128,0.12)";
                      iconColor = correctBonusCount > 0 ? "#34c759" : "var(--tg-hint)";
                      titleNode = earnedBonusStars > 0
                        ? <><span style={{ color: correctBonusCount > 0 ? "#34c759" : "var(--tg-hint)" }}>Итоги: {correctBonusCount} из {resolvedBonusQuestions.length}</span><span style={{ color: "#b8860b", marginLeft: 5 }}><GameStarReward amount={earnedBonusStars} size={14} /></span></>
                        : `Итоги: ${correctBonusCount} из ${resolvedBonusQuestions.length}`;
                      subtitleNode = questionSummary;
                    } else if (finished) {
                      iconText = "?";
                      iconBg = "rgba(255,204,0,0.12)";
                      iconColor = "#b8860b";
                      titleNode = "Матч завершён · ожидаем итогов";
                      subtitleNode = questionSummary;
                    } else if (!afterLockTime && (notYetUnlocked || !predictionsOpen)) {
                      // Приём ещё не начался: карточка заблокирована, но прогнозы не «приняты»
                      iconText = "🔒";
                      iconBg = "rgba(128,128,128,0.12)";
                      iconColor = "var(--tg-hint)";
                      titleNode = notYetUnlocked ? "Приём ещё не открыт" : (seasonStatusLabel || "Сезон закрыт");
                      subtitleNode = questionSummary;
                    } else if (locked) {
                      iconText = selectedQuestionCount > 0 ? "✓" : "–";
                      iconBg = selectedQuestionCount > 0 ? "rgba(52,199,89,0.16)" : "rgba(128,128,128,0.12)";
                      iconColor = selectedQuestionCount > 0 ? "#34c759" : "var(--tg-hint)";
                      titleNode = "Прогнозы приняты · ждём матча";
                      subtitleNode = questionSummary;
                    } else {
                      const remaining = totalQuestionCount - selectedQuestionCount;
                      iconText = selectedQuestionCount > 0 ? "✓" : "+";
                      iconBg = selectedQuestionCount > 0 ? "rgba(52,199,89,0.16)" : "rgba(0,122,255,0.15)";
                      iconColor = selectedQuestionCount > 0 ? "#34c759" : "var(--tg-button,#007aff)";
                      titleNode = remaining > 0
                        ? `Сделай прогноз ещё на ${remaining} ${pluralRu(remaining, "событие", "события", "событий")}`
                        : totalQuestionCount === 1
                          ? "Прогноз на событие сделан"
                          : `Все ${totalQuestionCount} ${pluralRu(totalQuestionCount, "прогноз", "прогноза", "прогнозов")} сделаны`;
                      subtitleNode = questionSummary;
                    }

                    return (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: 10,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: iconBg, color: iconColor,
                          fontSize: 14, fontWeight: 900, flexShrink: 0,
                        }}>
                          {iconText}
                        </div>
                        <div style={{ minWidth: 0, textAlign: "left" }}>
                          <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.15 }}>
                            {titleNode}
                          </div>
                          <div style={{
                            marginTop: 3, fontSize: 12, color: "var(--tg-hint)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 230,
                          }}>
                            {subtitleNode}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    {activeQuestion?.kind === "bonus" && (
                      <span style={{
                        padding: "4px 7px",
                        borderRadius: 999,
                        background: "rgba(255,214,0,0.15)",
                        color: "#b8860b",
                        fontSize: 11,
                        fontWeight: 800,
                      }}>
                        <AppIcon name="game_star" size={14} />
                      </span>
                    )}
                    {activeQuestion?.kind === "goalscorer" && (
                      <span style={{
                        padding: "4px 7px",
                        borderRadius: 999,
                        background: "rgba(255,214,0,0.15)",
                        color: "#b8860b",
                        fontSize: 11,
                        fontWeight: 800,
                      }}>
                        <AppIcon name="game_star" size={14} />
                      </span>
                    )}
                    <span style={{
                      color: "var(--tg-hint)",
                      fontSize: 13,
                      transform: questionsExpanded ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 180ms var(--sg-ease-out)",
                    }}>
                      ▾
                    </span>
                  </div>
                </Pressable>

                {questionsExpanded && typeof document !== "undefined" && createPortal(
                  <>
                    <div
                      onClick={() => setExpandedQuestions(prev => ({ ...prev, [mid]: false }))}
                      style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 89,
                        background: "rgba(0,0,0,0.46)",
                      }}
                    />
                    <div className="sg-question-panel" style={{
                      position: "fixed",
                      left: "max(10px, env(safe-area-inset-left))",
                      right: "max(10px, env(safe-area-inset-right))",
                      bottom: "calc(env(safe-area-inset-bottom, 0px) + 10px)",
                      zIndex: 90,
                      padding: "12px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      border: "1px solid rgba(128,128,128,0.16)",
                      borderRadius: 22,
                      background: "var(--tg-secondary-bg, #1f1f1f)",
                      boxShadow: "0 10px 24px rgba(0,0,0,0.34)",
                      maxHeight: "min(82vh, 640px)",
                      overflowY: "auto",
                      overflowX: "hidden",
                      overscrollBehaviorY: "contain",
                      WebkitOverflowScrolling: "touch",
                      touchAction: "pan-y",
                    }}>
                    <div style={{
                      position: "sticky",
                      top: -12,
                      zIndex: 1,
                      margin: "-12px -12px 0",
                      padding: "12px 12px 10px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      background: "var(--tg-secondary-bg, #1f1f1f)",
                      borderBottom: "1px solid rgba(128,128,128,0.10)",
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 900, color: "var(--tg-text)" }}>
                          Доп. события
                        </div>
                        <div style={{
                          marginTop: 2,
                          fontSize: 11,
                          color: "var(--tg-hint)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}>
                          {activeQuestion?.kind === "bonus" ? activeQuestion.question.title : "Автор гола"}
                        </div>
                      </div>
                      <Pressable
                        onClick={() => setExpandedQuestions(prev => ({ ...prev, [mid]: false }))}
                        style={{
                          flexShrink: 0,
                          minWidth: 72,
                          height: 34,
                          padding: "0 12px",
                          borderRadius: 999,
                          border: "1px solid rgba(128,128,128,0.12)",
                          background: "rgba(255,255,255,0.06)",
                          color: "var(--tg-text)",
                          fontSize: 12,
                          fontWeight: 800,
                        }}
                      >
                        Закрыть
                      </Pressable>
                    </div>
                    {activeQuestion?.kind === "bonus" && (
                      <div className="sg-pop" style={{
                        padding: "12px",
                        borderRadius: 14,
                        background: "rgba(0,0,0,0.13)",
                        border: "1px solid rgba(128,128,128,0.08)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}>
                        {(() => {
                          const bq = activeQuestion.question;
                          const isStarReward = bq.pointsAward === 0;
                          const isUserGoalscorer = bq.questionType === "user_goalscorer";

                          // user_goalscorer: player selector UI
                          if (isUserGoalscorer) {
                            const ugPool = bq.playerConfig?.player_pool || "both_teams";
                            const ugRewardStars = bq.playerConfig?.reward_enabled !== false ? (bq.playerConfig?.reward_stars || 0) : 0;
                            const ugCurrentPlayerId = bonusAnswers["user_goalscorer"] || null;
                            const ugSquad = ugSquadData[mid];
                            const selectorOpen = ugSelectorOpen[mid] === true;
                            const searchQuery = ugSearchQuery[mid] || "";
                            const teamFilter = ugTeamFilter[mid] || "all";
                            const showBothTeams = ugPool === "both_teams";
                            const homeTeamName = m.home || "Хозяева";
                            const awayTeamName = m.away || "Гости";

                            const ugAllPoolPlayers = (() => {
                              if (!ugSquad) return [] as { id: string; name: string; side: "home" | "away" }[];
                              const home = ugSquad.home.map(pl => ({ ...pl, side: "home" as const }));
                              const away = ugSquad.away.map(pl => ({ ...pl, side: "away" as const }));
                              if (ugPool === "home_team") return home;
                              if (ugPool === "away_team") return away;
                              return [...home, ...away];
                            })();

                            const ugFilteredByTeam = showBothTeams && teamFilter !== "all"
                              ? ugAllPoolPlayers.filter(pl => pl.side === teamFilter)
                              : ugAllPoolPlayers;

                            const ugFilteredPlayers = searchQuery.trim()
                              ? ugFilteredByTeam.filter(pl => pl.name.toLowerCase().includes(searchQuery.toLowerCase()))
                              : ugFilteredByTeam;

                            // Never show the raw player_id: squad → local snapshot → "Игрок #id".
                            const ugCurrentPlayerName = resolveUgPlayerLabel(
                              ugCurrentPlayerId,
                              ugSquad && !ugSquad.loading ? ugSquad : null,
                              ugLabelSnapshot,
                              { homeTeam: homeTeamName, awayTeam: awayTeamName, withTeam: showBothTeams }
                            );

                            return (
                              <>
                                {/* Title row */}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                  <div style={{ fontSize: 13, fontWeight: 800, color: "var(--tg-text)" }}>
                                    {selectorOpen ? "Выбери автора гола" : bq.title}
                                  </div>
                                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 999, background: "rgba(255,214,0,0.15)", color: "#b8860b", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}><AppIcon name="game_star" size={14} /> Звёзды</div>
                                </div>

                                {/* Reward */}
                                {ugRewardStars > 0 && (
                                  <div style={{ fontSize: 11, color: "var(--tg-hint)" }}>
                                    Награда за правильный выбор: <span style={{ color: "#b8860b", fontWeight: 700 }}><GameStarReward amount={ugRewardStars} size={14} /></span>
                                  </div>
                                )}

                                {/* LOCKED */}
                                {locked && (
                                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                    {ugCurrentPlayerName ? (
                                      <div style={{ fontSize: 13, color: "var(--tg-hint)" }}>
                                        Твой выбор: <span style={{ color: "var(--tg-text)", fontWeight: 700 }}>{ugCurrentPlayerName}</span>
                                      </div>
                                    ) : (
                                      <div style={{ fontSize: 13, color: "var(--tg-hint)" }}>Выбор не сделан</div>
                                    )}
                                    {bq.resolved && ugCurrentPlayerId && (() => {
                                      const isCorrect = isUgAnswerCorrect(ugCurrentPlayerId, bq.correctAnswer);
                                      if (isCorrect) {
                                        return <div style={{ fontSize: 13, color: "#34c759" }}>{ugRewardStars > 0 ? <>✓ Верно: <GameStarReward amount={ugRewardStars} size={14} /></> : "✓ Верно · без награды"}</div>;
                                      }
                                      return <div style={{ fontSize: 13, color: "var(--tg-hint)" }}>✕ Неверно</div>;
                                    })()}
                                    {!bq.resolved && (
                                      <div style={{ fontSize: 11, color: "var(--tg-hint)" }}>Выбор закрыт</div>
                                    )}
                                  </div>
                                )}

                                {/* UNLOCKED, SELECTOR CLOSED */}
                                {!locked && !selectorOpen && (
                                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    {ugCurrentPlayerName && (
                                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 12, background: "rgba(0,122,255,0.08)", border: "1px solid rgba(0,122,255,0.18)" }}>
                                        <span style={{ fontSize: 13, color: "var(--tg-button, #007aff)", fontWeight: 800 }}>✓ {ugCurrentPlayerName}</span>
                                      </div>
                                    )}
                                    {!ugCurrentPlayerName && (
                                      <div style={{ fontSize: 12, color: "var(--tg-hint)" }}>Выбери одного футболиста или вариант «{UG_NONE_LABEL}»</div>
                                    )}
                                    <Pressable
                                      onClick={() => {
                                        if (!ugSquad) loadUGSquad(mid);
                                        setUgSelectorOpen(prev => ({ ...prev, [mid]: true }));
                                      }}
                                      disabled={!predictionsOpen}
                                      style={{
                                        width: "100%", padding: "11px 14px", borderRadius: 12,
                                        border: "1px solid rgba(128,128,128,0.14)",
                                        background: "rgba(255,255,255,0.05)",
                                        color: "var(--tg-text)", fontSize: 13, fontWeight: 700,
                                        textAlign: "center",
                                        cursor: predictionsOpen ? "pointer" : "default",
                                      }}
                                    >
                                      {ugCurrentPlayerName ? "Изменить выбор" : "Выбрать игрока"}
                                    </Pressable>
                                  </div>
                                )}

                                {/* UNLOCKED, SELECTOR OPEN */}
                                {!locked && selectorOpen && (
                                  <div
                                    ref={el => {
                                      // Только при первом появлении селектора: ref-колбэк переприсваивается
                                      // на каждом рендере, а панель ререндерится по таймеру шелла.
                                      if (!el || el.dataset.ugScrolled === "1") return;
                                      el.dataset.ugScrolled = "1";
                                      el.scrollIntoView({ block: "nearest" });
                                    }}
                                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                                  >
                                    {ugSquad?.loading && (
                                      <div style={{ textAlign: "center", fontSize: 13, color: "var(--tg-hint)", padding: "12px 0" }}>Загрузка игроков…</div>
                                    )}
                                    {ugSquad?.error && (
                                      <div style={{ fontSize: 12, color: "var(--tg-destructive, #ff3b30)", textAlign: "center" }}>{ugSquad.error}</div>
                                    )}

                                    {/* "Никто не забьёт" — отдельный вариант, доступен даже без состава */}
                                    {(() => {
                                      const noneSelected = ugCurrentPlayerId === UG_NONE_ANSWER;
                                      return (
                                        <Pressable
                                          className="sg-pressable-flat"
                                          onClick={() => {
                                            const nextVal: string | null = noneSelected ? null : UG_NONE_ANSWER;
                                            onUpdatePick(mid, { bonusAnswers: { ...bonusAnswers, user_goalscorer: nextVal } });
                                            if (!noneSelected) setUgSelectorOpen(prev => ({ ...prev, [mid]: false }));
                                          }}
                                          disabled={!predictionsOpen}
                                          style={{
                                            width: "100%", padding: "10px 12px", borderRadius: 12,
                                            border: noneSelected ? "1px solid var(--tg-button, #007aff)" : "1px solid rgba(128,128,128,0.14)",
                                            background: noneSelected ? "rgba(0,122,255,0.16)" : "rgba(255,255,255,0.04)",
                                            color: noneSelected ? "var(--tg-button, #007aff)" : "var(--tg-text)",
                                            fontSize: 12, fontWeight: noneSelected ? 800 : 700,
                                            textAlign: "center",
                                            cursor: predictionsOpen ? "pointer" : "default",
                                          }}
                                        >
                                          {noneSelected ? "✓ " : ""}{UG_NONE_LABEL}
                                        </Pressable>
                                      );
                                    })()}

                                    {/* Search */}
                                    {(ugSquad && !ugSquad.loading && ugAllPoolPlayers.length > 0) && (
                                      <input
                                        type="search"
                                        placeholder="Поиск игрока..."
                                        value={searchQuery}
                                        onChange={e => setUgSearchQuery(prev => ({ ...prev, [mid]: e.target.value }))}
                                        style={{
                                          width: "100%", padding: "9px 12px", borderRadius: 12,
                                          border: "1px solid rgba(128,128,128,0.18)",
                                          background: "rgba(255,255,255,0.06)",
                                          color: "var(--tg-text)", fontSize: 13,
                                          outline: "none", boxSizing: "border-box",
                                        }}
                                      />
                                    )}

                                    {/* Team filter (only for both_teams) */}
                                    {showBothTeams && ugAllPoolPlayers.length > 0 && (
                                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                        {(["all", "home", "away"] as const).map(f => {
                                          const label = f === "all" ? "Все" : f === "home" ? homeTeamName : awayTeamName;
                                          const active = teamFilter === f;
                                          return (
                                            <Pressable
                                              key={f}
                                              onClick={() => setUgTeamFilter(prev => ({ ...prev, [mid]: f }))}
                                              style={{
                                                padding: "5px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                                                border: active ? "1px solid var(--tg-button, #007aff)" : "1px solid rgba(128,128,128,0.18)",
                                                background: active ? "rgba(0,122,255,0.14)" : "rgba(255,255,255,0.04)",
                                                color: active ? "var(--tg-button, #007aff)" : "var(--tg-hint)",
                                                cursor: "pointer", whiteSpace: "nowrap",
                                                overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120,
                                              }}
                                            >
                                              {label}
                                            </Pressable>
                                          );
                                        })}
                                      </div>
                                    )}

                                    {/* Empty states */}
                                    {!ugSquad?.loading && ugSquad && ugAllPoolPlayers.length === 0 && !ugSquad.error && (
                                      <div style={{ fontSize: 12, color: "var(--tg-hint)", textAlign: "center", padding: "12px 0" }}>Список игроков пока недоступен</div>
                                    )}
                                    {ugFilteredPlayers.length === 0 && searchQuery.trim() && ugAllPoolPlayers.length > 0 && (
                                      <div style={{ fontSize: 12, color: "var(--tg-hint)", textAlign: "center", padding: "8px 0" }}>Игрок не найден</div>
                                    )}

                                    {/* Player grid — no inner scroll: the questions panel is the only scroller */}
                                    {ugFilteredPlayers.length > 0 && (
                                      <div style={{
                                        display: "grid",
                                        gridTemplateColumns: "1fr 1fr",
                                        gap: 6,
                                      }}>
                                        {ugFilteredPlayers.map((player) => {
                                          const isSelected = ugCurrentPlayerId === player.id;
                                          const teamLabel = player.side === "home" ? homeTeamName : awayTeamName;
                                          return (
                                            <Pressable
                                              key={`${player.side}:${player.id}`}
                                              className="sg-pressable-flat"
                                              onClick={() => {
                                                const nextVal: string | null = isSelected ? null : player.id;
                                                if (nextVal) {
                                                  // Snapshot the label so the name survives reloads even before the squad re-loads.
                                                  setUgLabelSnapshot(prev => saveUgPlayerSnapshot(prev, player.id, player.name, teamLabel));
                                                }
                                                onUpdatePick(mid, { bonusAnswers: { ...bonusAnswers, user_goalscorer: nextVal } });
                                                if (!isSelected) setUgSelectorOpen(prev => ({ ...prev, [mid]: false }));
                                              }}
                                              disabled={!predictionsOpen}
                                              style={{
                                                display: "flex", flexDirection: "column", alignItems: "flex-start",
                                                padding: "9px 10px", borderRadius: 12, minWidth: 0,
                                                border: isSelected ? "1px solid var(--tg-button, #007aff)" : "1px solid rgba(128,128,128,0.12)",
                                                background: isSelected ? "rgba(0,122,255,0.16)" : "rgba(255,255,255,0.03)",
                                                cursor: predictionsOpen ? "pointer" : "default",
                                              }}
                                            >
                                              <span style={{ fontSize: 12, fontWeight: isSelected ? 800 : 600, color: isSelected ? "var(--tg-button, #007aff)" : "var(--tg-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
                                                {isSelected ? "✓ " : ""}{player.name}
                                              </span>
                                              {showBothTeams && (
                                                <span style={{ fontSize: 10, color: "var(--tg-hint)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
                                                  {teamLabel}
                                                </span>
                                              )}
                                            </Pressable>
                                          );
                                        })}
                                      </div>
                                    )}

                                    {/* Collapse button */}
                                    <Pressable
                                      onClick={() => setUgSelectorOpen(prev => ({ ...prev, [mid]: false }))}
                                      style={{
                                        width: "100%", padding: "9px", borderRadius: 12,
                                        border: "1px solid rgba(128,128,128,0.14)",
                                        background: "rgba(255,255,255,0.04)",
                                        color: "var(--tg-hint)", fontSize: 12, fontWeight: 700,
                                        textAlign: "center", cursor: "pointer",
                                      }}
                                    >
                                      Свернуть
                                    </Pressable>
                                  </div>
                                )}
                              </>
                            );
                          }

                          // All other bonus question types: standard button grid
                          const options = getBonusQuestionOptions(bq, m);
                          return (
                            <>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                <div style={{ fontSize: 13, fontWeight: 800, color: "var(--tg-text)" }}>
                                  {bq.title}
                                </div>
                                <div style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 999, background: "rgba(255,214,0,0.15)", color: "#b8860b", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>
                                  <AppIcon name="game_star" size={14} /> Звёзды
                                </div>
                              </div>

                              {!locked ? (
                                <>
                                  {isStarReward && (
                                    <div style={{ fontSize: 11, color: "var(--tg-hint)", textAlign: "center" }}>
                                      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, whiteSpace: "nowrap" }}><AppIcon name="game_star" size={13} /> Звёзды начисляются только за правильный ответ</span>
                                    </div>
                                  )}
                                  <div style={{ display: "flex", gap: 8 }}>
                                    {options.map((option) => {
                                      const answer = bonusAnswers[bq.questionType] || (bq.questionType === "advances_team" ? p.advancesAnswer : null);
                                      const active = answer === option.key;
                                      const showReward = isStarReward && option.rewardEnabled && (option.rewardStars || 0) > 0;
                                      return (
                                        <Pressable
                                          key={option.key}
                                          onClick={() => {
                                            const nextValue = active ? null : option.key;
                                            onUpdatePick(mid, {
                                              advancesAnswer: bq.questionType === "advances_team" ? (nextValue as "home" | "away" | null) : p.advancesAnswer,
                                              bonusAnswers: { ...bonusAnswers, [bq.questionType]: nextValue },
                                            });
                                          }}
                                          disabled={!predictionsOpen}
                                          style={{
                                            flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                                            padding: "10px 8px", borderRadius: 12,
                                            border: active ? "1px solid var(--tg-button, #007aff)" : "1px solid rgba(128,128,128,0.12)",
                                            background: active ? "rgba(0,122,255,0.16)" : "rgba(255,255,255,0.03)",
                                            color: active ? "var(--tg-button, #007aff)" : "var(--tg-text)",
                                            fontSize: 13, fontWeight: 800,
                                            cursor: predictionsOpen ? "pointer" : "default",
                                          }}
                                        >
                                          <span>{option.label}</span>
                                          {showReward && <span style={{ fontSize: 11, color: active ? "var(--tg-button, #007aff)" : "#b8860b", fontWeight: 700 }}><GameStarReward amount={option.rewardStars || 0} size={13} /></span>}
                                          {!showReward && isStarReward && <span style={{ fontSize: 10, color: "var(--tg-hint)", fontWeight: 500 }}>без награды</span>}
                                        </Pressable>
                                      );
                                    })}
                                  </div>
                                </>
                              ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                  <div style={{ fontSize: 13, color: "var(--tg-hint)" }}>
                                    {(() => {
                                      const answer = bonusAnswers[bq.questionType] || (bq.questionType === "advances_team" ? p.advancesAnswer : null);
                                      const label = getBonusAnswerLabel(bq, answer, m);
                                      return label ? <>Твой ответ: <span style={{ color: "var(--tg-text)", fontWeight: 700 }}>{label}</span></> : "Ты не выбрал ответ";
                                    })()}
                                  </div>
                                  {bq.resolved && bq.correctAnswer && (() => {
                                    const userAns = bonusAnswers[bq.questionType] || (bq.questionType === "advances_team" ? p.advancesAnswer : null);
                                    const isCorrect = userAns === bq.correctAnswer;
                                    const correctOpt = options.find(o => o.key === bq.correctAnswer);
                                    const rewardStars = isStarReward ? (correctOpt?.rewardStars || 0) : 0;
                                    if (isCorrect) {
                                      return (
                                        <div style={{ fontSize: 13, color: "#34c759" }}>
                                          {rewardStars > 0 ? <>✓ Верно: <GameStarReward amount={rewardStars} size={14} /></> : "✓ Верно · без награды"}
                                        </div>
                                      );
                                    }
                                    return (
                                      <div style={{ fontSize: 13, color: "var(--tg-hint)" }}>
                                        Правильный ответ: {getBonusAnswerLabel(bq, bq.correctAnswer, m) || bq.correctAnswer}
                                      </div>
                                    );
                                  })()}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}

                    {activeQuestion?.kind === "goalscorer" && (
                      <div className="sg-pop" style={{
                        padding: "12px",
                        borderRadius: 14,
                        background: "rgba(0,0,0,0.13)",
                        border: "1px solid rgba(128,128,128,0.08)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--tg-text)" }}>
                            Автор гола
                          </div>
                          <div style={{
                            padding: "4px 8px",
                            borderRadius: 999,
                            background: "rgba(52,199,89,0.12)",
                            color: "#34c759",
                            fontSize: 11,
                            fontWeight: 800,
                            whiteSpace: "nowrap",
                          }}>
                            +2 очка
                          </div>
                        </div>

                        {!locked ? (
                          <Pressable
                            onClick={() => loadSquads(mid)}
                            disabled={!predictionsOpen}
                            style={{
                              width: "100%",
                              padding: "11px 12px",
                              borderRadius: 12,
                              border: p.goalscorerPick ? "1px solid var(--tg-button, #007aff)" : "1px solid rgba(128,128,128,0.12)",
                              background: p.goalscorerPick ? "rgba(0,122,255,0.16)" : "rgba(255,255,255,0.03)",
                              color: p.goalscorerPick ? "var(--tg-button, #007aff)" : "var(--tg-text)",
                              fontSize: 13,
                              fontWeight: 800,
                              cursor: predictionsOpen ? "pointer" : "default",
                              textAlign: "center"
                            }}
                          >
                            {p.goalscorerPick ? p.goalscorerPick.playerName : "Выбрать игрока"}
                          </Pressable>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <div style={{ fontSize: 13, color: "var(--tg-hint)" }}>
                              {p.goalscorerPick ? <>Твой выбор: <span style={{ color: "var(--tg-text)", fontWeight: 700 }}>{p.goalscorerPick.playerName}</span></> : "Ты не выбрал игрока"}
                            </div>
                            {m.goalscorerResolved && (
                              <div style={{ fontSize: 13, color: (() => {
                                const pickedNobody = p.goalscorerPick?.playerId === NO_GOALSCORER_PICK_ID;
                                const nobodyHit = pickedNobody && (!m.goalscorers || m.goalscorers.length === 0);
                                const playerHit = !!(p.goalscorerPick && m.goalscorers?.includes(p.goalscorerPick.playerId));
                                return nobodyHit || playerHit ? "#34c759" : "var(--tg-hint)";
                              })() }}>
                                {(() => {
                                  const pickedNobody = p.goalscorerPick?.playerId === NO_GOALSCORER_PICK_ID;
                                  const nobodyHit = pickedNobody && (!m.goalscorers || m.goalscorers.length === 0);
                                  const playerHit = !!(p.goalscorerPick && m.goalscorers?.includes(p.goalscorerPick.playerId));
                                  if (nobodyHit || playerHit) return `Верно: +2 очка`;
                                  if (pickedNobody && m.goalscorers?.length) return "Голы были, вариант «Никто» не подошёл";
                                  return m.goalscorers?.length ? "Твой игрок не забил" : "Голов не было";
                                })()}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {questionPages.length > 1 && (
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: "36px 1fr 36px",
                        alignItems: "center",
                        gap: 8,
                        padding: "0 2px 2px",
                      }}>
                        <Pressable
                          onClick={() => setQuestionPage(activeQuestionIndex - 1)}
                          style={{
                            width: 36,
                            height: 34,
                            borderRadius: 12,
                            border: "none",
                            background: "rgba(255,255,255,0.06)",
                            color: "var(--tg-text)",
                            fontSize: 20,
                            fontWeight: 800,
                          }}
                        >
                          ‹
                        </Pressable>
                        <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                          {questionPages.map((page, pageIndex) => {
                            const active = pageIndex === activeQuestionIndex;
                            const answered = page.kind === "bonus"
                              ? Boolean(bonusAnswers[page.question.questionType] || (page.question.questionType === "advances_team" && p.advancesAnswer))
                              : !!p.goalscorerPick;
                            return (
                              <Pressable
                                key={page.key}
                                onClick={() => setQuestionPage(pageIndex)}
                                style={{
                                  minWidth: 34,
                                  height: 34,
                                  borderRadius: 10,
                                  border: "none",
                                  background: active
                                    ? "var(--tg-button,#007aff)"
                                    : answered
                                      ? "rgba(52,199,89,0.16)"
                                      : "rgba(255,255,255,0.07)",
                                  color: active
                                    ? "var(--tg-button-text,#fff)"
                                    : answered
                                      ? "#34c759"
                                      : "var(--tg-text)",
                                  fontSize: 13,
                                  fontWeight: 900,
                                }}
                              >
                                {answered ? "✓" : pageIndex + 1}
                              </Pressable>
                            );
                          })}
                        </div>
                        <Pressable
                          onClick={() => setQuestionPage(activeQuestionIndex + 1)}
                          style={{
                            width: 36,
                            height: 34,
                            borderRadius: 12,
                            border: "none",
                            background: "rgba(255,255,255,0.06)",
                            color: "var(--tg-text)",
                            fontSize: 20,
                            fontWeight: 800,
                          }}
                        >
                          ›
                        </Pressable>
                      </div>
                    )}
                    </div>
                  </>,
                  document.body,
                )}
              </div>
            )}

            {/* Per-card save button for unlocked matches */}
            {!locked && (
              <div style={{
                padding: "8px 16px 12px 16px",
                display: "flex", justifyContent: "center"
              }}>
                <Pressable
                  className={`${saveStatus === 'saved' ? 'sg-save-success' : ''} ${isDirty ? 'sg-primary-action' : ''}`.trim()}
                  onClick={handleCardSave}
                  disabled={!predictionsOpen || saveStatus === 'saving' || saveStatus === 'saved'}
                  style={{
                    width: "100%",
                    padding: "10px 0",
                    borderRadius: 12,
                    border: "none",
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: !predictionsOpen || saveStatus === 'saving' || saveStatus === 'saved' ? "default" : "pointer",
                    background: saveStatus === 'saved'
                      ? "rgba(52, 199, 89, 0.15)"
                      : saveStatus === 'error'
                        ? "rgba(255, 59, 48, 0.15)"
                        : !predictionsOpen
                          ? "rgba(128,128,128,0.1)"
                        : isDirty
                          ? "var(--tg-button, #007aff)"
                          : "rgba(128,128,128,0.1)",
                    color: saveStatus === 'saved'
                      ? "#34c759"
                      : saveStatus === 'error'
                        ? "#ff3b30"
                        : isDirty
                          ? "var(--tg-button-text, #fff)"
                          : "var(--tg-hint)",
                    transition: "all 0.2s"
                  }}
                >
                  {saveStatus === 'saving' ? "Сохранение…"
                    : saveStatus === 'saved' ? "✓ Сохранено"
                      : saveStatus === 'error' ? "Ошибка, попробуйте снова"
                        : isDirty ? "Сохранить"
                          : sp ? "✓ Сохранено" : "Сохранить"}
                </Pressable>
              </div>
            )}

            {/* Double Chance variant picker */}
            {dcPickerMatchId === mid && canEdit && (
              <div style={{
                padding: '8px 16px 12px',
                display: 'flex', justifyContent: 'center', gap: 8,
                background: 'rgba(0,122,255,0.05)',
                borderTop: '1px solid rgba(0,122,255,0.1)',
              }}>
                <span style={{ color: 'var(--tg-hint)', alignSelf: 'center', marginRight: 4, display: "inline-flex" }}><BoostIcon name="double_chance" size={22} /></span>
                {['1X', 'X2', '12'].map(v => (
                  <Pressable
                    key={v}
                    onClick={() => {
                      setConfirmDc({ matchId: mid, variant: v });
                      setDcPickerMatchId(null);
                    }}
                    style={{
                      background: 'var(--tg-button, #007aff)',
                      color: 'var(--tg-button-text, #fff)',
                      border: 'none', borderRadius: 10,
                      padding: '6px 16px',
                      fontSize: 13, fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {v}
                  </Pressable>
                ))}
                <Pressable
                  onClick={() => setDcPickerMatchId(null)}
                  style={{
                    background: 'rgba(128,128,128,0.15)',
                    color: 'var(--tg-hint)',
                    border: 'none', borderRadius: 10,
                    padding: '6px 12px',
                    fontSize: 12, cursor: 'pointer',
                  }}
                >
                  ✕
                </Pressable>
              </div>
            )}

            {/* If locked, show details and Friend Picks button */}
            {locked && (
              <div style={{
                padding: "10px 16px",
                borderTop: "1px solid var(--tg-separator, rgba(128,128,128,0.1))",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                background: "var(--tg-secondary-bg)", // slight contrast for footer
                borderBottomLeftRadius: 16, borderBottomRightRadius: 16
              }}>
                <div style={{ fontSize: 13, color: "var(--tg-hint)", display: "flex", alignItems: "center", gap: 8 }}>
                  {picks[mid] ? (
                    <div>
                      <span style={{ opacity: 0.8 }}>Ты ставил:</span> <span style={{ color: "var(--tg-text)", fontWeight: 500 }}>{p.home}:{p.away}</span>
                    </div>
                  ) : (
                    <div style={{ opacity: 0.8 }}>Ты не ставил</div>
                  )}

                  {/* Friend Picks Button */}
                  <Pressable onClick={() => loadFriendPicks(mid)} style={{
                    display: "flex", alignItems: "center", gap: 4,
                    background: "var(--tg-button)", color: "var(--tg-button-text)",
                    border: "none", borderRadius: 12, padding: "4px 10px",
                    fontSize: 11, fontWeight: 600, cursor: "pointer",
                    marginLeft: 8
                  }}>
                    👥 Друзья
                  </Pressable>
                </div>
                <div style={{
                  fontSize: 14, fontWeight: 700,
                  color: (pts?.total ?? 0) > 0 ? "#34c759" : "var(--tg-hint)"
                }}>
                  {picks[mid] ? (
                    <>
                      {(pts?.total ?? 0) > 0 ? `+${pts?.total} ${pluralRu(pts?.total ?? 0, "очко", "очка", "очков")}` : (r ? "0" : "")}
                      {p.isJoker && <span style={{ display: "inline-flex", verticalAlign: "middle", marginLeft: 4 }}><BoostIcon name="joker" size={14} /></span>}
                    </>
                  ) : (
                    <span>-</span>
                  )}
                </div>
              </div>
            )}

            {/* Admin */}
            {isAdmin && canEditScore && (
              <div style={{ padding: 12, borderTop: "1px dashed var(--tg-hint)", display: "flex", gap: 8, justifyContent: "center" }}>
                <span style={{ fontSize: 10 }}>ADMIN</span>
                <Stepper value={adminH} onChange={(v) => onAdminSetResult(mid, v, adminA)} />
                <Stepper value={adminA} onChange={(v) => onAdminSetResult(mid, adminH, v)} />
                <Pressable onClick={() => onAdminSaveResult(mid)}>OK</Pressable>
              </div>
            )}
          </MotionCard>
        );
      })}

      {/* Friend Picks Modal */}
      {friendPicksMatchId && (
        <BottomSheet
          title="Прогнозы друзей"
          maxHeight="80vh"
          onClose={closeFriendPicks}
        >
            {/* Content */}
            <div style={{ padding: 0 }}>
              {loadingFriends ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--tg-hint)" }}>Загрузка…</div>
              ) : (friendPicksData.length === 0 ? (
                <div style={{ textAlign: "center", padding: 20, color: "var(--tg-hint)" }}>Никто из твоих лиг ещё не сделал прогноз</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                  {friendPicksData.map(group => (
                    <div key={group.leagueId}>
                      <div style={{
                        fontSize: 13, textTransform: "uppercase",
                        color: "var(--tg-hint)", fontWeight: 700,
                        marginBottom: 8, paddingLeft: 4
                      }}>
                        {group.leagueName}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {group.members.map(m => (
                          <div key={m.userId} style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            background: "var(--tg-secondary-bg)",
                            padding: "10px 12px", borderRadius: 10
                          }}>
                            <div style={{ fontWeight: 500, color: "var(--tg-text)" }}>
                              {m.name}
                            </div>
                            <div style={{
                              fontWeight: 700, color: m.isHidden ? "var(--tg-hint)" : "var(--tg-text)",
                              display: "flex", alignItems: "center", gap: 4
                            }}>
                              {m.isHidden ? "👀 Скрыто" : `${m.home}:${m.away}`}
                              {m.isJoker && <BoostIcon name="joker" size={14} />}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
        </BottomSheet>
      )}

      {/* Confirmation Modals */}
      {(confirmDc || confirmExtraJokerMatchId || cancelExtraJokerMatchId) && (
        <ActionDialog
          cancelLabel={cancelExtraJokerMatchId ? 'Назад' : 'Отмена'}
          confirmDestructive={!!cancelExtraJokerMatchId}
          confirmLabel={cancelExtraJokerMatchId ? 'Снять' : 'Подтвердить'}
          onCancel={() => {
            setConfirmDc(null);
            setConfirmExtraJokerMatchId(null);
            setCancelExtraJokerMatchId(null);
          }}
          onConfirm={async () => {
            if (confirmDc) {
              const dcBoost = availableBoosts?.find(b => b.type === 'double_chance');
              if (dcBoost && onApplyBoost) {
                await onApplyBoost(dcBoost.id, confirmDc.matchId, confirmDc.variant);
              }
              setConfirmDc(null);
            } else if (confirmExtraJokerMatchId) {
              onSetJoker(confirmExtraJokerMatchId);
              setConfirmExtraJokerMatchId(null);
            } else if (cancelExtraJokerMatchId) {
              onSetJoker(cancelExtraJokerMatchId);
              setCancelExtraJokerMatchId(null);
            }
          }}
          title={
            cancelExtraJokerMatchId
              ? 'Отменить дополнительный джокер'
              : confirmDc
                ? 'Подтвердить использование двойного шанса'
                : 'Подтвердить использование доп. джокера'
          }
        >
          {cancelExtraJokerMatchId
            ? 'Снять дополнительный джокер с этого матча? После отмены можно будет выбрать другой матч в рамках доступных ограничений.'
            : confirmDc
              ? 'Использовать двойной шанс на этот матч? После подтверждения буст применится к выбранному матчу.'
              : 'Использовать дополнительный джокер на этот матч? После подтверждения буст применится к выбранному матчу.'}
        </ActionDialog>
      )}

      {/* Goalscorer Selection Modal */}
      {gsPickerMatchId && (
        <BottomSheet title="Выбери автора гола" maxHeight="85vh" onClose={closeGsPicker}>
            <div style={{ padding: 0 }}>
              {loadingGs ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--tg-hint)" }}>Загрузка составов…</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div>
                    <div style={{
                      fontSize: 13, fontWeight: 700, color: "var(--tg-hint)",
                      marginBottom: 10, paddingBottom: 8,
                      borderBottom: "1px solid var(--tg-separator, rgba(128,128,128,0.1))"
                    }}>
                      Быстрый выбор
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                      <Pressable
                        disabled={savingGs}
                        onClick={() => handleSelectGoalscorer(gsPickerMatchId, NO_GOALSCORER_PICK_ID, NO_GOALSCORER_PICK_LABEL)}
                        style={{
                          textAlign: "left",
                          padding: "11px 14px",
                          borderRadius: 12,
                          border: "1px solid rgba(128,128,128,0.1)",
                          background: "rgba(255,149,0,0.08)",
                          color: "var(--tg-text, #000)",
                          fontSize: 14, fontWeight: 700,
                          cursor: savingGs ? "default" : "pointer",
                          opacity: savingGs ? 0.6 : 1
                        }}
                      >
                        Никто не забьёт
                      </Pressable>
                    </div>
                  </div>

                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 12,
                    alignItems: "start"
                  }}>
                    {[
                      { team: matches.find(m => m.id === gsPickerMatchId)?.home, squad: gsData.home },
                      { team: matches.find(m => m.id === gsPickerMatchId)?.away, squad: gsData.away }
                    ].map(({ team, squad }, i) => (
                    <div key={i} style={{
                      minWidth: 0,
                      background: "rgba(128,128,128,0.04)",
                      border: "1px solid rgba(128,128,128,0.08)",
                      borderRadius: 14,
                      padding: 10
                    }}>
                      <div style={{
                        fontSize: 12, fontWeight: 800, color: "var(--tg-text)",
                        marginBottom: 10, paddingBottom: 8,
                        borderBottom: "1px solid var(--tg-separator, rgba(128,128,128,0.1))",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis"
                      }}>
                        {team}
                      </div>
                      {squad.length === 0 ? (
                        <div style={{ fontSize: 12, lineHeight: 1.35, color: "var(--tg-hint)" }}>
                          Список игроков пока недоступен.
                        </div>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
                          {squad.map(p => (
                            <Pressable
                              key={p.id}
                              disabled={savingGs}
                              onClick={() => handleSelectGoalscorer(gsPickerMatchId, p.id, p.name)}
                              style={{
                                textAlign: "left",
                                padding: "10px 12px",
                                borderRadius: 10,
                                border: "1px solid rgba(128,128,128,0.1)",
                                background: "rgba(128,128,128,0.05)",
                                color: "var(--tg-text, #000)",
                                fontSize: 13, fontWeight: 500,
                                cursor: savingGs ? "default" : "pointer",
                                opacity: savingGs ? 0.6 : 1,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis"
                              }}
                            >
                              {p.name}
                            </Pressable>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  </div>
                </div>
              )}
            </div>
        </BottomSheet>
      )}
    </>
  );
}

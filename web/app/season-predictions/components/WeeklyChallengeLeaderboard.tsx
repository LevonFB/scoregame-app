"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Pressable } from "@/app/components/ui/Pressable";
import type { WeeklyLeaderboardEntry, WeeklyLeaderboardResponse } from "../types";

const ACCENT = "#ff8a3c";
const DONE = "#2ec060";
const META_COLOR = "color-mix(in srgb, var(--tg-text) 58%, var(--tg-hint))";
const CARD_SURFACE = "linear-gradient(180deg, color-mix(in srgb, var(--tg-secondary-bg) 90%, var(--tg-bg)), color-mix(in srgb, var(--tg-bg) 84%, var(--tg-secondary-bg)))";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const PAGE_SIZE = 20;

// W5: public weekly leaderboard. Read-only — никаких наград здесь не выдаётся.
export function WeeklyChallengeLeaderboard({ challengeId }: { challengeId: number }) {
  const [data, setData] = useState<WeeklyLeaderboardResponse | null>(null);
  const [rows, setRows] = useState<WeeklyLeaderboardEntry[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await apiFetch<WeeklyLeaderboardResponse>(`/season-predictions/weekly-challenges/${challengeId}/leaderboard?page=${page}&limit=${PAGE_SIZE}`);
        if (!active) return;
        setData(res);
        setRows((prev) => (page === 1 ? res.leaderboard : [...prev, ...res.leaderboard]));
      } catch (e) {
        if (active) setError(getErrorMessage(e, "Не удалось загрузить рейтинг"));
      } finally {
        if (active) setLoading(false);
      }
    };
    void run();
    return () => { active = false; };
  }, [challengeId, page]);

  if (loading && rows.length === 0) {
    return <div style={emptyBox}>Загрузка рейтинга…</div>;
  }
  if (error && rows.length === 0) {
    return (
      <div style={emptyBox}>
        <div style={{ color: "var(--tg-destructive, #ff453a)", fontWeight: 750, marginBottom: 8 }}>{error}</div>
        <Pressable onClick={() => setPage(1)} haptic="light" style={moreBtnStyle}>Повторить</Pressable>
      </div>
    );
  }
  if (data && data.pagination.total === 0) {
    return <div style={emptyBox}>В рейтинге пока никого нет.</div>;
  }

  const meKey = data?.me?.profile_key ?? null;
  const hasMore = data ? data.pagination.page < data.pagination.pages : false;
  const meOnPage = meKey != null && rows.some((r) => r.profile_key === meKey);

  return (
    <section style={cardStyle}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <h2 style={titleStyle}>Рейтинг недели</h2>
        {data && <span style={{ fontSize: 11, fontWeight: 800, color: META_COLOR }}>{data.pagination.total} участников</span>}
      </div>

      {data?.challenge.results_stale && (
        <div style={staleBannerStyle}>Результаты обновляются — рейтинг ещё не финальный.</div>
      )}

      {/* Own place pinned on top if outside the current page */}
      {data?.me && !meOnPage && (
        <div style={{ marginTop: 8 }}>
          <Row entry={{ rank: data.me.rank, profile_key: data.me.profile_key, display_name: "Ты", avatar_url: null, total_points: data.me.total_points, max_points: data.me.max_points, points_pct: data.me.points_pct, submitted_at: null, scored_at: null }} isMe />
        </div>
      )}

      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
        {rows.map((r) => <Row key={r.profile_key ?? r.rank} entry={r} isMe={meKey != null && r.profile_key === meKey} />)}
      </div>

      {hasMore && (
        <Pressable onClick={() => setPage((p) => p + 1)} haptic="light" disabled={loading} style={moreBtnStyle}>
          {loading ? "Загрузка…" : "Показать ещё"}
        </Pressable>
      )}
    </section>
  );
}

function Row({ entry, isMe }: { entry: WeeklyLeaderboardEntry; isMe: boolean }) {
  return (
    <div style={rowStyle(isMe)}>
      <span style={rankBadgeStyle(entry.rank)}>{entry.rank}</span>
      <span style={avatarStyle}>
        {entry.avatar_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={entry.avatar_url} alt="" width={28} height={28} style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
          : <span aria-hidden style={{ fontSize: 13, fontWeight: 900, color: META_COLOR }}>{(entry.display_name || "?").slice(0, 1).toUpperCase()}</span>}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 850, color: "var(--tg-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {entry.display_name}{isMe ? " · ты" : ""}
      </span>
      <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 950, color: "var(--tg-text)" }}>
        {entry.total_points}<span style={{ fontSize: 11, fontWeight: 700, color: META_COLOR }}>/{entry.max_points}</span>
      </span>
    </div>
  );
}

const cardStyle = {
  borderRadius: 18,
  padding: "12px 14px",
  background: CARD_SURFACE,
  border: "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)",
  boxShadow: "0 8px 22px color-mix(in srgb, var(--tg-text) 12%, transparent), inset 0 1px 0 color-mix(in srgb, var(--tg-text) 7%, transparent)",
  color: "var(--tg-text)",
} as const;

const titleStyle = { margin: 0, fontSize: 13, fontWeight: 900, letterSpacing: 0 } as const;

const emptyBox = {
  borderRadius: 18,
  padding: 16,
  background: CARD_SURFACE,
  border: "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)",
  color: "var(--tg-hint)",
  fontSize: 13,
  fontWeight: 750,
  textAlign: "center" as const,
} as const;

const staleBannerStyle = {
  marginTop: 8,
  padding: "8px 11px",
  borderRadius: 11,
  background: "color-mix(in srgb, #ffb020 12%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, #ffb020 22%, transparent)",
  color: "color-mix(in srgb, #ffb020 84%, var(--tg-text))",
  fontSize: 12,
  fontWeight: 750,
  lineHeight: 1.4,
} as const;

function rowStyle(isMe: boolean) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 9,
    minHeight: 44,
    padding: "6px 9px",
    borderRadius: 11,
    background: isMe ? `color-mix(in srgb, ${ACCENT} 12%, var(--tg-bg))` : "color-mix(in srgb, var(--tg-secondary-bg) 56%, transparent)",
    border: isMe ? `1px solid color-mix(in srgb, ${ACCENT} 38%, transparent)` : "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)",
  } as const;
}

function rankBadgeStyle(rank: number) {
  const top = rank <= 3;
  return {
    flexShrink: 0,
    minWidth: 26,
    height: 26,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    fontSize: 12.5,
    fontWeight: 950,
    color: top ? DONE : META_COLOR,
    background: top ? "color-mix(in srgb, #34c759 14%, var(--tg-bg))" : "color-mix(in srgb, var(--tg-hint) 10%, transparent)",
  } as const;
}

const avatarStyle = {
  flexShrink: 0,
  width: 28,
  height: 28,
  borderRadius: "50%",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "color-mix(in srgb, var(--tg-hint) 14%, var(--tg-bg))",
  overflow: "hidden",
} as const;

const moreBtnStyle = {
  marginTop: 10,
  width: "100%",
  minHeight: 40,
  borderRadius: 12,
  border: "1px solid color-mix(in srgb, var(--tg-hint) 16%, transparent)",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 66%, var(--tg-bg))",
  color: "var(--tg-text)",
  fontSize: 13,
  fontWeight: 850,
  cursor: "pointer",
} as const;

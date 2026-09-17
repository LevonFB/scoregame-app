"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import UserAvatar from "./UserAvatar";
import { getPublicDisplayName } from "@/lib/publicIdentity";
import { AppIcon } from "./ui/AppIcon";

type UserProfile = {
  telegramUsername?: string | null;
  profileKey: string;
  displayName: string;
  nickname: string;
  photoUrl: string | null;
  totalStars: number;
  points: number;
  seasonPoints?: number;
  rank: number | null;
  streak: number;
  primaryLeague?: { id: string; type: "channel" | "private" | "global"; title: string; avatar_url: string | null; user_rank: number | null } | null;
  leagues?: Array<{ id: string; type: "channel" | "private" | "global"; title: string; avatar_url: string | null; user_rank: number | null }>;
};

type Props = { profileKey: string; onClose: () => void };

function leagueEmoji(type: string, size = 16) {
  if (type === "global") return "🌍";
  if (type === "channel") return <AppIcon name="league_channel" size={size} />;
  return <AppIcon name="league_private" size={size} />;
}

function LeagueIcon({
  type,
  avatarUrl,
  size,
  radius,
  iconSize = Math.round(size * 0.72),
}: {
  type: string;
  avatarUrl?: string | null;
  size: number;
  radius: number;
  iconSize?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt=""
        onError={() => setFailed(true)}
        style={{ width: size, height: size, borderRadius: radius, objectFit: "cover", flexShrink: 0 }}
      />
    );
  }

  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: "rgba(128,128,128,0.2)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontSize: Math.round(size * 0.5),
        lineHeight: 1,
      }}
    >
      {leagueEmoji(type, iconSize)}
    </span>
  );
}

function GameStarAmount({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
      <span>{value}</span>
      <AppIcon name="game_star" size={size} />
    </span>
  );
}

export default function UserProfileScreen({ profileKey, onClose }: Props) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiFetch<{ ok: boolean; user: UserProfile }>(`/users/profile/${encodeURIComponent(profileKey)}`)
      .then((res) => {
        if (res.ok) setProfile(res.user);
        else setError("Профиль не найден");
      })
      .catch(() => setError("Ошибка загрузки профиля"))
      .finally(() => setLoading(false));
  }, [profileKey]);

  const displayName = profile ? getPublicDisplayName(profile, "Игрок") : "Игрок";
  const telegramUsername = profile?.telegramUsername;

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--tg-secondary-bg)", zIndex: 60, overflowY: "auto", color: "var(--tg-text)" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--tg-secondary-bg)", borderBottom: "0.5px solid var(--tg-separator, rgba(128,128,128,0.1))" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}><AppIcon name="profile" size={26} loading="eager" /><span style={{ fontSize: 20, fontWeight: 700 }}>Профиль</span></div>
        <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 16, background: "var(--tg-bg)", border: "none", color: "var(--tg-hint)", cursor: "pointer" }}>✕</button>
      </div>

      <div style={{ padding: 16, paddingBottom: 100 }}>
        {loading ? <div style={{ textAlign: "center", padding: 40, color: "var(--tg-hint)" }}>Загрузка…</div> : error ? <div style={{ textAlign: "center", padding: 40, color: "var(--tg-hint)" }}>{error}</div> : profile ? <>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 16 }}>
            <UserAvatar photoUrl={profile.photoUrl} name={displayName} size={68} />
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8 }}>{displayName}</div>
            {/* Telegram Username — shown only if the backend provides it (shared league exists, toggle is off) */}
            {telegramUsername && (
              <div style={{
                marginTop: 6, padding: "4px 10px", borderRadius: 10,
                background: "rgba(0,136,204,0.08)", fontSize: 13,
                color: "var(--tg-link, #007aff)",
                display: "flex", alignItems: "center", gap: 5,
              }}>
                <span style={{ fontSize: 14 }}>✈️</span>
                <span style={{ fontWeight: 500 }}>@{telegramUsername}</span>
              </div>
            )}
            {profile.primaryLeague && <div style={{ marginTop: 8, padding: "4px 10px", borderRadius: 12, background: "rgba(128,128,128,0.1)", fontSize: 13, color: "var(--tg-hint)", display: "flex", alignItems: "center", gap: 6 }}>
              <LeagueIcon type={profile.primaryLeague.type} avatarUrl={profile.primaryLeague.avatar_url} size={16} radius={4} iconSize={14} />
              <span style={{ maxWidth: 180, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontWeight: 500 }}>{profile.primaryLeague.title}</span>
            </div>}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <div style={{ flex: "1 1 calc(50% - 6px)", background: "var(--tg-bg)", borderRadius: 16, padding: "16px 12px", textAlign: "center" }}>
              <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: 32, marginBottom: 4 }}>
                <AppIcon name="prediction_accuracy" size={32} />
              </div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{profile.seasonPoints ?? profile.points}</div>
              <div style={{ fontSize: 12, color: "var(--tg-hint)", marginTop: 4 }}>Очки за сезон</div>
            </div>
            <div style={{ flex: "1 1 calc(50% - 6px)", background: "var(--tg-bg)", borderRadius: 16, padding: "16px 12px", textAlign: "center" }}>
              <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: 32, marginBottom: 4 }}>
                <AppIcon name="streak_fire" size={32} />
              </div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{profile.streak ?? 0}</div>
              <div style={{ fontSize: 12, color: "var(--tg-hint)", marginTop: 4 }}>Серия дней</div>
            </div>
          </div>

          {!!profile.leagues?.length && <div style={{ background: "var(--tg-bg)", borderRadius: 16, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 18, marginBottom: 12 }}>
              <AppIcon name="leagues" size={24} />
              <span>Лиги игрока</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {profile.leagues.map((league) => <div key={league.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(128,128,128,0.05)", padding: 12, borderRadius: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, overflow: "hidden" }}>
                  <LeagueIcon type={league.type} avatarUrl={league.avatar_url} size={32} radius={8} iconSize={24} />
                  <div style={{ fontWeight: 600, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{league.title}</div>
                </div>
                <div style={{ fontWeight: 800, fontSize: 16, color: "var(--tg-theme-button-color, #007aff)" }}>{league.user_rank ? `#${league.user_rank}` : "—"}</div>
              </div>)}
            </div>
          </div>}
        </> : null}
      </div>
    </div>
  );
}

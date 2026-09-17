"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import UserAvatar from "./UserAvatar";
import { getPublicDisplayName } from "@/lib/publicIdentity";
import ProfileSettingsScreen from "./ProfileSettingsScreen";
import ReferralCard from "./ReferralCard";
import { AppIcon } from "./ui/AppIcon";

type Props = {
  onClose: () => void;
  onOpenAchievements: () => void;
  onOpenShop?: () => void;
  onProfileUpdated?: (user: any) => void;
  balls?: number;
  me: any;
  embedded?: boolean;
};

const card = {
  background: "var(--tg-bg)",
  borderRadius: 16,
  border: "1px solid rgba(128,128,128,0.08)",
} as const;

function surfaceText(error: unknown, fallback: string) {
  const raw = String(error ?? "").split(" | url=")[0].trim();
  return raw || fallback;
}

function daysWord(n: number) {
  if (n % 10 === 1 && n % 100 !== 11) return "день";
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return "дня";
  return "дней";
}

function GameStarAmount({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
      <span>{value}</span>
      <AppIcon name="game_star" size={size} />
    </span>
  );
}

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

export default function ProfileScreen({
  onClose,
  onProfileUpdated,
  embedded = false,
}: Props) {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadProfile = () => {
    setLoading(true);
    apiFetch<any>("/me/profile")
      .then((res) => {
        if (res.ok && res.user) setProfile(res.user);
      })
      .catch((e) => setErrorMessage(surfaceText(e, "Не удалось загрузить профиль.")))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const displayName = getPublicDisplayName(profile || {}, "Игрок");
  const seasonPoints = Number(profile?.seasonPoints ?? profile?.points ?? 0);
  const streak = Number(profile?.streak ?? 0);

  const seasonEndMs = profile?.seasonEnd ? new Date(profile.seasonEnd).getTime() : NaN;
  const daysLeft = Number.isFinite(seasonEndMs) ? Math.max(0, Math.ceil((seasonEndMs - Date.now()) / 86400000)) : null;

  if (showSettings) {
    return (
      <ProfileSettingsScreen
        onBack={() => {
          setShowSettings(false);
          loadProfile();
        }}
        onProfileUpdated={(user) => {
          setProfile(user);
          onProfileUpdated?.(user);
        }}
      />
    );
  }

  return (
    <div
      style={{
        position: embedded ? "relative" : "fixed",
        inset: embedded ? undefined : 0,
        background: embedded ? "transparent" : "var(--tg-secondary-bg)",
        zIndex: embedded ? "auto" : 50,
        overflowY: embedded ? "visible" : "auto",
        color: "var(--tg-text)",
      }}
    >
      <div
        style={{
          position: embedded ? "relative" : "sticky",
          top: 0,
          zIndex: 10,
          padding: "12px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: embedded ? "transparent" : "var(--tg-secondary-bg)",
          borderBottom: embedded ? "none" : "0.5px solid var(--tg-separator, rgba(128,128,128,0.1))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <AppIcon name="profile" size={26} loading="eager" />
          <span style={{ fontSize: 20, fontWeight: 700 }}>Профиль</span>
        </div>
        {embedded ? (
          <div style={{ width: 32, height: 32 }} />
        ) : (
          <button
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              border: "none",
              background: "var(--tg-bg)",
              color: "var(--tg-hint)",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        )}
      </div>

      <div style={{ padding: 16, paddingBottom: embedded ? 16 : 100 }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--tg-hint)" }}>Загрузка…</div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 16 }}>
              <UserAvatar photoUrl={profile?.photoUrl} name={displayName} size={68} />
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8, textAlign: "center" }}>{displayName}</div>
              {profile?.primaryLeague && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "4px 10px",
                    borderRadius: 12,
                    background: "rgba(128,128,128,0.1)",
                    fontSize: 13,
                    color: "var(--tg-hint)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <LeagueIcon type={profile.primaryLeague.type} avatarUrl={profile.primaryLeague.avatar_url} size={16} radius={4} iconSize={14} />
                  <span
                    style={{
                      maxWidth: 180,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                      fontWeight: 500,
                    }}
                  >
                    {profile.primaryLeague.title}
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={() => setShowSettings(true)}
              style={{
                ...card,
                width: "100%",
                padding: 16,
                marginBottom: 16,
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 28 }}>⚙️</span>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: "var(--tg-text)" }}>Настроить профиль</div>
                  <div style={{ fontSize: 13, color: "var(--tg-hint)", marginTop: 2 }}>Имя из Telegram, аватарка и приватность</div>
                </div>
              </div>
              <span style={{ fontSize: 18, color: "var(--tg-hint)" }}>›</span>
            </button>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
              <div style={{ ...card, flex: "1 1 calc(50% - 6px)", padding: "12px 8px", textAlign: "center" }}>
                <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: 32 }}>
                  <AppIcon name="prediction_accuracy" size={32} />
                </div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{seasonPoints}</div>
                <div style={{ fontSize: 12, color: "var(--tg-hint)" }}>Очки за сезон</div>
              </div>
              <div style={{ ...card, flex: "1 1 calc(50% - 6px)", padding: "12px 8px", textAlign: "center" }}>
                <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: 32 }}>
                  <AppIcon name="streak_fire" size={32} />
                </div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{streak}</div>
                <div style={{ fontSize: 12, color: "var(--tg-hint)" }}>Серия дней</div>
              </div>
            </div>

            <ReferralCard meId={Number(profile?.id) || null} />

            {!!profile?.leagues?.length && (
              <div style={{ ...card, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 18, marginBottom: 12 }}>
                  <AppIcon name="leagues" size={24} />
                  <span>Мои лиги</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {profile.leagues.map((lg: any) => (
                    <div
                      key={lg.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: "rgba(128,128,128,0.05)",
                        padding: 12,
                        borderRadius: 12,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10, overflow: "hidden" }}>
                        <LeagueIcon type={lg.type} avatarUrl={lg.avatar_url} size={32} radius={8} iconSize={24} />
                        <div style={{ fontWeight: 600, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {lg.title}
                        </div>
                      </div>
                      <div style={{ fontWeight: 800, fontSize: 16, color: "var(--tg-theme-button-color, #007aff)" }}>
                        {lg.user_rank ? `#${lg.user_rank}` : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {errorMessage && <div style={{ marginTop: 12, fontSize: 13, textAlign: "center", color: "#ff3b30" }}>{errorMessage}</div>}
          </>
        )}
      </div>
    </div>
  );
}

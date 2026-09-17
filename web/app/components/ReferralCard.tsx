"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type Milestone = { count: number; reward_label: string; achieved: boolean };
type ReferralsResponse = {
  ok: boolean;
  enabled: boolean;
  link: string | null;
  pending: number;
  activated: number;
  invitee_reward_label: string;
  per_friend_reward_label: string;
  milestones: Milestone[];
};

// Client-side fallback mirrors the server link format (ref code = base36 of the
// telegram id) so the share button works even while /referrals is loading.
export function buildClientReferralLink(userId: number | null | undefined): string | null {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return `https://t.me/scoregameee_Bot?startapp=ref_${id.toString(36)}`;
}

export function openReferralShare(link: string) {
  const text = "Спорим, я угадываю счета лучше тебя? Заходи, проверим — за первый прогноз ещё и фартовый жетон дают ⚽";
  const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  const tg = (window as unknown as { Telegram?: { WebApp?: { openTelegramLink?: (u: string) => void } } }).Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, "_blank");
}

const card = {
  background: "var(--tg-bg)",
  borderRadius: 16,
  border: "1px solid rgba(128,128,128,0.08)",
} as const;

export default function ReferralCard({ meId }: { meId?: number | null }) {
  const [data, setData] = useState<ReferralsResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiFetch<ReferralsResponse>("/referrals")
      .then((res) => { if (res?.ok) setData(res); else setFailed(true); })
      .catch(() => setFailed(true));
  }, []);

  if (failed || (data && !data.enabled)) return null;

  const link = data?.link || buildClientReferralLink(meId);
  const activated = data?.activated ?? 0;
  const pending = data?.pending ?? 0;
  const nextMilestone = data?.milestones.find((m) => !m.achieved) || null;

  return (
    <div style={{ ...card, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
        <span style={{ fontSize: 22 }}>🎁</span>
        <span>Пригласи друга</span>
      </div>

      <div style={{ fontSize: 13, lineHeight: 1.45, color: "var(--tg-hint)", marginBottom: 12 }}>
        {data
          ? <>Друг получит <b style={{ color: "var(--tg-text)" }}>{data.invitee_reward_label.toLowerCase()}</b> за первый прогноз, а ты — <b style={{ color: "var(--tg-text)" }}>{data.per_friend_reward_label.toLowerCase()}</b> за каждого активного друга.</>
          : "Загрузка…"}
      </div>

      {data && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1, background: "rgba(128,128,128,0.07)", borderRadius: 12, padding: "10px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{activated}</div>
            <div style={{ fontSize: 11, color: "var(--tg-hint)" }}>активировано</div>
          </div>
          <div style={{ flex: 1, background: "rgba(128,128,128,0.07)", borderRadius: 12, padding: "10px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{pending}</div>
            <div style={{ fontSize: 11, color: "var(--tg-hint)" }}>ждут первого прогноза</div>
          </div>
        </div>
      )}

      {!!data?.milestones.length && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {data.milestones.map((m) => (
            <div key={m.count} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: m.achieved ? "var(--tg-text)" : "var(--tg-hint)", fontWeight: m.achieved ? 700 : 500 }}>
                {m.achieved ? "✅" : "🔒"} {m.count} {m.count === 1 ? "друг" : m.count < 5 ? "друга" : "друзей"}
              </span>
              <span style={{ color: m.achieved ? "#34c759" : "var(--tg-hint)", fontWeight: 700 }}>{m.reward_label}</span>
            </div>
          ))}
          {nextMilestone && (
            <div style={{ fontSize: 12, color: "var(--tg-hint)", marginTop: 2 }}>
              До следующей награды: ещё {Math.max(0, nextMilestone.count - activated)}
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => link && openReferralShare(link)}
        disabled={!link}
        style={{
          width: "100%", minHeight: 46, borderRadius: 14, border: "none",
          background: "var(--tg-button)", color: "var(--tg-button-text)",
          fontSize: 15, fontWeight: 800, cursor: link ? "pointer" : "default", opacity: link ? 1 : 0.6,
        }}
      >
        Поделиться ссылкой
      </button>
    </div>
  );
}

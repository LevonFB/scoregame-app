"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch, setApiInitData } from "@/lib/api";
import UserAvatar from "./UserAvatar";
import { getPublicDisplayName } from "@/lib/publicIdentity";

type Props = {
  onBack: () => void;
  onProfileUpdated?: (user: any) => void;
};

type NoticeTone = "success" | "error";

const cardStyle = {
  background: "var(--tg-bg)",
  borderRadius: 16,
  border: "1px solid rgba(128,128,128,0.08)",
} as const;

function surfaceText(error: unknown, fallback: string) {
  const raw = String(error ?? "").split(" | url=")[0].trim();
  return raw || fallback;
}

function ToggleRow({
  title,
  description,
  checked,
  onToggle,
}: {
  title: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        width: "100%",
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid rgba(128,128,128,0.12)",
        background: "var(--tg-secondary-bg)",
        color: "var(--tg-text)",
        cursor: "pointer",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        textAlign: "left",
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--tg-hint)", marginTop: 2 }}>{description}</div>
      </div>
      <div
        style={{
          minWidth: 52,
          height: 30,
          borderRadius: 999,
          flexShrink: 0,
          background: checked ? "var(--tg-button)" : "rgba(128,128,128,0.18)",
          position: "relative",
          transition: "background 0.2s",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 25 : 3,
            width: 24,
            height: 24,
            borderRadius: 12,
            background: "#fff",
            transition: "left 0.2s",
            boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
          }}
        />
      </div>
    </button>
  );
}

export default function ProfileSettingsScreen({ onBack, onProfileUpdated }: Props) {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [avatarHiddenDraft, setAvatarHiddenDraft] = useState(false);
  const [telegramUsernameHiddenDraft, setTelegramUsernameHiddenDraft] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [botPmBusy, setBotPmBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    apiFetch<any>("/me/profile")
      .then((res) => {
        if (cancelled || !res.ok || !res.user) return;
        setProfile(res.user);
        setAvatarHiddenDraft(!!res.user.settings?.avatarHidden);
        setTelegramUsernameHiddenDraft(!!res.user.settings?.telegramUsernameHidden);
      })
      .catch((error) => {
        if (!cancelled) {
          setNotice({ tone: "error", text: surfaceText(error, "Не удалось загрузить настройки профиля.") });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const displayName = getPublicDisplayName(profile || {}, "Игрок");
  const settingsDirty =
    !!profile?.settings &&
    (avatarHiddenDraft !== !!profile.settings.avatarHidden ||
      telegramUsernameHiddenDraft !== !!profile.settings.telegramUsernameHidden);
  const canSaveSettings = useMemo(
    () => settingsDirty && !settingsSaving,
    [settingsDirty, settingsSaving]
  );

  const applyUpdatedProfile = (user: any) => {
    setProfile(user);
    setAvatarHiddenDraft(!!user?.settings?.avatarHidden);
    setTelegramUsernameHiddenDraft(!!user?.settings?.telegramUsernameHidden);
    onProfileUpdated?.(user);
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

  const enableBotMessages = () => {
    // @ts-ignore
    const tg = window.Telegram?.WebApp;
    if (!tg?.requestWriteAccess) {
      setNotice({
        tone: "error",
        text: "В этой версии Telegram нет быстрого запроса. Открой бота и нажми /start.",
      });
      openBotChat();
      return;
    }

    setBotPmBusy(true);
    setNotice(null);

    tg.requestWriteAccess(async (granted?: boolean) => {
      if (!granted) {
        setBotPmBusy(false);
        setNotice({
          tone: "error",
          text: "Разрешение не выдано. Включить сообщения можно будет позже.",
        });
        return;
      }

      try {
        const refreshedInitData = String(tg.initData || "");
        if (refreshedInitData) {
          setApiInitData(refreshedInitData);
        }

        const res = await apiFetch<any>("/me/enable-bot-pm", {
          method: "POST",
          headers: refreshedInitData ? { "x-telegram-init-data": refreshedInitData } : undefined,
        });

        if (res.ok && res.user) {
          applyUpdatedProfile(res.user);
          setNotice({
            tone: "success",
            text: "Сообщения от бота включены. Теперь напоминания и важные уведомления смогут приходить в личку.",
          });
        }
      } catch (error) {
        const raw = String((error as any)?.message || "");
        setNotice({
          tone: "error",
          text: raw.includes("BOT_WRITE_ACCESS_NOT_AVAILABLE")
            ? "Telegram ещё не передал доступ боту. Закрой и заново открой приложение, затем попробуй ещё раз."
            : surfaceText(error, "Не удалось включить сообщения от бота."),
        });
      } finally {
        setBotPmBusy(false);
      }
    });
  };

  const saveProfileSettings = async () => {
    setSettingsSaving(true);
    setNotice(null);
    try {
      const res = await apiFetch<any>("/me/profile-settings", {
        method: "PUT",
        body: JSON.stringify({
          avatarHidden: avatarHiddenDraft,
          telegramUsernameHidden: telegramUsernameHiddenDraft,
        }),
      });
      if (res.ok && res.user) {
        applyUpdatedProfile(res.user);
        setNotice({ tone: "success", text: "Настройки профиля сохранены." });
      }
    } catch (error) {
      setNotice({ tone: "error", text: surfaceText(error, "Не удалось сохранить настройки профиля.") });
    } finally {
      setSettingsSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--tg-secondary-bg)",
        zIndex: 70,
        overflowY: "auto",
        color: "var(--tg-text)",
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          padding: "12px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "var(--tg-secondary-bg)",
          borderBottom: "0.5px solid var(--tg-separator, rgba(128,128,128,0.1))",
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            color: "var(--tg-link)",
            fontSize: 15,
            cursor: "pointer",
            padding: 0,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span style={{ fontSize: 18 }}>‹</span> Назад
        </button>
        <span style={{ fontSize: 17, fontWeight: 700 }}>Настройки профиля</span>
        <div style={{ width: 48 }} />
      </div>

      <div style={{ padding: 16, paddingBottom: 132 }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--tg-hint)" }}>Загрузка…</div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 20 }}>
              <UserAvatar
                photoUrl={avatarHiddenDraft ? null : profile?.photoUrl}
                name={displayName}
                size={64}
              />
              <div style={{ fontSize: 18, fontWeight: 700, marginTop: 8, textAlign: "center" }}>{displayName}</div>
              <div style={{ fontSize: 12, color: "var(--tg-hint)", marginTop: 4 }}>
                Имя берётся из Telegram
              </div>
            </div>

            <div style={{ ...cardStyle, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "var(--tg-hint)", marginBottom: 14, lineHeight: 1.5 }}>
                В приложении другим игрокам показывается твоё имя из Telegram. Внутриигровые
                ники больше не используются.
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <ToggleRow
                  title="Скрывать аватарку в приложении"
                  description="Вместо Telegram-аватарки другие игроки увидят стандартную заглушку."
                  checked={avatarHiddenDraft}
                  onToggle={() => {
                    setAvatarHiddenDraft((prev) => !prev);
                    setNotice(null);
                  }}
                />

                <ToggleRow
                  title="Скрывать Telegram Username"
                  description="Даже участники общих лиг не увидят твой @username в профиле."
                  checked={telegramUsernameHiddenDraft}
                  onToggle={() => {
                    setTelegramUsernameHiddenDraft((prev) => !prev);
                    setNotice(null);
                  }}
                />
              </div>
            </div>

            <div style={{ ...cardStyle, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Сообщения от бота</div>
              <div style={{ fontSize: 12, color: "var(--tg-hint)", lineHeight: 1.5, marginBottom: 14 }}>
                Разреши боту писать тебе в личку, чтобы получать напоминания о матчах и важные игровые уведомления.
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "var(--tg-secondary-bg)",
                  border: "1px solid rgba(128,128,128,0.12)",
                }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {profile?.botPmEnabled ? "Сообщения включены" : "Сообщения не включены"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--tg-hint)", marginTop: 2 }}>
                    {profile?.botPmEnabled
                      ? "Бот уже может присылать тебе личные уведомления."
                      : "Можно включить сейчас или открыть бота вручную через /start."}
                  </div>
                </div>
                <div
                  style={{
                    minWidth: 12,
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    flexShrink: 0,
                    background: profile?.botPmEnabled ? "#34c759" : "rgba(128,128,128,0.35)",
                  }}
                />
              </div>

              {!profile?.botPmEnabled && (
                <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                  <button
                    type="button"
                    onClick={enableBotMessages}
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
                    {botPmBusy ? "Запрашиваем доступ…" : "Разрешить сообщения"}
                  </button>
                  <button
                    type="button"
                    onClick={openBotChat}
                    style={{
                      minWidth: 110,
                      minHeight: 42,
                      borderRadius: 12,
                      border: "1px solid rgba(128,128,128,0.12)",
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
              )}
            </div>

            {notice && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "11px 12px",
                  borderRadius: 12,
                  background:
                    notice.tone === "error"
                      ? "rgba(255,59,48,0.10)"
                      : notice.tone === "success"
                        ? "rgba(52,199,89,0.10)"
                        : "rgba(128,128,128,0.12)",
                  color:
                    notice.tone === "error"
                      ? "#ff3b30"
                      : notice.tone === "success"
                        ? "#34c759"
                        : "var(--tg-text)",
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                {notice.text}
              </div>
            )}

            <button
              onClick={saveProfileSettings}
              disabled={!canSaveSettings}
              style={{
                width: "100%",
                padding: "14px 14px",
                borderRadius: 14,
                border: "none",
                background: canSaveSettings ? "var(--tg-button)" : "rgba(128,128,128,0.18)",
                color: canSaveSettings ? "var(--tg-button-text)" : "var(--tg-hint)",
                fontSize: 15,
                fontWeight: 700,
                cursor: canSaveSettings ? "pointer" : "default",
                transition: "background 0.2s, color 0.2s",
              }}
            >
              {settingsSaving ? "Сохраняем…" : "Сохранить настройки"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

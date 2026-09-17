"use client";

import { useEffect, useState } from "react";
import { AdminCard } from "./components/AdminCard";
import {
  AdminBadge,
  AdminButton,
  AdminCheckbox,
  AdminDataRow,
  AdminInput,
  AdminSegmentedControl,
  AdminTextarea,
} from "./components/ui";
import { formatMsk, mskInputToMs, toMskInputValue } from "./mskTime";

type AdminFetchWithAuth = <T = unknown>(path: string, init?: RequestInit) => Promise<T | null>;
type MaintResponse = { ok?: boolean; enabled?: boolean; message?: string; image?: string; countdownTo?: number };
type MaintenanceMode = "disabled" | "enabled";

// Maintenance mode editor. Lazy: mounted only when the Maintenance tab is active;
// loads its own state on mount. API contract and payload stay unchanged.
export default function MaintenanceTab({
  fetchWithAuth,
  onSuccess,
  onError,
}: {
  fetchWithAuth: AdminFetchWithAuth;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [maintEnabled, setMaintEnabled] = useState(false);
  const [maintMessage, setMaintMessage] = useState("");
  const [maintImage, setMaintImage] = useState("");
  // Launch moment as a datetime-local value in Moscow wall time ("" = no countdown)
  const [countdownInput, setCountdownInput] = useState("");
  // Whether flipping the switch also sends the bot broadcast to subscribers
  const [notifyUsers, setNotifyUsers] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    fetchWithAuth<MaintResponse>("/admin/maintenance")
      .then((res) => {
        if (active && res) {
          setMaintEnabled(!!res.enabled);
          setMaintMessage(res.message || "");
          setMaintImage(res.image || "");
          setCountdownInput(res.countdownTo ? toMskInputValue(res.countdownTo) : "");
        }
      })
      .catch(() => { /* best-effort, same as before */ });
    return () => { active = false; };
  }, [fetchWithAuth]);

  const countdownMs = countdownInput ? mskInputToMs(countdownInput) : null;

  const save = async () => {
    if (countdownInput && countdownMs == null) {
      onError("Некорректная дата запуска");
      return;
    }
    setLoading(true);
    onError("");
    const res = await fetchWithAuth<MaintResponse>("/admin/maintenance", {
      method: "PUT",
      body: JSON.stringify({
        enabled: maintEnabled,
        message: maintMessage,
        image_url: maintImage,
        // unix seconds; 0 clears the countdown
        countdown_to: countdownMs != null ? Math.floor(countdownMs / 1000) : 0,
        notify: notifyUsers,
      }),
    });
    setLoading(false);
    if (res?.ok) {
      onSuccess(maintEnabled ? "Технические работы включены" : "Технические работы выключены");
      setMaintEnabled(!!res.enabled);
      setMaintMessage(res.message || "");
      setMaintImage(res.image || "");
      setCountdownInput(res.countdownTo ? toMskInputValue(res.countdownTo) : "");
      setTimeout(() => onSuccess(""), 3000);
    }
  };

  const mode: MaintenanceMode = maintEnabled ? "enabled" : "disabled";
  const statusBadge = maintEnabled
    ? <AdminBadge variant="warning" size="md" dot>Включены</AdminBadge>
    : <AdminBadge variant="success" size="md" dot>Выключены</AdminBadge>;

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <AdminCard className="overflow-hidden border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] shadow-xl shadow-black/20">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="h-4 w-1 rounded-full bg-[color-mix(in_srgb,#ffb340_72%,var(--tg-theme-button-color,var(--tg-button,#2481cc)))]" />
                <h2 className="text-[17px] font-black tracking-tight text-[var(--tg-theme-text-color,var(--tg-text,#fff))]">
                  Технические работы
                </h2>
              </div>
              <div className="mt-1 text-[12px] font-semibold leading-snug text-[var(--tg-theme-hint-color,var(--tg-hint,#999))]">
                Настройки доступа к приложению во время обслуживания.
              </div>
            </div>
            {statusBadge}
          </div>

          <div className="space-y-3 rounded-3xl border border-[color-mix(in_srgb,var(--tg-theme-hint-color,var(--tg-hint,#8a8a8a))_14%,transparent)] bg-[color-mix(in_srgb,var(--tg-theme-secondary-bg-color,var(--tg-secondary-bg,#111827))_60%,var(--tg-theme-bg-color,var(--tg-bg,#0b0f19)))] p-3">
            <AdminDataRow
              label="Статус"
              value={maintEnabled ? "Техработы включены" : "Техработы выключены"}
              description={maintEnabled ? "Приложение закрыто для пользователей, кроме админов." : "Приложение доступно пользователям."}
              badge={statusBadge}
            />

            <AdminSegmentedControl<MaintenanceMode>
              ariaLabel="Режим технических работ"
              value={mode}
              onChange={(nextMode) => setMaintEnabled(nextMode === "enabled")}
              fullWidth
              scrollable={false}
              options={[
                { value: "disabled", label: "Выключены", disabled: loading },
                { value: "enabled", label: "Включены", disabled: loading },
              ]}
            />

            <AdminCheckbox
              checked={notifyUsers}
              onChange={setNotifyUsers}
              disabled={loading}
              label="Оповестить пользователей в боте"
              description={
                notifyUsers
                  ? (maintEnabled
                    ? "Подписчикам придёт сообщение о начале технических работ."
                    : "Подписчикам придёт сообщение о завершении технических работ.")
                  : "Режим переключится молча, без рассылки."
              }
            />

            {notifyUsers && countdownMs != null && maintEnabled && (
              <div
                role="status"
                className="rounded-2xl border border-[color-mix(in_srgb,#ffb340_26%,transparent)] bg-[color-mix(in_srgb,#ffb340_12%,var(--tg-theme-secondary-bg-color,var(--tg-secondary-bg,#111827)))] p-3 text-[12px] font-semibold leading-relaxed text-[var(--tg-theme-text-color,var(--tg-text,#fff))]"
              >
                Задана дата запуска, но рассылка включена — подписчики получат сообщение
                про технические работы, а не про запуск. Обычно её лучше выключить.
              </div>
            )}
          </div>

          <div className="space-y-4">
            <AdminInput
              label="Дата и время запуска (МСК)"
              description={
                countdownMs != null
                  ? `На экране будет «До запуска» и таймер. ${formatMsk(countdownMs)} приложение откроется автоматически.`
                  : "Пусто — обычный экран «Технические работы» без таймера и без автооткрытия."
              }
              type="datetime-local"
              value={countdownInput}
              disabled={loading}
              onChange={(event) => setCountdownInput(event.target.value)}
              // keep the picker indicator visible on the dark admin theme
              className="[&::-webkit-calendar-picker-indicator]:invert-[1] [&::-webkit-calendar-picker-indicator]:opacity-50"
            />

            <AdminTextarea
              label="Сообщение для пользователей"
              description="Показывается пользователям на экране технических работ."
              minRows={5}
              value={maintMessage}
              disabled={loading}
              onChange={(event) => setMaintMessage(event.target.value)}
              placeholder="Например: Ведутся технические работы. Скоро вернёмся."
            />

            <AdminInput
              label="Картинка баннера"
              description="Необязательно"
              type="text"
              value={maintImage}
              disabled={loading}
              onChange={(event) => setMaintImage(event.target.value)}
              placeholder="https://..."
              inputMode="url"
            />
          </div>

          {maintEnabled && (
            <div
              role="status"
              className="rounded-2xl border border-[color-mix(in_srgb,#ffb340_26%,transparent)] bg-[color-mix(in_srgb,#ffb340_12%,var(--tg-theme-secondary-bg-color,var(--tg-secondary-bg,#111827)))] p-3"
            >
              <div className="flex items-start gap-3">
                <AdminBadge variant="warning">Важно</AdminBadge>
                <div className="min-w-0 text-[12px] font-semibold leading-relaxed text-[var(--tg-theme-text-color,var(--tg-text,#fff))]">
                  <div className="font-extrabold">Технические работы включены</div>
                  <div className="mt-0.5 text-[var(--tg-theme-hint-color,var(--tg-hint,#999))]">
                    В приложение могут заходить только авторизованные админы.
                  </div>
                </div>
              </div>
            </div>
          )}

          <AdminButton
            type="button"
            variant="primary"
            fullWidth
            loading={loading}
            disabled={loading}
            onClick={save}
          >
            Сохранить настройки
          </AdminButton>
        </div>
      </AdminCard>
    </div>
  );
}

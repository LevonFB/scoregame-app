"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BrandLogo } from "./ui/BrandLogo";

// getMaintenanceConfig() falls back to this string when no custom message is
// stored, so an untouched config would print "Технические работы" under a launch
// countdown. Treated as "no message" while counting down.
const BACKEND_DEFAULT_MESSAGE = "Технические работы";

// Full-screen gate shown to non-admins while the app is closed. Two wordings
// from one flag: with a future `countdownTo` (unix seconds) it reads as a launch
// countdown, without it as the plain maintenance notice.
export default function MaintenanceScreen({
  message,
  image,
  countdownTo,
  onRefresh,
}: {
  message: string;
  image: string;
  countdownTo: number;
  onRefresh: () => void;
}) {
  const targetMs = countdownTo > 0 ? countdownTo * 1000 : 0;
  const [now, setNow] = useState(() => Date.now());

  const remaining = targetMs ? Math.max(0, targetMs - now) : 0;
  const isCountdown = targetMs > 0 && remaining > 0;

  // Local tick only — no network. Stops once the countdown reaches zero.
  useEffect(() => {
    if (!isCountdown) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isCountdown]);

  // Once the launch moment passes, poll the public flag so the app opens by
  // itself when the admin flips maintenance off (no manual reload needed).
  // onRefresh lives in a ref so a new inline callback per render cannot keep
  // resetting the interval before it ever fires.
  const refreshRef = useRef(onRefresh);
  useEffect(() => { refreshRef.current = onRefresh; }, [onRefresh]);
  const expired = targetMs > 0 && remaining <= 0;
  useEffect(() => {
    if (!expired) return;
    const startedAt = Date.now();
    let ticks = 0;
    const id = setInterval(() => {
      ticks += 1;
      // Backgrounded Mini App: nobody is watching, so skip the request.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      // Tight polling only around the launch minute, then back off to 1/min so
      // a screen left open for hours costs a request a minute, not four.
      const backedOff = Date.now() - startedAt > 3 * 60_000;
      if (backedOff && ticks % 4 !== 0) return;
      refreshRef.current();
    }, 15_000);
    return () => clearInterval(id);
  }, [expired]);

  const launchLabel = useMemo(() => {
    if (!targetMs) return "";
    const text = new Date(targetMs).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Moscow",
    }).replace(",", "");
    return `${text} МСК`;
  }, [targetMs]);

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const units: Array<{ value: number; label: string }> = [
    { value: days, label: plural(days, "день", "дня", "дней") },
    { value: hours, label: plural(hours, "час", "часа", "часов") },
    { value: minutes, label: plural(minutes, "минута", "минуты", "минут") },
    { value: seconds, label: plural(seconds, "секунда", "секунды", "секунд") },
  ];
  // Hide the days cell on the final day so the numbers stay large and readable.
  const visibleUnits = days > 0 ? units : units.slice(1);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'var(--tg-bg, #fff)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 32, textAlign: 'center'
    }}>
      {image && (
        <img src={image} alt="" style={{ width: 120, height: 120, marginBottom: 24, borderRadius: 24, objectFit: 'cover' }} />
      )}
      {!image && (
        isCountdown
          ? <BrandLogo width={176} height={86} style={{ marginBottom: 20 }} />
          : <div style={{ fontSize: 64, marginBottom: 16 }}>🛠️</div>
      )}

      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: isCountdown ? 20 : 12, color: 'var(--tg-text, #000)' }}>
        {isCountdown ? 'До запуска' : 'Технические работы'}
      </h2>

      {isCountdown && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {visibleUnits.map((unit) => (
              <div
                key={unit.label}
                style={{
                  minWidth: 64, padding: '10px 8px', borderRadius: 16,
                  background: 'var(--tg-secondary-bg, rgba(127,127,127,0.12))',
                }}
              >
                <div style={{
                  fontSize: 26, fontWeight: 800, lineHeight: 1.1,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--tg-text, #000)',
                }}>
                  {String(unit.value).padStart(2, '0')}
                </div>
                <div style={{ fontSize: 11, marginTop: 4, color: 'var(--tg-hint, #999)' }}>
                  {unit.label}
                </div>
              </div>
            ))}
          </div>
          {launchLabel && (
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tg-hint, #999)', marginBottom: 12 }}>
              Старт {launchLabel}
            </div>
          )}
        </>
      )}

      <p style={{ fontSize: 15, color: 'var(--tg-hint, #999)', lineHeight: 1.5, maxWidth: 300 }}>
        {targetMs
          ? (message.trim() === BACKEND_DEFAULT_MESSAGE ? '' : message)
            || 'Приложение откроется автоматически — заходи к старту.'
          : message || 'Идут технические работы. Скоро вернёмся.'}
      </p>

      {/* No refresh button while counting down: the gate cannot open before the
          launch moment, and after it the screen reopens the app on its own. */}
      {!isCountdown && (
        <button
          onClick={onRefresh}
          style={{
            marginTop: 24, padding: '12px 32px', borderRadius: 12,
            background: 'var(--tg-button, #007aff)', color: 'var(--tg-button-text, #fff)',
            border: 'none', fontSize: 16, fontWeight: 600, cursor: 'pointer'
          }}
        >
          Обновить
        </button>
      )}
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

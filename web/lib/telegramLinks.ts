/**
 * Переходы по ссылкам из мини-приложения.
 *
 * `WebApp.openTelegramLink` только отправляет клиенту событие
 * `web_app_open_tg_link` и не знает, обработал ли тот его. На десктопе и в вебе
 * событие может уйти в пустоту: экран остаётся на месте, и кнопка выглядит
 * сломанной. Поэтому там за переходом следим и при необходимости открываем
 * ссылку сами. Мобильные клиенты переход выполняют, им подстраховка не нужна и
 * только грозит вторым открытием.
 */

export type TelegramWebAppLinks = {
  platform?: string;
  openTelegramLink?: (url: string) => void;
  openLink?: (url: string) => void;
};

type TelegramWindow = Window & { Telegram?: { WebApp?: TelegramWebAppLinks } };

/** Площадки, где переход по t.me ненадёжен. */
const UNRELIABLE_PLATFORMS = new Set(["tdesktop", "macos", "linux", "web", "weba", "webk", "unknown"]);

/** Сколько ждём перехода, прежде чем открыть ссылку самим. */
const FALLBACK_DELAY_MS = 900;

function getWebApp(): TelegramWebAppLinks | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as TelegramWindow).Telegram?.WebApp;
}

/**
 * Площадка, где на переход по событию SDK полагаться нельзя. Такие экраны
 * показывают обычную ссылку: клик по `<a>` клиент обрабатывает сам, без
 * событий, и это единственный путь, который там срабатывает всегда.
 */
export function isUnreliableTelegramPlatform(): boolean {
  return UNRELIABLE_PLATFORMS.has(String(getWebApp()?.platform || "unknown").toLowerCase());
}

/** Открыть ссылку мимо Telegram: внешний браузер, затем обычный переход. */
export function openExternalLink(url: string, tg: TelegramWebAppLinks | undefined = getWebApp()) {
  if (!url) return;
  if (typeof tg?.openLink === "function") {
    tg.openLink(url);
    return;
  }
  if (/^https?:\/\//i.test(url)) {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) return;
  }
  window.location.href = url;
}

/**
 * Открыть t.me-ссылку: канал, бота, приглашение. На площадках, где переход
 * может не состояться, при отсутствии реакции клиента ссылка открывается
 * запасным путём.
 */
export function openTelegramDeepLink(url: string) {
  if (!url) return;
  const tg = getWebApp();
  if (!/^https:\/\/t\.me\//i.test(url) || typeof tg?.openTelegramLink !== "function") {
    openExternalLink(url, tg);
    return;
  }

  const needsFallback = UNRELIABLE_PLATFORMS.has(String(tg.platform || "unknown").toLowerCase());
  // Слушатели ставим до вызова: клиент может увести фокус сразу, ещё внутри него.
  let settled = !needsFallback;
  const onVisibility = () => { if (document.visibilityState === "hidden") cancel(); };
  function cancel() {
    settled = true;
    window.removeEventListener("blur", cancel);
    window.removeEventListener("pagehide", cancel);
    document.removeEventListener("visibilitychange", onVisibility);
  }
  if (needsFallback) {
    window.addEventListener("blur", cancel);
    window.addEventListener("pagehide", cancel);
    document.addEventListener("visibilitychange", onVisibility);
  }

  try {
    tg.openTelegramLink(url);
  } catch {
    cancel();
    openExternalLink(url, tg);
    return;
  }
  if (settled) return;

  // Переход уводит фокус с мини-приложения. Фокус на месте — значит клиент
  // событие проигнорировал и ничего не открылось.
  window.setTimeout(() => {
    if (settled) return;
    cancel();
    openExternalLink(url, tg);
  }, FALLBACK_DELAY_MS);
}

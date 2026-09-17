import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "scoregame",
  description: "Telegram Mini App",
};

// Startup splash progress loop. Inline so it runs while the HTML is parsed,
// before the JS bundle: the bar creeps toward the ceiling the app raises via
// window.__sgBoot.stage() (lib/bootSplash.ts) and never reaches it on its own.
// done() runs it to 100% and fades out; an 8s cap guarantees the splash never
// traps the user. The splash runs on "/" only. Only attributes/styles/text of #sg-boot are touched, all
// covered by suppressHydrationWarning, so React hydration is unaffected.
const BOOT_SPLASH_SCRIPT = `(function(){
  var el = document.getElementById("sg-boot");
  if (!el) return;
  // Only the Mini App shell reports milestones; other routes (admin, deep pages) skip the splash.
  var path = location.pathname.replace(/\\/index\\.html$/, "/");
  if (path !== "/") { el.style.display = "none"; return; }
  var pct = el.querySelector("[data-pct]"), label = el.querySelector("[data-label]");
  var shown = 0, target = 0, cap = 20, finished = false, gone = false;
  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function syncScheme() {
    try {
      var s = window.Telegram && Telegram.WebApp && Telegram.WebApp.colorScheme;
      if (s && el.getAttribute("data-scheme") !== s) el.setAttribute("data-scheme", s);
    } catch (e) {}
  }
  function frame() {
    if (gone) return;
    syncScheme();
    target = finished ? 100 : target + (cap - target) * 0.03;
    shown += (target - shown) * (reduced ? 1 : 0.12);
    var v = Math.min(100, shown);
    el.style.setProperty("--sg-boot-p", v.toFixed(1) + "%");
    pct.textContent = Math.round(v) + "%";
    if (finished && v > 99.4) {
      gone = true;
      el.setAttribute("data-out", "");
      setTimeout(function(){ el.style.display = "none"; }, 380);
      return;
    }
    requestAnimationFrame(frame);
  }
  window.__sgBoot = {
    stage: function(p, text){ if (p > cap) cap = p; if (text) label.textContent = text; },
    done: function(){ finished = true; }
  };
  setTimeout(function(){ finished = true; }, 8000);
  requestAnimationFrame(frame);
})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <head>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
      </head>
      <body>
        <div id="sg-boot" className="sg-boot" role="status" aria-label="Загрузка ScoreGame" suppressHydrationWarning>
          <div className="sg-boot__mark" aria-hidden="true">
            <i className="sg-boot__under" />
            <i className="sg-boot__cream" />
            <i className="sg-boot__body" />
            <i className="sg-boot__flat" />
          </div>
          <div className="sg-boot__load" aria-hidden="true">
            <div className="sg-boot__row">
              <span data-label="" suppressHydrationWarning>Запускаем приложение</span>
              <span data-pct="" className="sg-boot__pct" suppressHydrationWarning>0%</span>
            </div>
            <div className="sg-boot__track"><div className="sg-boot__fill" /></div>
          </div>
        </div>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SPLASH_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}

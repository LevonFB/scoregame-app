// Startup splash bridge. The splash markup and its progress loop live in the
// static HTML (app/layout.tsx) so they paint before the JS bundle arrives;
// the app only reports real milestones. Both calls are safe no-ops once the
// splash is gone or when the page runs without it.
type BootSplash = {
  stage: (pct: number, label?: string) => void;
  done: () => void;
};

function splash(): BootSplash | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { __sgBoot?: BootSplash }).__sgBoot;
}

/** Raise the progress ceiling to `pct` (never lowers it) and optionally relabel the stage. */
export function bootSplashStage(pct: number, label?: string) {
  try { splash()?.stage(pct, label); } catch { /* no-op */ }
}

/** Startup data is in place: run the bar to 100% and fade the splash out. */
export function bootSplashDone() {
  try { splash()?.done(); } catch { /* no-op */ }
}

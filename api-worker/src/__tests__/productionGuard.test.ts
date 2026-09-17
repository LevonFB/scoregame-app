import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Stage 3.1 — fail the build if any test-only failure-injection identifier leaks
// into the production runtime (src/*.ts, excluding __tests__). The failure hook
// must exist ONLY via the dependency-injected `deps.fault` argument used by tests.
const SRC = path.resolve(__dirname, "..");
const BANNED = ["E2E_BACKFILL_FAIL_AFTER", "maybeInjectBackfillFailure", "E2E_INJECTED_FAILURE"];

function runtimeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue; // test code may legitimately mention hooks
      out.push(...runtimeFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".inttest.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("production runtime is free of test-only failure injection", () => {
  const files = runtimeFiles(SRC);

  it("scans at least the known runtime files", () => {
    expect(files.length).toBeGreaterThan(3);
    expect(files.some((f) => f.endsWith("index.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("dailyCaseBackfillCore.ts"))).toBe(true);
  });

  for (const banned of BANNED) {
    it(`no runtime file contains "${banned}"`, () => {
      const offenders = files.filter((f) => readFileSync(f, "utf8").includes(banned));
      expect(offenders, `found "${banned}" in: ${offenders.join(", ")}`).toHaveLength(0);
    });
  }
});

// Stage 4 — the quest shadow path must be strictly READ-ONLY: no progress/reward/
// balance/inventory writes. Scan the pure module and the runDailyQuestShadow body.
describe("quest shadow is write-free", () => {
  const WRITE_PATTERNS = [/\bINSERT\b/i, /\bUPDATE\b/i, /\bDELETE\b/i, /awardStars/, /awardBalls/, /grantCase/, /markTask/, /transferDailyCase/, /ViaLedger/];

  it("questShadow.ts contains no write operations", () => {
    const src = readFileSync(path.join(SRC, "questShadow.ts"), "utf8");
    for (const p of WRITE_PATTERNS) expect(p.test(src), `questShadow.ts matched ${p}`).toBe(false);
  });

  it("runDailyQuestShadow() body contains no write operations", () => {
    const idx = readFileSync(path.join(SRC, "index.ts"), "utf8");
    const start = idx.indexOf("async function runDailyQuestShadow");
    expect(start).toBeGreaterThan(-1);
    // body = from the function start to the next top-level function declaration.
    const after = idx.slice(start + 1);
    const end = after.indexOf("\nfunction ") >= 0
      ? Math.min(...["\nfunction ", "\nasync function "].map((m) => after.indexOf(m)).filter((n) => n > 0))
      : after.length;
    const body = after.slice(0, end);
    for (const p of WRITE_PATTERNS) expect(p.test(body), `runDailyQuestShadow matched ${p}`).toBe(false);
  });
});

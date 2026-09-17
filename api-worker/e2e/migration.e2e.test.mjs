// Stage 15 E2E — ISOLATED migration apply for the two additive V2 job tables.
// Applies ONLY 0089 + 0092 (renumbered weekly finalizer) to a throwaway local D1 —
// NOT the full historical chain (which drifts). Proves: first apply ok, re-apply ok
// (IF NOT EXISTS), both tables + indexes exist, no stray tables created.
//
// Run: node --test e2e/migration.e2e.test.mjs (package.json test:e2e:migration)

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const WRANGLER_JS = path.resolve(apiRoot, "node_modules/wrangler/bin/wrangler.js");
const M_0089 = "migrations/0089_daily_case_backfill_jobs.sql";
const M_0092 = "migrations/0092_weekly_finalizer_jobs.sql";

function wrangler(args) {
  return execFileSync(process.execPath, [WRANGLER_JS, ...args], {
    cwd: apiRoot, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  }).toString();
}
const applyFile = (p, f) => wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--file", f]);
function rows(p, sql) {
  const out = wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--command", sql, "--json"]);
  try { const j = JSON.parse(out); return (j[0]?.results ?? j.results ?? []); } catch { return []; }
}
const names = (p, sql) => rows(p, sql).map((r) => String(r.name));

test("isolated apply of 0089 + 0092: first + repeat apply, tables/indexes, no stray tables", () => {
  const p = ".wrangler-e2e-migration";
  rmSync(path.join(apiRoot, p), { recursive: true, force: true });
  try {
    // First apply (order 0089 then 0092).
    applyFile(p, M_0089);
    applyFile(p, M_0092);
    // Re-apply (idempotent — CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).
    applyFile(p, M_0089);
    applyFile(p, M_0092);

    const tables = names(p, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name;");
    assert.ok(tables.includes("daily_case_backfill_jobs"), `0089 table present (got ${tables.join(",")})`);
    assert.ok(tables.includes("weekly_finalizer_jobs"), `0092 table present (got ${tables.join(",")})`);
    // No stray/unexpected tables beyond the two job tables (isolated apply).
    const unexpected = tables.filter((t) => !["daily_case_backfill_jobs", "weekly_finalizer_jobs"].includes(t));
    assert.deepEqual(unexpected, [], `no extra tables (got ${unexpected.join(",")})`);

    const idx = names(p, "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name;");
    for (const want of ["idx_dcbj_status", "idx_dcbj_matchday", "idx_wfj_status", "idx_wfj_season_week"]) {
      assert.ok(idx.includes(want), `index ${want} present (got ${idx.join(",")})`);
    }

    // Both tables empty + usable (insert a probe row into each, then verify count).
    wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--command", "INSERT INTO daily_case_backfill_jobs (job_key, matchday_key, created_at) VALUES ('probe','2026-01-01',1);"]);
    wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--command", "INSERT INTO weekly_finalizer_jobs (job_key, season_id, week_key, created_at) VALUES ('probe',1,'2026-W01',1);"]);
    assert.equal(rows(p, "SELECT COUNT(*) AS n FROM daily_case_backfill_jobs;")[0].n, 1);
    assert.equal(rows(p, "SELECT COUNT(*) AS n FROM weekly_finalizer_jobs;")[0].n, 1);
  } finally {
    rmSync(path.join(apiRoot, p), { recursive: true, force: true });
  }
});

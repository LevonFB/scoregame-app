// Stage 8 — unit tests for partner-claims V2 pure helpers.

import { describe, expect, it } from "vitest";
import {
  classifyPartnerClaimDue,
  decidePartnerLegacyOnFrequentCron,
  isPartnerSweepCron,
  resolvePartnerParams,
  buildPartnerRewardIdemKey,
  PARTNER_CLAIMS_SWEEP_CRON,
  PARTNER_SWEEP_MAX_PAGES,
} from "../partnerClaimsV2";
import { resolveApiFlags } from "../featureFlags";

describe("Stage 8 — flag defaults", () => {
  it("defaults preserve legacy behavior", () => {
    const f = resolveApiFlags({});
    expect(f.partnerClaimsV2).toBe(false);
    expect(f.partnerClaimsLegacyCronFallback).toBe(true);
    expect(f.partnerClaimsBatchSize).toBe(25);
    expect(f.partnerClaimsOverdueMinutes).toBe(120);
  });
  it("batch size respects min/max; invalid → default", () => {
    expect(resolveApiFlags({ PARTNER_CLAIMS_BATCH_SIZE: "0" }).partnerClaimsBatchSize).toBe(25);
    expect(resolveApiFlags({ PARTNER_CLAIMS_BATCH_SIZE: "201" }).partnerClaimsBatchSize).toBe(25);
    expect(resolveApiFlags({ PARTNER_CLAIMS_BATCH_SIZE: "abc" }).partnerClaimsBatchSize).toBe(25);
    expect(resolveApiFlags({ PARTNER_CLAIMS_BATCH_SIZE: "50" }).partnerClaimsBatchSize).toBe(50);
  });
  it("V2 cannot be enabled by a garbage value", () => {
    expect(resolveApiFlags({ PARTNER_CLAIMS_V2_ENABLED: "maybe" }).partnerClaimsV2).toBe(false);
    expect(resolveApiFlags({ PARTNER_CLAIMS_V2_ENABLED: "true" }).partnerClaimsV2).toBe(true);
  });
});

describe("Stage 8 — resolvePartnerParams / cron / idem key", () => {
  it("maps flags to params", () => {
    const p = resolvePartnerParams({ partnerClaimsBatchSize: 30, partnerClaimsOverdueMinutes: 60 });
    expect(p.batchSize).toBe(30);
    expect(p.maxPages).toBe(PARTNER_SWEEP_MAX_PAGES);
    expect(p.overdueMs).toBe(60 * 60_000);
  });
  it("hourly cron recognized", () => {
    expect(PARTNER_CLAIMS_SWEEP_CRON).toBe("7 * * * *");
    expect(isPartnerSweepCron("7 * * * *")).toBe(true);
    expect(isPartnerSweepCron("*/10 * * * *")).toBe(false);
    expect(isPartnerSweepCron(undefined)).toBe(false);
  });
  it("idem key is stable per claim", () => {
    expect(buildPartnerRewardIdemKey(42)).toBe("partner-reward:42");
  });
});

describe("Stage 8 — classifyPartnerClaimDue", () => {
  const now = 1_000_000;
  it("non pending_hold → not_pending", () => {
    expect(classifyPartnerClaimDue({ status: "completed", hold_until: 1 }, now)).toBe("not_pending");
    expect(classifyPartnerClaimDue(null, now)).toBe("not_pending");
  });
  it("pending_hold future hold → not_due", () => {
    expect(classifyPartnerClaimDue({ status: "pending_hold", hold_until: now + 1 }, now)).toBe("not_due");
    expect(classifyPartnerClaimDue({ status: "pending_hold", hold_until: null }, now)).toBe("not_due");
  });
  it("pending_hold elapsed hold → due", () => {
    expect(classifyPartnerClaimDue({ status: "pending_hold", hold_until: now }, now)).toBe("due");
    expect(classifyPartnerClaimDue({ status: "pending_hold", hold_until: now - 1 }, now)).toBe("due");
  });
});

describe("Stage 8 — decidePartnerLegacyOnFrequentCron", () => {
  it("V2 off → run legacy (default)", () => {
    expect(decidePartnerLegacyOnFrequentCron({ v2Enabled: false, fallbackEnabled: true, overdueExists: true }).runLegacy).toBe(true);
  });
  it("V2 on + fallback off → never legacy", () => {
    expect(decidePartnerLegacyOnFrequentCron({ v2Enabled: true, fallbackEnabled: false, overdueExists: true }).runLegacy).toBe(false);
  });
  it("V2 on + fallback on + overdue → legacy (safety)", () => {
    const d = decidePartnerLegacyOnFrequentCron({ v2Enabled: true, fallbackEnabled: true, overdueExists: true });
    expect(d.runLegacy).toBe(true);
    expect(d.reason).toBe("overdue_fallback");
  });
  it("V2 on + fallback on + no overdue → skip", () => {
    const d = decidePartnerLegacyOnFrequentCron({ v2Enabled: true, fallbackEnabled: true, overdueExists: false });
    expect(d.runLegacy).toBe(false);
    expect(d.reason).toBe("v2_on_no_overdue");
  });
});

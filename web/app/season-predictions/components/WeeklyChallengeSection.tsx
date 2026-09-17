"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { WeeklyChallengeActiveResponse, WeeklyChallengeDetailResponse, WeeklyChallengeEntry } from "../types";
import { WeeklyChallengeCard, WeeklyChallengeEmpty } from "./WeeklyChallengeCard";
import { WeeklyChallengePendingCard } from "./WeeklyChallengePendingCard";
import { WeeklyChallengeEditor } from "./WeeklyChallengeEditor";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function WeeklyChallengeSection({ onOpenTasks }: { onOpenTasks?: () => void }) {
  const [data, setData] = useState<WeeklyChallengeActiveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Default = overview card. Detail (editor) opens only via the "Открыть" CTA;
  // "← Назад" returns here (setMode("card")). No auto-open on section entry.
  // "pending" = read-only results for the previous (closed/scoring/completed) challenge.
  const [mode, setMode] = useState<"card" | "editor" | "pending">("card");
  // Full detail for the pending challenge, loaded on demand by id when its card is tapped.
  const [pendingData, setPendingData] = useState<WeeklyChallengeDetailResponse | null>(null);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingError, setPendingError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await apiFetch<WeeklyChallengeActiveResponse>("/season-predictions/weekly-challenges/active");
        if (active) setData(res);
      } catch (e: unknown) {
        if (active) setError(getErrorMessage(e, "Ошибка загрузки"));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  function handleEntryChange(entry: WeeklyChallengeEntry) {
    setData((prev) => prev ? { ...prev, entry, status: entry.status === "submitted" ? "submitted" : entry.status === "draft" ? "draft" : prev.status } : prev);
  }

  async function openPendingResults(challengeId: number) {
    setMode("pending");
    setPendingError("");
    setPendingLoading(true);
    try {
      const res = await apiFetch<WeeklyChallengeDetailResponse>(`/season-predictions/weekly-challenges/${challengeId}`);
      setPendingData(res);
    } catch (e: unknown) {
      setPendingError(getErrorMessage(e, "Не удалось загрузить результаты"));
    } finally {
      setPendingLoading(false);
    }
  }

  if (loading) {
    return <div style={loadingStyle}>Загрузка Вызова недели…</div>;
  }
  if (error) {
    return <div style={errorStyle}>{error}</div>;
  }
  if (!data || !data.challenge) {
    return <WeeklyChallengeEmpty />;
  }

  if (mode === "pending") {
    if (pendingLoading || (!pendingData && !pendingError)) {
      return <div style={loadingStyle}>Загрузка результатов…</div>;
    }
    if (pendingError || !pendingData) {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={errorStyle}>{pendingError || "Результаты недоступны"}</div>
          <button style={backButtonStyle} onClick={() => setMode("card")}>← Назад</button>
        </div>
      );
    }
    return (
      <WeeklyChallengeEditor
        data={pendingData}
        onBack={() => setMode("card")}
        onEntryChange={() => { /* read-only: previous challenge is closed */ }}
        onOpenTasks={onOpenTasks}
      />
    );
  }

  if (mode === "editor") {
    return (
      <WeeklyChallengeEditor
        data={data}
        onBack={() => setMode("card")}
        onEntryChange={handleEntryChange}
        onOpenTasks={onOpenTasks}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <WeeklyChallengeCard data={data} onOpen={() => setMode("editor")} />
      {data.pending_result && (
        <WeeklyChallengePendingCard
          data={data.pending_result}
          onOpen={() => void openPendingResults(data.pending_result!.challenge.id)}
        />
      )}
    </div>
  );
}

const loadingStyle = {
  padding: 28,
  textAlign: "center" as const,
  color: "var(--tg-hint)",
  fontWeight: 800,
};

const errorStyle = {
  padding: 18,
  borderRadius: 20,
  background: "rgba(255,59,48,0.12)",
  color: "var(--tg-destructive, #ff453a)",
  fontWeight: 800,
};

const backButtonStyle = {
  alignSelf: "flex-start" as const,
  padding: "8px 14px",
  borderRadius: 999,
  border: "1px solid color-mix(in srgb, var(--tg-hint) 20%, transparent)",
  background: "transparent",
  color: "var(--tg-text)",
  fontWeight: 850,
  fontSize: 13,
  cursor: "pointer",
};

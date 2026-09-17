"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatMsk } from "./mskTime";
import { AdminCard } from "./components/AdminCard";
import { AdminBadge, AdminButton, AdminSegmentedControl, AdminTextarea } from "./components/ui";

type AdminFetchWithAuth = <T = unknown>(path: string, init?: RequestInit) => Promise<T | null>;

type Segment = "all" | "active_7d" | "active_30d";

type BroadcastJob = {
  id: number;
  message: string;
  segment: Segment;
  status: "pending" | "sending" | "done" | "canceled";
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  total_recipients: number;
  sent_count: number;
  blocked_count: number;
  failed_count: number;
  error: string | null;
};

const SEGMENT_OPTIONS: { value: Segment; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "active_7d", label: "Активные 7д" },
  { value: "active_30d", label: "Активные 30д" },
];

const SEGMENT_LABEL: Record<Segment, string> = {
  all: "Все",
  active_7d: "Активные 7д",
  active_30d: "Активные 30д",
};

const STATUS_META: Record<BroadcastJob["status"], { label: string; variant: "accent" | "success" | "warning" | "neutral" }> = {
  pending: { label: "В очереди", variant: "warning" },
  sending: { label: "Идёт рассылка", variant: "accent" },
  done: { label: "Завершено", variant: "success" },
  canceled: { label: "Отменено", variant: "neutral" },
};

function fmtTime(ms: number | null): string {
  return formatMsk(ms, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Mass-message composer + delivery status. Jobs are queued server-side and drained
// by the bot cron in batches, so this tab polls the job list to show live progress.
export default function BroadcastTab({
  fetchWithAuth,
  onSuccess,
  onError,
}: {
  fetchWithAuth: AdminFetchWithAuth;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [segment, setSegment] = useState<Segment>("all");
  const [sending, setSending] = useState(false);
  const [jobs, setJobs] = useState<BroadcastJob[] | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadJobs = useCallback(async () => {
    const res = await fetchWithAuth<{ ok: boolean; jobs: BroadcastJob[] }>("/admin/broadcast");
    if (res?.ok) setJobs(res.jobs || []);
  }, [fetchWithAuth]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // Poll while any job is still in flight so the operator sees progress fill in.
  const hasActive = !!jobs?.some((j) => j.status === "pending" || j.status === "sending");
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (hasActive) {
      pollRef.current = setInterval(loadJobs, 5000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [hasActive, loadJobs]);

  const submit = async () => {
    const text = message.trim();
    if (!text) { onError("Введите текст рассылки."); return; }
    if (!window.confirm(`Отправить рассылку сегменту «${SEGMENT_LABEL[segment]}»? Отменить после старта можно, но уже доставленные сообщения не отзываются.`)) {
      return;
    }
    setSending(true);
    onSuccess("");
    onError("");
    try {
      const res = await fetchWithAuth<{ ok: boolean; jobId: number; totalRecipients: number }>("/admin/broadcast", {
        method: "POST",
        body: JSON.stringify({ message: text, segment }),
      });
      if (res?.ok) {
        onSuccess(`Рассылка поставлена в очередь: получателей ${res.totalRecipients}. Доставка идёт фоново.`);
        setMessage("");
        await loadJobs();
      }
    } finally {
      setSending(false);
    }
  };

  const cancelJob = async (id: number) => {
    if (!window.confirm("Отменить рассылку? Уже отправленные сообщения останутся у пользователей.")) return;
    const res = await fetchWithAuth<{ ok: boolean }>(`/admin/broadcast/${id}/cancel`, { method: "POST" });
    if (res?.ok) { onSuccess("Рассылка отменена."); await loadJobs(); }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <AdminCard>
        <div className="mb-3">
          <h2 className="text-[15px] font-bold text-[var(--tg-theme-text-color,#fff)] tracking-tight">Новая рассылка</h2>
          <div className="text-[12px] text-[var(--tg-theme-hint-color,#999)]">
            Сообщение уходит в личку бота всем, кто не заблокировал его. HTML-теги экранируются — текст отправляется как есть.
          </div>
        </div>

        <div className="mb-4">
          <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-2">Сегмент</div>
          <AdminSegmentedControl<Segment>
            value={segment}
            options={SEGMENT_OPTIONS}
            onChange={setSegment}
            ariaLabel="Сегмент получателей"
          />
        </div>

        <AdminTextarea
          label="Текст сообщения"
          value={message}
          minRows={5}
          maxLength={3500}
          placeholder="Например: ⚽ Сегодня топ-матчи дня уже в приложении — успей сделать прогноз!"
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="mt-1 text-right text-[11px] text-[var(--tg-theme-hint-color,#999)]">{message.length} / 3500</div>

        <div className="mt-4">
          <AdminButton onClick={submit} disabled={sending || !message.trim()} className="w-full !rounded-xl !py-4 font-bold">
            {sending ? "Ставим в очередь…" : "Отправить рассылку"}
          </AdminButton>
        </div>
      </AdminCard>

      <AdminCard>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-bold text-[var(--tg-theme-text-color,#fff)] tracking-tight">История рассылок</h2>
          <button onClick={loadJobs} className="text-[12px] text-[var(--tg-theme-hint-color,#999)] hover:opacity-80">Обновить</button>
        </div>

        {!jobs && <div className="text-[13px] text-[var(--tg-theme-hint-color,#999)]">Загрузка…</div>}
        {jobs && jobs.length === 0 && <div className="text-[13px] text-[var(--tg-theme-hint-color,#999)]">Рассылок ещё не было.</div>}

        <div className="space-y-3">
          {jobs?.map((job) => {
            const meta = STATUS_META[job.status];
            const done = job.sent_count + job.blocked_count + job.failed_count;
            const pct = job.total_recipients > 0 ? Math.min(Math.round((done / job.total_recipients) * 100), 100) : 0;
            return (
              <div
                key={job.id}
                className="p-3 rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.08))] bg-[var(--tg-theme-bg-color,rgba(255,255,255,0.02))]"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <AdminBadge variant={meta.variant}>{meta.label}</AdminBadge>
                    <span className="text-[11px] text-[var(--tg-theme-hint-color,#999)]">{SEGMENT_LABEL[job.segment]}</span>
                  </div>
                  <span className="text-[11px] text-[var(--tg-theme-hint-color,#999)]">{fmtTime(job.created_at)}</span>
                </div>

                <div className="text-[13px] text-[var(--tg-theme-text-color,#fff)] whitespace-pre-wrap break-words mb-2 line-clamp-3">
                  {job.message}
                </div>

                <div className="h-1.5 rounded-full bg-[var(--tg-theme-hint-color,rgba(255,255,255,0.1))] overflow-hidden mb-2">
                  <div className="h-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--tg-theme-hint-color,#999)]">
                  <span>Получателей: <b className="text-[var(--tg-theme-text-color,#fff)]">{job.total_recipients}</b></span>
                  <span>Отправлено: <b className="text-green-400">{job.sent_count}</b></span>
                  <span>Заблокировали: <b className="text-amber-400">{job.blocked_count}</b></span>
                  <span>Ошибки: <b className="text-red-400">{job.failed_count}</b></span>
                </div>

                {job.error && <div className="mt-2 text-[11px] text-red-300">⚠️ {job.error}</div>}

                {(job.status === "pending" || job.status === "sending") && (
                  <div className="mt-3">
                    <AdminButton variant="danger" size="sm" onClick={() => cancelJob(job.id)}>Отменить</AdminButton>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </AdminCard>
    </div>
  );
}

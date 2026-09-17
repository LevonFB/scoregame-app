"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminCard } from "./components/AdminCard";
import { AdminToggle } from "./components/AdminToggle";
import { AdminBadge, AdminButton } from "./components/ui";

type AdminFetchWithAuth = <T = unknown>(path: string, init?: RequestInit) => Promise<T | null>;

type FlagRow = {
  key: string;
  label: string;
  group: string;
  def: boolean;
  envConfigured: string | null;
  override: string | null;
  effective: boolean;
};

// Admin-toggleable feature flags. Reads are visible to admins with the "flags"
// permission; writes are root-only (server returns FORBIDDEN_ROOT_ONLY otherwise).
export default function FlagsTab({
  fetchWithAuth,
  onSuccess,
  onError,
}: {
  fetchWithAuth: AdminFetchWithAuth;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [flags, setFlags] = useState<FlagRow[] | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetchWithAuth<{ ok: boolean; flags: FlagRow[] }>("/admin/flags");
    if (res?.ok) setFlags(res.flags || []);
  }, [fetchWithAuth]);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, FlagRow[]>();
    for (const f of flags || []) {
      if (!map.has(f.group)) map.set(f.group, []);
      map.get(f.group)!.push(f);
    }
    return Array.from(map.entries());
  }, [flags]);

  const setFlag = async (key: string, value: boolean | null) => {
    setSavingKey(key);
    onSuccess("");
    onError("");
    try {
      const res = await fetchWithAuth<{ ok: boolean }>("/admin/flags", {
        method: "PUT",
        body: JSON.stringify({ key, value }),
      });
      if (res?.ok) {
        onSuccess(value === null ? "Оверрайд снят — флаг вернулся к env." : "Флаг сохранён (действует ~30 сек).");
        await load();
      }
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <AdminCard>
        <h2 className="text-[15px] font-bold text-[var(--tg-theme-text-color,#fff)] tracking-tight">Фича-флаги</h2>
        <div className="text-[12px] text-[var(--tg-theme-hint-color,#999)] mt-1">
          Переключение действует в проде без редеплоя (~30 сек). Оверрайд имеет приоритет над env; «Сброс» возвращает флаг к значению из конфигурации. Изменять может только root-админ.
        </div>
      </AdminCard>

      {!flags && <AdminCard><div className="text-[13px] text-[var(--tg-theme-hint-color,#999)]">Загрузка…</div></AdminCard>}

      {groups.map(([group, rows]) => (
        <AdminCard key={group}>
          <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-3">{group}</div>
          <div className="space-y-3">
            {rows.map((f) => (
              <div
                key={f.key}
                className="flex items-start justify-between gap-3 p-3 rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.08))] bg-[var(--tg-theme-bg-color,rgba(255,255,255,0.02))]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-bold text-[var(--tg-theme-text-color,#fff)]">
                    <span>{f.label}</span>
                    {f.override !== null
                      ? <AdminBadge variant="accent" size="sm">оверрайд</AdminBadge>
                      : <AdminBadge variant="neutral" size="sm">env</AdminBadge>}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-[var(--tg-theme-hint-color,#999)] break-all">{f.key}</div>
                  <div className="mt-1 text-[11px] text-[var(--tg-theme-hint-color,#999)]">
                    env: {f.envConfigured ?? "—"} · по умолчанию: {String(f.def)}
                    {f.override !== null && (
                      <button onClick={() => setFlag(f.key, null)} className="ml-2 underline hover:opacity-80" disabled={savingKey === f.key}>
                        сбросить к env
                      </button>
                    )}
                  </div>
                </div>
                <div className="pt-0.5">
                  <AdminToggle
                    checked={f.effective}
                    disabled={savingKey === f.key}
                    onChange={(next) => setFlag(f.key, next)}
                  />
                </div>
              </div>
            ))}
          </div>
        </AdminCard>
      ))}

      {flags && (
        <div className="flex justify-center">
          <AdminButton variant="secondary" size="sm" onClick={load}>Обновить</AdminButton>
        </div>
      )}
    </div>
  );
}

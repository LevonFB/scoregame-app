"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminBadge } from "./components/AdminBadge";
import { AdminButton } from "./components/AdminButton";
import { AdminCard } from "./components/AdminCard";

type FetchWithAuth = <T = unknown>(path: string, options?: RequestInit) => Promise<T | null>;

type Visibility = "visible_to_all" | "admin_only" | "hidden";

type Section = {
  section_key: string;
  // null → top-level section; otherwise the parent section this tab belongs to.
  parent_key?: string | null;
  title: string;
  visibility: Visibility;
  is_enabled: boolean;
};

type ListResponse = { ok: boolean; sections: Section[] };

const VISIBILITY_OPTIONS: Array<{ value: Visibility; label: string }> = [
  { value: "visible_to_all", label: "Всем" },
  { value: "admin_only", label: "Только админам" },
  { value: "hidden", label: "Скрыто" },
];

function visibilityColor(visibility: Visibility): string {
  if (visibility === "hidden") return "#e5484d";
  if (visibility === "admin_only") return "#d98a1a";
  return "#2ec060";
}

function VisibilityPill({ visibility, compact }: { visibility: Visibility; compact?: boolean }) {
  const accent = visibilityColor(visibility);
  return (
    <span style={{
      flexShrink: 0,
      padding: compact ? "2px 8px" : "3px 9px",
      borderRadius: 999,
      fontSize: compact ? 10 : 11,
      fontWeight: 900,
      background: `color-mix(in srgb, ${accent} 16%, transparent)`,
      color: `color-mix(in srgb, ${accent} 82%, var(--tg-text))`,
    }}>
      {VISIBILITY_OPTIONS.find((o) => o.value === visibility)?.label}
    </span>
  );
}

export default function AppSectionsVisibilityTab({ fetchWithAuth }: { fetchWithAuth: FetchWithAuth }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const didLoad = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<ListResponse>("/admin/app-sections/visibility");
      if (!res) return;
      setSections(res.sections || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить разделы");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    void load();
  }, [load]);

  // Group rows under their parent, to any depth (a subsection can itself have
  // subsections). Rows keep the backend's sort order; a row whose parent is
  // missing from the list is shown at top level so it stays manageable instead
  // of disappearing.
  const groups = useMemo(() => {
    const allKeys = new Set(sections.map((s) => s.section_key));
    const children = new Map<string, Section[]>();
    const roots: Section[] = [];
    for (const s of sections) {
      if (!s.parent_key || !allKeys.has(s.parent_key)) { roots.push(s); continue; }
      const list = children.get(s.parent_key) || [];
      list.push(s);
      children.set(s.parent_key, list);
    }
    return { roots, children };
  }, [sections]);

  async function saveSection(section: Section, nextVisibility: Visibility) {
    setSavingKey(section.section_key);
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<{ ok: boolean; section: Section }>(
        `/admin/app-sections/visibility/${encodeURIComponent(section.section_key)}`,
        { method: "PUT", body: JSON.stringify({ visibility: nextVisibility, is_enabled: section.is_enabled }) },
      );
      if (!res) return;
      setSections((prev) => prev.map((s) => s.section_key === section.section_key ? (res.section || { ...s, visibility: nextVisibility }) : s));
      setNotice(`«${section.title}» → ${VISIBILITY_OPTIONS.find((o) => o.value === nextVisibility)?.label}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSavingKey("");
    }
  }

  const visibilityButtons = (section: Section, compact?: boolean) => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6, marginTop: compact ? 8 : 10 }}>
      {VISIBILITY_OPTIONS.map((opt) => {
        const active = section.visibility === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={savingKey === section.section_key || active}
            onClick={() => saveSection(section, opt.value)}
            style={{
              minHeight: compact ? 34 : 40, borderRadius: compact ? 10 : 12, cursor: active ? "default" : "pointer",
              border: active ? "1px solid var(--tg-button, #2481cc)" : "1px solid var(--tg-separator, rgba(128,128,128,0.2))",
              background: active ? "color-mix(in srgb, var(--tg-button, #2481cc) 18%, transparent)" : "var(--tg-secondary-bg, rgba(128,128,128,0.1))",
              color: active ? "var(--tg-button, #2481cc)" : "var(--tg-text, #fff)",
              fontSize: compact ? 11 : 12, fontWeight: 850,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );

  // Nested rows, any depth. Each level indents a little and repeats the "parent
  // closed" note, since that is what actually decides what users see.
  const renderChildren = (parent: Section, depth: number): React.ReactNode => {
    const children = groups.children.get(parent.section_key) || [];
    if (children.length === 0) return null;
    const parentOpen = parent.visibility === "visible_to_all";
    return (
      <div style={{ marginTop: depth === 1 ? 12 : 8, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--tg-hint, #999)" }}>
          {depth === 1 ? "Подразделы" : "Внутри подраздела"}
        </div>
        {!parentOpen && (
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tg-hint, #999)" }}>
            «{parent.title}» закрыт — вложенное недоступно независимо от своих настроек.
          </div>
        )}
        {children.map((child) => (
          <div
            key={child.section_key}
            style={{
              padding: 10,
              borderRadius: 12,
              border: "1px solid var(--tg-separator, rgba(128,128,128,0.2))",
              background: "color-mix(in srgb, var(--tg-secondary-bg, rgba(128,128,128,0.1)) 60%, transparent)",
              opacity: parentOpen ? 1 : 0.75,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: "var(--tg-text, #fff)" }}>{child.title}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tg-hint, #999)" }}>{child.section_key}</div>
              </div>
              <VisibilityPill visibility={child.visibility} compact />
            </div>
            {visibilityButtons(child, true)}
            {renderChildren(child, depth + 1)}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <AdminCard>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 950 }}>Видимость разделов</div>
            <div style={{ marginTop: 2, fontSize: 12, color: "var(--tg-hint, #999)", fontWeight: 700 }}>
              Управляет пунктом меню, вкладками внутри раздела и доступом к ним. Не влияет на данные.
            </div>
          </div>
          <AdminButton size="sm" variant="secondary" onClick={load} disabled={loading}>
            {loading ? "..." : "Обновить"}
          </AdminButton>
        </div>
        {error && <AdminBadge variant="danger" className="w-full justify-start p-3 whitespace-normal h-auto mt-3">{error}</AdminBadge>}
        {notice && <AdminBadge variant="success" className="w-full justify-start p-3 whitespace-normal h-auto mt-3">{notice}</AdminBadge>}
      </AdminCard>

      {groups.roots.map((section) => (
        <AdminCard key={section.section_key}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 900, color: "var(--tg-text, #fff)" }}>{section.title}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tg-hint, #999)" }}>{section.section_key}</div>
            </div>
            <VisibilityPill visibility={section.visibility} />
          </div>
          {visibilityButtons(section)}
          {section.visibility === "hidden" && (
            <AdminBadge variant="warning" className="w-full justify-start p-2 whitespace-normal h-auto mt-2">
              Скрыт для всех пользователей. Доступен только в админке.
            </AdminBadge>
          )}
          {renderChildren(section, 1)}
        </AdminCard>
      ))}

      {!loading && sections.length === 0 && (
        <AdminBadge variant="warning" className="w-full justify-start p-3 whitespace-normal h-auto">
          Список пуст. Примените миграции 0074_app_section_visibility.sql и 0142_app_subsection_visibility.sql.
        </AdminBadge>
      )}
    </div>
  );
}

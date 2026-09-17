"use client";

import { useState } from "react";
import {
  AdminBadge,
  AdminButton,
  AdminCheckbox,
  AdminDataRow,
  AdminInput,
  AdminMetricCard,
  AdminSegmentedControl,
  AdminSelect,
  AdminTextarea,
} from ".";

type PreviewMode = "daily" | "weekly" | "season";

export function AdminUiKitPreview() {
  const [mode, setMode] = useState<PreviewMode>("daily");
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState("active");

  return (
    <div className="space-y-4 rounded-3xl border border-[color-mix(in_srgb,var(--tg-theme-hint-color,var(--tg-hint,#8a8a8a))_16%,transparent)] bg-[var(--tg-theme-bg-color,var(--tg-bg,#0b0f19))] p-4">
      <div>
        <div className="text-[15px] font-black text-[var(--tg-theme-text-color,var(--tg-text,#fff))]">Admin UI Kit Preview</div>
        <div className="mt-1 text-[12px] font-semibold text-[var(--tg-theme-hint-color,var(--tg-hint,#9ca3af))]">
          Dev-only component. Not connected to production navigation.
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <AdminButton variant="primary" size="sm">Primary</AdminButton>
        <AdminButton variant="secondary" size="sm">Secondary</AdminButton>
        <AdminButton variant="ghost" size="sm">Ghost</AdminButton>
        <AdminButton variant="success" size="sm">Success</AdminButton>
        <AdminButton variant="warning" size="sm">Warning</AdminButton>
        <AdminButton variant="danger" size="sm">Danger</AdminButton>
        <AdminButton variant="primary" size="sm" loading>Loading</AdminButton>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <AdminInput label="Title" description="Label and helper text stay separated." value="Daily quest" onChange={() => undefined} />
        <AdminSelect
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "active", label: "Active" },
            { value: "draft", label: "Draft" },
            { value: "locked", label: "Locked" },
          ]}
        />
        <AdminTextarea label="Description" minRows={3} value="Textarea uses the same surface and border." onChange={() => undefined} />
        <AdminCheckbox checked={enabled} onChange={setEnabled} label="Enabled" description="The whole row is clickable and keyboard accessible." />
      </div>

      <AdminSegmentedControl
        ariaLabel="Quest period"
        value={mode}
        onChange={setMode}
        options={[
          { value: "daily", label: "Daily", badge: 8 },
          { value: "weekly", label: "Weekly", badge: 4 },
          { value: "season", label: "Season", badge: 12 },
        ]}
      />

      <div className="flex flex-wrap gap-2">
        <AdminBadge variant="neutral" dot>Neutral</AdminBadge>
        <AdminBadge variant="info" dot>Info</AdminBadge>
        <AdminBadge variant="success" dot>Success</AdminBadge>
        <AdminBadge variant="warning" dot>Warning</AdminBadge>
        <AdminBadge variant="danger" dot>Danger</AdminBadge>
        <AdminBadge variant="accent" dot>Accent</AdminBadge>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <AdminMetricCard label="Matches" value="3" description="Selected today" />
        <AdminMetricCard label="Predictions" value="42" description="Submitted" badge={<AdminBadge variant="success">Live</AdminBadge>} />
      </div>

      <div className="space-y-2">
        <AdminDataRow label="Status" value="active" badge={<AdminBadge variant="success">Displayed</AdminBadge>} />
        <AdminDataRow label="Premium cases" value="x3" description="Long labels wrap instead of merging with value." />
      </div>
    </div>
  );
}

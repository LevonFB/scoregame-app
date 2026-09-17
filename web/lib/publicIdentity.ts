export function firstNonEmpty(...values: Array<unknown>): string | null {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return null;
}

export function getPublicDisplayName(
  value: { displayName?: unknown; display_name?: unknown; name?: unknown; username?: unknown; first_name?: unknown; last_name?: unknown },
  fallback = "Игрок"
): string {
  const firstName = firstNonEmpty(value.first_name);
  const lastName = firstNonEmpty(value.last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  return (
    firstNonEmpty(
      value.displayName,
      value.display_name,
      value.name,
      fullName,
      firstName,
      value.username,
    ) || fallback
  );
}

export function getPublicProfileKey(value: { profileKey?: unknown; profile_key?: unknown } | null | undefined): string | null {
  return firstNonEmpty(value?.profileKey, value?.profile_key);
}

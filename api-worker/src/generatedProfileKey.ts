// Pure reverse mapping for generated profile keys.
//
// Users without a custom nickname get a generated one:
//   buildGeneratedNickname(userId) = `Player${userId.toString(36).toUpperCase()}`
// which normalizeNicknameKey turns into `player<base36-lowercase>`. That format
// is bijective with the user id, so a profile-key lookup that misses
// nickname_normalized can decode the id directly (1-row indexed probe) instead
// of scanning the whole `users` table and re-deriving the key per row.
export function parseGeneratedProfileKeyUserId(normalizedKey: string): number | null {
  const m = /^player([0-9a-z]+)$/.exec(String(normalizedKey || ""));
  if (!m) return null;
  const candidate = parseInt(m[1], 36);
  if (!Number.isSafeInteger(candidate) || candidate <= 0) return null;
  // Canonical round-trip: toString(36) never emits leading zeros, so this
  // rejects non-canonical spellings ("player01") and keeps the mapping
  // one-to-one — the exact match semantics of the old full-table scan.
  if (candidate.toString(36) !== m[1]) return null;
  return candidate;
}

const MODERATION_SAFE_ALLOWLIST = new Set<string>([
  "arsenal",
  "chelsea",
  "liverpool",
  "real madrid",
  "barcelona",
  "manchester united",
  "manchester city",
]);

const MODERATION_RU_ROOTS = [
  "хуй", "хуе", "хуйн", "пизд", "еб", "ёб", "бля", "бляд", "сука", "сучк", "мраз",
  "гандон", "пидор", "пидар", "пидр", "педик", "мудак", "шлюх", "далбаеб", "долбоеб",
  "чмо", "лох", "наци", "гитлер",
];

const MODERATION_EN_ROOTS = [
  "fuck", "shit", "bitch", "cunt", "whore", "slut", "nigg", "fag", "retard", "rape",
  "nazi", "hitler",
];

function stripInvisibleCharacters(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "");
}

export function collapseSpaces(value: unknown): string {
  return stripInvisibleCharacters(value)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeModerationText(value: unknown) {
  const raw = collapseSpaces(value).toLowerCase();
  const ascii = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[@4]/g, "a")
    .replace(/[30]/g, "o")
    .replace(/[13!|]/g, "i")
    .replace(/5|\$/g, "s")
    .replace(/7/g, "t")
    .replace(/8/g, "b")
    .replace(/[^a-zа-яё0-9]+/g, "");

  const cyrillic = ascii
    .replace(/a/g, "а")
    .replace(/b/g, "в")
    .replace(/c/g, "с")
    .replace(/e/g, "е")
    .replace(/h/g, "н")
    .replace(/k/g, "к")
    .replace(/m/g, "м")
    .replace(/o/g, "о")
    .replace(/p/g, "р")
    .replace(/s/g, "с")
    .replace(/t/g, "т")
    .replace(/x/g, "х")
    .replace(/y/g, "у");

  return { raw, ascii, cyrillic };
}

export function containsBlockedText(value: unknown): boolean {
  const { raw, ascii, cyrillic } = normalizeModerationText(value);
  if (!raw) return false;
  if (MODERATION_SAFE_ALLOWLIST.has(raw)) return false;
  if (MODERATION_EN_ROOTS.some((root) => ascii.includes(root))) return true;
  if (MODERATION_RU_ROOTS.some((root) => cyrillic.includes(root))) return true;
  return false;
}

export function validateLeagueNameInput(value: unknown): { ok: true; title: string } | { ok: false; error: string } {
  const title = collapseSpaces(value);
  if (!title || title.length < 2 || title.length > 50) {
    return { ok: false, error: "Название лиги должно быть длиной от 2 до 50 символов." };
  }
  if (containsBlockedText(title)) {
    return { ok: false, error: "Такое название лиги нельзя использовать в приложении." };
  }
  return { ok: true, title };
}

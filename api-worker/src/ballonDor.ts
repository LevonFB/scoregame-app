// Pure helpers for the «Золотой мяч» predictor (ranking nominees 30th → 1st).
// No I/O: index.ts loads the nominees and persists the result.

export const BALLON_DOR_NOMINEE_COUNT = 30;

export type BallonDorRanking = {
  // ranking[0] is the predicted WINNER (1st place), ranking[29] the 30th place.
  // Stored winner-first because that is the order the scoring reads it in; the
  // UI renders it bottom-up (30 → 1) but never reverses what it sends.
  ranking: string[];
};

/**
 * Keeps only known nominee ids, drops duplicates and caps the list at 30.
 * A draft is allowed to be partial — that is the whole point of a draft — so
 * this never throws; `validateBallonDorSubmit` is the gate for a full ballot.
 */
export function sanitizeBallonDorRanking(payload: any, nomineeIds: string[]): BallonDorRanking {
  const known = new Set(nomineeIds.map((id) => String(id)));
  const raw = (payload && typeof payload === "object" && !Array.isArray(payload)) ? payload : {};
  const list = Array.isArray(payload)
    ? payload
    : (Array.isArray(raw.ranking) ? raw.ranking : (Array.isArray(raw.player_ids) ? raw.player_ids : []));

  const seen = new Set<string>();
  const ranking: string[] = [];
  for (const item of list) {
    // Accept both bare ids and {player_id} / {id} objects so a client that
    // posts back the nominee rows verbatim still saves.
    const rawId = (item && typeof item === "object") ? (item.player_id ?? item.id) : item;
    if (rawId === null || rawId === undefined || rawId === "") continue;
    const id = String(rawId).trim();
    if (!id || seen.has(id)) continue;
    if (known.size > 0 && !known.has(id)) continue;
    seen.add(id);
    ranking.push(id);
    if (ranking.length >= BALLON_DOR_NOMINEE_COUNT) break;
  }
  return { ranking };
}

/**
 * Черновик с ПРОПУСКАМИ: слот на каждое место, `null` — место пустое.
 *
 * Зачем отдельно от `ranking`: игрок может начать со второго места или с
 * седьмого, и плотный список это не выражает — при сохранении дырки схлопнулись
 * бы, и после перезагрузки игрок оказался бы не там, куда его ставили.
 * `ranking` остаётся сжатым и по-прежнему единственным, что идёт в подсчёт
 * очков и в проверку при подтверждении; slots — только для восстановления
 * экрана.
 */
export function sanitizeBallonDorSlots(payload: any, nomineeIds: string[], size = BALLON_DOR_NOMINEE_COUNT): Array<string | null> {
  const known = new Set(nomineeIds.map((id) => String(id)));
  const raw = (payload && typeof payload === "object" && !Array.isArray(payload)) ? payload.slots : payload;
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const slots: Array<string | null> = [];
  for (let i = 0; i < size; i++) {
    const item = list[i];
    const rawId = (item && typeof item === "object") ? ((item as any).player_id ?? (item as any).id) : item;
    if (rawId === null || rawId === undefined || rawId === "") { slots.push(null); continue; }
    const id = String(rawId).trim();
    // Неизвестный или повторный id гасим в пустое место, а не роняем черновик.
    if (!id || seen.has(id) || (known.size > 0 && !known.has(id))) { slots.push(null); continue; }
    seen.add(id);
    slots.push(id);
  }
  return slots;
}

/** A ballot may only be submitted when every nominee has been placed exactly once. */
export function validateBallonDorSubmit(sanitized: BallonDorRanking, nomineeIds: string[]) {
  if (!nomineeIds.length) throw new Error("BALLON_DOR_NOMINEES_NOT_CONFIGURED");
  if (sanitized.ranking.length !== nomineeIds.length) throw new Error("BALLON_DOR_RANKING_INCOMPLETE");
  const seen = new Set(sanitized.ranking);
  if (seen.size !== sanitized.ranking.length) throw new Error("BALLON_DOR_RANKING_DUPLICATE");
  for (const id of nomineeIds) {
    if (!seen.has(String(id))) throw new Error("BALLON_DOR_RANKING_INCOMPLETE");
  }
}

/**
 * Place (1-based) each nominee was given, for rendering and scoring.
 * Unplaced nominees are simply absent from the map.
 */
export function ballonDorPlaceById(sanitized: BallonDorRanking): Map<string, number> {
  return new Map(sanitized.ranking.map((id, index) => [id, index + 1]));
}

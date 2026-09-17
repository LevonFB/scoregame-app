// ballonDorMatching.ts
// Чистое сопоставление имён при обогащении номинантов «Золотого мяча» из
// провайдера. Без I/O.
//
// Строгое равенство нормализованных имён не работает в обе стороны:
//   • клубы у нас засеяны короткими именами («Barcelona», «Chelsea»), а в базе
//     команд лежат провайдерские («FC Barcelona», «Chelsea FC»);
//   • игроки засеяны так, как их печатает France Football («Vinícius Júnior»),
//     а провайдер отдаёт полное имя («Vinicius Jose Paixao de Oliveira Junior»).
//
// Поэтому: сначала точное совпадение, затем — вхождение по НАБОРУ СЛОВ
// (все слова запроса есть в кандидате). Подстроку не используем: «Inter» так
// совпал бы с «Internazionale», а слова дают честную границу.

import { normalizePlayerNameForSearch } from "./seasonPredictionPlayers";

export function nameTokens(value: unknown): string[] {
  const normalized = normalizePlayerNameForSearch(value);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

export type MatchResult<T> =
  | { kind: "exact"; value: T }
  | { kind: "loose"; value: T }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "none" };

/**
 * Ищет запись по имени среди кандидатов.
 * `candidates` — пары [отображаемое имя, значение]; ключ считается из имени.
 *
 * Неоднозначность НЕ разрешается «первым попавшимся»: два подходящих кандидата
 * возвращаются как ambiguous, чтобы вызывающий показал их админу, а не подставил
 * наугад. Пример из жизни: «Gabriel» в «Арсенале» — это и Gabriel Magalhães,
 * и Gabriel Jesus, и Gabriel Martinelli.
 */
export function matchByName<T>(query: unknown, candidates: Array<[string, T]>): MatchResult<T> {
  const queryKey = normalizePlayerNameForSearch(query);
  if (!queryKey) return { kind: "none" };

  for (const [name, value] of candidates) {
    if (normalizePlayerNameForSearch(name) === queryKey) return { kind: "exact", value };
  }

  const queryTokens = nameTokens(query);
  if (!queryTokens.length) return { kind: "none" };

  const loose: Array<[string, T]> = [];
  for (const [name, value] of candidates) {
    const tokens = new Set(nameTokens(name));
    if (tokens.size === 0) continue;
    // Основное направление — запрос короче кандидата: «Barcelona» ⊂ «FC
    // Barcelona», «Vinícius Júnior» ⊂ «Vinicius Jose Paixao de Oliveira Junior».
    const queryInCandidate = queryTokens.every((token) => tokens.has(token));
    // Обратное направление опаснее: односложный кандидат проглатывает длинный
    // запрос — «Inter Miami» совпал бы с миланским «Inter» и увёл бы к чужому
    // ростеру. Поэтому кандидат из одного слова так не берём: лучше остаться
    // без фото, чем подставить чужого игрока.
    const candidateInQuery = tokens.size >= 2 && [...tokens].every((token) => queryTokens.includes(token));
    if (queryInCandidate || candidateInQuery) loose.push([name, value]);
  }

  if (loose.length === 1) return { kind: "loose", value: loose[0][1] };
  if (loose.length > 1) return { kind: "ambiguous", candidates: loose.map(([name]) => name) };
  return { kind: "none" };
}

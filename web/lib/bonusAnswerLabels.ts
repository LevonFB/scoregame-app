/**
 * Display helpers for bonus question answers.
 *
 * user_goalscorer answers are stored (and scored on the backend) as a raw
 * player_id string. The UI must never show that id directly — it has to be
 * resolved into "Имя Фамилия · Команда" via the squad list or a locally
 * persisted snapshot, with a readable "Игрок #id" fallback.
 */

export type SquadPlayer = { id: string; name: string };
export type MatchSquad = { home: SquadPlayer[]; away: SquadPlayer[] };
export type UgPlayerSnapshot = Record<string, { n: string; t?: string }>;

/** Sentinel answer for "никто не забьёт" (mirrors USER_GOALSCORER_NONE_ANSWER on the API). */
export const UG_NONE_ANSWER = "__none__";
export const UG_NONE_LABEL = "Никто не забьёт";

export const UG_LABELS_STORAGE_KEY = "sg_ug_player_labels_v1";
const UG_SNAPSHOT_MAX_ENTRIES = 300;

export function readUgPlayerSnapshot(): UgPlayerSnapshot {
    if (typeof window === "undefined") return {};
    try {
        const raw = window.localStorage.getItem(UG_LABELS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

export function saveUgPlayerSnapshot(
    snapshot: UgPlayerSnapshot,
    playerId: string,
    name: string,
    teamName?: string
): UgPlayerSnapshot {
    const next: UgPlayerSnapshot = { ...snapshot, [playerId]: { n: name, ...(teamName ? { t: teamName } : {}) } };
    // Keep the cache bounded — drop oldest entries beyond the cap.
    const keys = Object.keys(next);
    if (keys.length > UG_SNAPSHOT_MAX_ENTRIES) {
        for (const key of keys.slice(0, keys.length - UG_SNAPSHOT_MAX_ENTRIES)) delete next[key];
    }
    if (typeof window !== "undefined") {
        try { window.localStorage.setItem(UG_LABELS_STORAGE_KEY, JSON.stringify(next)); } catch { /* storage full/blocked — in-memory still works */ }
    }
    return next;
}

/**
 * Resolve a stored player_id into a human-readable label.
 * Resolution order: squad list → local snapshot → "Игрок #id".
 */
export function resolveUgPlayerLabel(
    playerId: string | null | undefined,
    squad: MatchSquad | null | undefined,
    snapshot: UgPlayerSnapshot,
    opts?: { homeTeam?: string; awayTeam?: string; withTeam?: boolean }
): string | null {
    if (!playerId) return null;
    if (playerId === UG_NONE_ANSWER) return UG_NONE_LABEL;
    const withTeam = opts?.withTeam !== false;

    if (squad) {
        const inHome = (squad.home || []).find(p => p.id === playerId);
        if (inHome) return withTeam && opts?.homeTeam ? `${inHome.name} · ${opts.homeTeam}` : inHome.name;
        const inAway = (squad.away || []).find(p => p.id === playerId);
        if (inAway) return withTeam && opts?.awayTeam ? `${inAway.name} · ${opts.awayTeam}` : inAway.name;
    }

    const snap = snapshot[playerId];
    if (snap?.n) return withTeam && snap.t ? `${snap.n} · ${snap.t}` : snap.n;

    return `Игрок #${playerId}`;
}

/**
 * Generic display label for any bonus answer.
 * - player questions (user_goalscorer): resolve player_id → name · team;
 * - everything else: the caller-provided option label lookup.
 */
export function getBonusAnswerDisplayLabel(
    questionType: string,
    answer: string | null | undefined,
    optionLabel: string | null,
    squad: MatchSquad | null | undefined,
    snapshot: UgPlayerSnapshot,
    opts?: { homeTeam?: string; awayTeam?: string }
): string | null {
    if (!answer) return null;
    if (questionType === "user_goalscorer") {
        return resolveUgPlayerLabel(answer, squad, snapshot, { ...opts, withTeam: true });
    }
    return optionLabel;
}

/**
 * Is a user_goalscorer answer correct? `correctAnswerJson` is the resolved list of
 * actual goalscorer ids; an empty list means the match ended goalless, so only the
 * "никто" answer wins.
 */
export function isUgAnswerCorrect(answer: string | null | undefined, correctAnswerJson: string | null | undefined): boolean {
    if (!answer || !correctAnswerJson) return false;
    let ids: unknown;
    try { ids = JSON.parse(correctAnswerJson); } catch { return false; }
    if (!Array.isArray(ids)) return false;
    const scorerIds = ids.map(String);
    if (answer === UG_NONE_ANSWER) return scorerIds.length === 0;
    return scorerIds.includes(answer);
}

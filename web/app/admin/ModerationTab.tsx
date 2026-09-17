import { useState, useEffect } from "react";
import { AdminCollapsibleSection } from "./components/AdminCollapsibleSection";
import {
    AdminBadge,
    AdminButton,
    AdminDataRow,
    AdminInput,
    AdminSegmentedControl,
    AdminSelect,
} from "./components/ui";
import { apiFetch, getApiInitData } from "@/lib/api";

type WordLang = 'ru' | 'en' | 'allowlist';

type BannedWord = {
    id: number;
    word: string;
    lang: WordLang;
};

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error || "Ошибка");
}

type AdminLeague = {
    id: string;
    name: string | null;
    owner_id: number | null;
    type: 'private' | 'channel';
    created_at: string | null;
    deleted_at: string | null;
    telegram_chat_title?: string | null;
    telegram_chat_username?: string | null;
    owner_username?: string | null;
    owner_first_name?: string | null;
    members_count?: number | null;
};

type AdminLeagueMember = {
    user_id: number;
    role: 'owner' | 'member';
    joined_at: string | null;
    username?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    nickname?: string | null;
};

function LeaguesModerationSection() {
    const [leagues, setLeagues] = useState<AdminLeague[]>([]);
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [members, setMembers] = useState<AdminLeagueMember[]>([]);
    const [membersLoading, setMembersLoading] = useState(false);
    const [renameId, setRenameId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");

    const authHeaders = () => ({ "x-telegram-init-data": getApiInitData() });

    const loadLeagues = async (q: string) => {
        setLoading(true);
        setError("");
        try {
            const res = await apiFetch<{ ok: boolean, leagues: AdminLeague[] }>(`/admin/leagues${q ? `?q=${encodeURIComponent(q)}` : ""}`, {
                headers: authHeaders(),
            });
            if (res?.ok) setLeagues(res.leagues || []);
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadLeagues(""); }, []);

    const toggleMembers = async (leagueId: string) => {
        if (expandedId === leagueId) { setExpandedId(null); setMembers([]); return; }
        setExpandedId(leagueId);
        setMembers([]);
        setMembersLoading(true);
        try {
            const res = await apiFetch<{ ok: boolean, members: AdminLeagueMember[] }>(`/admin/leagues/${leagueId}/members`, {
                headers: authHeaders(),
            });
            if (res?.ok) setMembers(res.members || []);
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setMembersLoading(false);
        }
    };

    const handleRename = async (leagueId: string) => {
        const name = renameValue.trim();
        if (!name) return;
        setActionLoading(true);
        setError("");
        setSuccess("");
        try {
            const res = await apiFetch<{ ok: boolean, error?: string }>(`/admin/leagues/${leagueId}/rename`, {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify({ name }),
            });
            if (res?.ok) {
                setSuccess(`Лига переименована в «${name}».`);
                setRenameId(null);
                setRenameValue("");
                await loadLeagues(query);
            } else {
                setError(res?.error || "Ошибка переименования");
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteLeague = async (league: AdminLeague) => {
        if (!confirm(`Удалить лигу «${league.name || league.id}»? Все участники будут исключены.`)) return;
        setActionLoading(true);
        setError("");
        setSuccess("");
        try {
            const res = await apiFetch<{ ok: boolean, error?: string }>(`/admin/leagues/${league.id}/delete`, {
                method: "POST",
                headers: authHeaders(),
            });
            if (res?.ok) {
                setSuccess(`Лига «${league.name || league.id}» удалена.`);
                if (expandedId === league.id) { setExpandedId(null); setMembers([]); }
                await loadLeagues(query);
            } else {
                setError(res?.error || "Ошибка удаления лиги");
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setActionLoading(false);
        }
    };

    const handleKickMember = async (leagueId: string, member: AdminLeagueMember) => {
        const label = member.username ? `@${member.username}` : `ID ${member.user_id}`;
        if (!confirm(`Исключить ${label} из лиги?`)) return;
        setActionLoading(true);
        setError("");
        setSuccess("");
        try {
            const res = await apiFetch<{ ok: boolean, error?: string }>(`/admin/leagues/${leagueId}/members/${member.user_id}/remove`, {
                method: "POST",
                headers: authHeaders(),
            });
            if (res?.ok) {
                setSuccess(`${label} исключён из лиги.`);
                setMembers((prev) => prev.filter((m) => m.user_id !== member.user_id));
                await loadLeagues(query);
            } else {
                setError(res?.error || "Ошибка исключения участника");
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setActionLoading(false);
        }
    };

    return (
        <AdminCollapsibleSection
            title="Лиги"
            description={`${leagues.length} лиг · модерация названий, удаление, исключение участников`}
            keepMounted
            storageKey="admin:moderation:leagues"
        >
            <div className="space-y-3">
                {error && (
                    <div className="rounded-2xl border border-[color-mix(in_srgb,#ff5a52_40%,transparent)] bg-[color-mix(in_srgb,#ff5a52_12%,transparent)] px-3 py-3 text-[13px] font-semibold leading-snug text-[color-mix(in_srgb,#ff5a52_88%,var(--tg-theme-text-color,#fff))]">
                        {error}
                    </div>
                )}
                {success && (
                    <div className="rounded-2xl border border-[color-mix(in_srgb,#34c759_36%,transparent)] bg-[color-mix(in_srgb,#34c759_12%,transparent)] px-3 py-3 text-[13px] font-semibold leading-snug text-[color-mix(in_srgb,#34c759_88%,var(--tg-theme-text-color,#fff))]">
                        {success}
                    </div>
                )}

                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="flex-1">
                        <AdminInput
                            label="Поиск лиги"
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && loadLeagues(query)}
                            placeholder="ID, название или владелец"
                            prefix="🔍"
                        />
                    </div>
                    <AdminButton variant="primary" loading={loading} onClick={() => loadLeagues(query)} className="w-full sm:w-auto">
                        Найти
                    </AdminButton>
                </div>

                {leagues.length === 0 && !loading && (
                    <div className="rounded-2xl border border-dashed border-[var(--tg-theme-hint-color,rgba(255,255,255,0.1))] py-8 text-center text-[13px] font-semibold text-[var(--tg-theme-hint-color,#999)]">
                        Лиги не найдены
                    </div>
                )}

                <div className="space-y-2">
                    {leagues.map((league) => (
                        <div
                            key={league.id}
                            className="space-y-3 rounded-2xl border border-[color-mix(in_srgb,var(--tg-theme-hint-color,#8a8a8a)_14%,transparent)] bg-[color-mix(in_srgb,var(--tg-theme-secondary-bg-color,#111827)_62%,var(--tg-theme-bg-color,#0b0f19))] p-3"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-2">
                                    <AdminBadge variant={league.type === 'channel' ? 'info' : 'neutral'} size="sm">
                                        {league.type === 'channel' ? 'канал' : 'частная'}
                                    </AdminBadge>
                                    <span className="min-w-0 break-all text-[13px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">
                                        {league.name || league.telegram_chat_title || league.id}
                                    </span>
                                    {league.deleted_at && <AdminBadge variant="danger" size="sm">удалена</AdminBadge>}
                                </div>
                                <span className="text-[11px] font-semibold text-[var(--tg-theme-hint-color,#999)]">
                                    {league.members_count ?? 0} участн.
                                </span>
                            </div>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <AdminDataRow label="ID" value={league.id} />
                                <AdminDataRow
                                    label="Владелец"
                                    value={league.owner_username ? `@${league.owner_username}` : (league.owner_first_name || (league.owner_id ? `ID ${league.owner_id}` : "—"))}
                                />
                            </div>
                            {!league.deleted_at && (
                                <div className="flex flex-wrap gap-2">
                                    <AdminButton variant="secondary" size="sm" onClick={() => toggleMembers(league.id)} disabled={actionLoading}>
                                        {expandedId === league.id ? "Скрыть участников" : "Участники"}
                                    </AdminButton>
                                    <AdminButton
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => { setRenameId(renameId === league.id ? null : league.id); setRenameValue(league.name || ""); }}
                                        disabled={actionLoading}
                                    >
                                        Переименовать
                                    </AdminButton>
                                    <AdminButton variant="danger" size="sm" onClick={() => handleDeleteLeague(league)} disabled={actionLoading}>
                                        Удалить лигу
                                    </AdminButton>
                                </div>
                            )}
                            {renameId === league.id && !league.deleted_at && (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                                    <div className="flex-1">
                                        <AdminInput
                                            label="Новое название"
                                            type="text"
                                            value={renameValue}
                                            onChange={(e) => setRenameValue(e.target.value)}
                                            placeholder="Название лиги"
                                        />
                                    </div>
                                    <AdminButton variant="warning" size="sm" loading={actionLoading} disabled={!renameValue.trim()} onClick={() => handleRename(league.id)} className="w-full sm:w-auto">
                                        Сохранить
                                    </AdminButton>
                                </div>
                            )}
                            {expandedId === league.id && (
                                <div className="space-y-2">
                                    {membersLoading && (
                                        <div className="text-[12px] font-semibold text-[var(--tg-theme-hint-color,#999)] animate-pulse">Загрузка участников…</div>
                                    )}
                                    {!membersLoading && members.length === 0 && (
                                        <div className="text-[12px] font-semibold text-[var(--tg-theme-hint-color,#999)]">Нет участников</div>
                                    )}
                                    {members.map((m) => (
                                        <div key={m.user_id} className="flex items-center justify-between gap-2 rounded-xl border border-[color-mix(in_srgb,var(--tg-theme-hint-color,#8a8a8a)_12%,transparent)] p-2.5">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <AdminBadge variant={m.role === 'owner' ? 'warning' : 'neutral'} size="sm">
                                                    {m.role === 'owner' ? 'владелец' : 'участник'}
                                                </AdminBadge>
                                                <span className="min-w-0 truncate text-[12px] font-semibold text-[var(--tg-theme-text-color,#fff)]">
                                                    {m.nickname || `${m.first_name || ""} ${m.last_name || ""}`.trim() || `ID ${m.user_id}`}
                                                    {m.username ? ` · @${m.username}` : ""}
                                                </span>
                                            </div>
                                            {m.role !== 'owner' && (
                                                <AdminButton variant="danger" size="sm" onClick={() => handleKickMember(league.id, m)} disabled={actionLoading} className="shrink-0">
                                                    Исключить
                                                </AdminButton>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </AdminCollapsibleSection>
    );
}

const langColors: Record<WordLang, "warning" | "danger" | "success"> = {
    ru: 'warning',
    en: 'danger',
    allowlist: 'success',
};

const langLabels: Record<WordLang, string> = {
    ru: 'RU Мат',
    en: 'EN Мат/Запрет',
    allowlist: 'Исключения (Safe)',
};

const langShort: Record<WordLang, string> = {
    ru: 'RU',
    en: 'EN',
    allowlist: 'SAFE',
};

export default function ModerationTab() {
    const [words, setWords] = useState<BannedWord[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const [newWord, setNewWord] = useState("");
    const [newLang, setNewLang] = useState<WordLang>('ru');
    const [filterLang, setFilterLang] = useState<'all' | WordLang>('all');
    const [search, setSearch] = useState("");

    const loadWords = async () => {
        setLoading(true);
        setError("");
        try {
            const initData = getApiInitData();
            const res = await apiFetch<{ ok: boolean, words: BannedWord[] }>('/admin/banned-words', {
                headers: { "x-telegram-init-data": initData }
            });
            if (res?.ok) {
                setWords(res.words || []);
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e) || "Ошибка загрузки списка");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadWords();
    }, []);

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        const cleanWord = newWord.trim().toLowerCase();
        if (!cleanWord) return;

        setActionLoading(true);
        setError("");
        setSuccess("");
        try {
            const initData = getApiInitData();
            const res = await apiFetch<{ ok: boolean, error?: string }>('/admin/banned-words', {
                method: "POST",
                headers: { "x-telegram-init-data": initData },
                body: JSON.stringify({ word: cleanWord, lang: newLang })
            });

            if (res?.ok) {
                setSuccess(`Добавлено: ${cleanWord}`);
                setNewWord("");
                await loadWords();
                setTimeout(() => setSuccess(""), 3000);
            } else {
                setError(res?.error === 'ALREADY_EXISTS' ? 'Слово уже существует' : (res?.error || "Ошибка добавления"));
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setActionLoading(false);
        }
    };

    const handleDelete = async (id: number, wordStr: string) => {
        if (!confirm(`Точно удалить «${wordStr}» из базы модерации?`)) return;

        setActionLoading(true);
        setError("");
        setSuccess("");
        try {
            const initData = getApiInitData();
            const res = await apiFetch<{ ok: boolean, error?: string }>(`/admin/banned-words/${id}`, {
                method: "DELETE",
                headers: { "x-telegram-init-data": initData }
            });

            if (res?.ok) {
                setSuccess(`Удалено: ${wordStr}`);
                await loadWords();
                setTimeout(() => setSuccess(""), 3000);
            } else {
                setError(res?.error || "Ошибка удаления");
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setActionLoading(false);
        }
    };

    const displayWords = words
        .filter(w => filterLang === 'all' || w.lang === filterLang)
        .filter(w => !search || w.word.includes(search.toLowerCase().trim()));

    const ruCount = words.filter(w => w.lang === 'ru').length;
    const enCount = words.filter(w => w.lang === 'en').length;
    const allowCount = words.filter(w => w.lang === 'allowlist').length;
    const filtersActive = filterLang !== 'all' || search.trim() !== '';

    return (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center gap-2 px-1">
                <div className="h-4 w-1 rounded-full bg-red-500" />
                <h2 className="text-[15px] font-extrabold tracking-tight text-[var(--tg-theme-text-color,#fff)]">Модерация</h2>
            </div>

            <LeaguesModerationSection />

            {error && (
                <div className="rounded-2xl border border-[color-mix(in_srgb,#ff5a52_40%,transparent)] bg-[color-mix(in_srgb,#ff5a52_12%,transparent)] px-3 py-3 text-[13px] font-semibold leading-snug text-[color-mix(in_srgb,#ff5a52_88%,var(--tg-theme-text-color,#fff))]">
                    {error}
                </div>
            )}
            {success && (
                <div className="rounded-2xl border border-[color-mix(in_srgb,#34c759_36%,transparent)] bg-[color-mix(in_srgb,#34c759_12%,transparent)] px-3 py-3 text-[13px] font-semibold leading-snug text-[color-mix(in_srgb,#34c759_88%,var(--tg-theme-text-color,#fff))]">
                    {success}
                </div>
            )}

            <AdminCollapsibleSection
                title="Добавить правило"
                description="Новое слово или исключение в базе модерации"
                badge={<AdminBadge variant="info" size="sm">новое</AdminBadge>}
                defaultOpen={words.length === 0}
                keepMounted
                storageKey="admin:moderation:add"
            >
                <form onSubmit={handleAdd} className="space-y-3">
                    <AdminInput
                        label="Слово или фраза"
                        description="RU/EN триггерят фильтр как часть слова (корень). Исключения (Safe) спасают только при точном совпадении всего никнейма."
                        type="text"
                        value={newWord}
                        onChange={e => setNewWord(e.target.value)}
                        placeholder="Например: arsenal"
                        required
                    />
                    <AdminSelect
                        label="Тип правила"
                        value={newLang}
                        onChange={value => setNewLang(value as WordLang)}
                        options={[
                            { value: 'ru', label: langLabels.ru },
                            { value: 'en', label: langLabels.en },
                            { value: 'allowlist', label: langLabels.allowlist },
                        ]}
                    />
                    <AdminButton type="submit" variant="primary" loading={actionLoading} disabled={!newWord.trim()} fullWidth>
                        Добавить
                    </AdminButton>
                </form>
            </AdminCollapsibleSection>

            <AdminCollapsibleSection
                title="Фильтры"
                description={filtersActive ? "Фильтр активен" : "Тип и поиск по списку"}
                defaultOpen={filtersActive}
                keepMounted
                storageKey="admin:moderation:filters"
            >
                <div className="space-y-3">
                    <AdminSegmentedControl<'all' | WordLang>
                        ariaLabel="Фильтр по типу правила"
                        value={filterLang}
                        onChange={setFilterLang}
                        options={[
                            { value: 'all', label: 'Все' },
                            { value: 'ru', label: langLabels.ru },
                            { value: 'en', label: langLabels.en },
                            { value: 'allowlist', label: langLabels.allowlist },
                        ]}
                    />
                    <AdminInput
                        label="Поиск"
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Поиск по слову..."
                        prefix="🔍"
                    />
                </div>
            </AdminCollapsibleSection>

            <AdminCollapsibleSection
                title="Список правил"
                description={`Всего ${words.length} · RU ${ruCount} · EN ${enCount} · safe ${allowCount}`}
                defaultOpen
                storageKey="admin:moderation:list"
            >
                {loading ? (
                    <div className="rounded-2xl border border-dashed border-[var(--tg-theme-hint-color,rgba(255,255,255,0.1))] py-8 text-center text-[13px] font-semibold text-[var(--tg-theme-hint-color,#999)] animate-pulse">
                        Загрузка словаря...
                    </div>
                ) : displayWords.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-[var(--tg-theme-hint-color,rgba(255,255,255,0.1))] py-8 text-center text-[13px] font-semibold text-[var(--tg-theme-hint-color,#999)]">
                        Слова не найдены
                    </div>
                ) : (
                    <div className="space-y-2">
                        {displayWords.map(w => (
                            <div
                                key={w.id}
                                className="flex items-center justify-between gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--tg-theme-hint-color,#8a8a8a)_14%,transparent)] bg-[color-mix(in_srgb,var(--tg-theme-secondary-bg-color,#111827)_62%,var(--tg-theme-bg-color,#0b0f19))] p-3"
                            >
                                <div className="flex min-w-0 items-center gap-2.5">
                                    <AdminBadge variant={langColors[w.lang]} size="sm">{langShort[w.lang]}</AdminBadge>
                                    <span className="min-w-0 break-all font-mono text-[13px] font-semibold text-[var(--tg-theme-text-color,#fff)]">{w.word}</span>
                                </div>
                                <AdminButton
                                    variant="danger"
                                    size="sm"
                                    onClick={() => handleDelete(w.id, w.word)}
                                    disabled={actionLoading}
                                    aria-label={`Удалить ${w.word}`}
                                    className="shrink-0"
                                >
                                    Удалить
                                </AdminButton>
                            </div>
                        ))}
                    </div>
                )}
            </AdminCollapsibleSection>
        </div>
    );
}

"use client";

export type LeaderboardSeasonOption = {
    id: number;
    name: string;
    status: "active" | "finalizing" | "finished" | "archived";
    startsAt: string;
    endsAt: string;
    finalizedAt?: string | null;
    archivedAt?: string | null;
    isCurrent?: boolean;
};

function statusLabel(status: LeaderboardSeasonOption["status"]) {
    if (status === "active") return "текущий";
    if (status === "finalizing") return "финализация";
    if (status === "finished") return "завершён";
    return "архив";
}

export function LeaderboardSeasonSelector({
    seasons,
    selectedSeasonId,
    onSelect,
}: {
    seasons: LeaderboardSeasonOption[];
    selectedSeasonId: number | null;
    onSelect: (seasonId: number) => void;
}) {
    if (!seasons.length) return null;

    return (
        <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: "var(--tg-hint)", marginBottom: 8 }}>Сезон</div>
            <div
                style={{
                    display: "flex",
                    gap: 8,
                    overflowX: "auto",
                    paddingBottom: 4,
                    scrollbarWidth: "none",
                }}
            >
                {seasons.map((season) => {
                    const selected = selectedSeasonId === season.id;
                    return (
                        <button
                            key={season.id}
                            onClick={() => onSelect(season.id)}
                            style={{
                                border: selected ? "none" : "1px solid var(--tg-separator, rgba(128,128,128,0.15))",
                                background: selected ? "var(--tg-button)" : "var(--tg-bg)",
                                color: selected ? "var(--tg-button-text)" : "var(--tg-text)",
                                borderRadius: 14,
                                padding: "10px 12px",
                                minWidth: 132,
                                textAlign: "left",
                                cursor: "pointer",
                                flexShrink: 0,
                                boxShadow: selected ? "0 2px 6px rgba(0,0,0,0.12)" : "none",
                            }}
                        >
                            <div
                                style={{
                                    fontSize: 13,
                                    fontWeight: 700,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                }}
                            >
                                {season.name}
                            </div>
                            <div
                                style={{
                                    marginTop: 4,
                                    fontSize: 11,
                                    opacity: selected ? 0.92 : 0.7,
                                    textTransform: "uppercase",
                                    letterSpacing: 0.2,
                                }}
                            >
                                {season.isCurrent ? "текущий" : statusLabel(season.status)}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

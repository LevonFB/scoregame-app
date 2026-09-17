"use client";

/**
 * Unified User Avatar component.
 * Used everywhere: header, profile, leaderboards, leagues, member lists.
 *
 * The wrapper uses a fixed size and `overflow: visible` so it never clips in
 * flex containers. Negative margins are avoided to prevent alignment issues.
 *
 * (The seasonal "level" mechanic was removed in Stage 1, so this component no
 * longer renders a level badge or gold frame.)
 */

type UserAvatarProps = {
    photoUrl?: string | null;
    name: string;
    size?: number;
    onClick?: () => void;
};

const AVATAR_COLORS = [
    "#ff9500", "#ff3b30", "#5856d6", "#007aff",
    "#34c759", "#af52de", "#ff2d55", "#5ac8fa",
];

function getAvatarColor(name: string): string {
    const hash = Math.abs(
        name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0)
    );
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export default function UserAvatar({
    photoUrl,
    name,
    size = 36,
    onClick,
}: UserAvatarProps) {
    const initial = (name || "U").charAt(0).toUpperCase();

    return (
        <div
            onClick={onClick}
            style={{
                position: "relative",
                width: size,
                height: size,
                flexShrink: 0,
                overflow: "visible",
                cursor: onClick ? "pointer" : "default",
            }}
        >
            {/* Avatar circle */}
            {photoUrl ? (
                <img
                    src={photoUrl}
                    alt=""
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        zIndex: 1,
                        width: size,
                        height: size,
                        borderRadius: "50%",
                        objectFit: "cover",
                        display: "block",
                    }}
                />
            ) : (
                <div
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        zIndex: 1,
                        width: size,
                        height: size,
                        borderRadius: "50%",
                        background: getAvatarColor(name),
                        color: "white",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: Math.round(size * 0.42),
                        fontWeight: 700,
                    }}
                >
                    {initial}
                </div>
            )}
        </div>
    );
}

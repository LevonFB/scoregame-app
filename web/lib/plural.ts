// Russian plural helpers.

/** Pick the correct Russian plural form for `n`. */
export function pluralRu(n: number, one: string, few: string, many: string): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
}

/** "1 участник" / "2 участника" / "5 участников". */
export function membersLabel(n: number): string {
    return `${n} ${pluralRu(n, "участник", "участника", "участников")}`;
}

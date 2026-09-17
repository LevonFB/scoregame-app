/**
 * Dev-check for bonus answer display helpers (no test runner in web/).
 * Run: npx tsx scripts/check-bonus-answer-labels.ts
 */

import { resolveUgPlayerLabel, getBonusAnswerDisplayLabel } from "../lib/bonusAnswerLabels";

function assertEqual(actual: unknown, expected: unknown, label: string) {
    if (actual !== expected) {
        console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        process.exitCode = 1;
    } else {
        console.log(`ok   ${label}`);
    }
}

const squad = {
    home: [{ id: "192442", name: "Эрлинг Холанд" }],
    away: [{ id: "555", name: "Мохамед Салах" }],
};
const teams = { homeTeam: "Манчестер Сити", awayTeam: "Ливерпуль" };

// 1. answer = "192442", options/squad contain the player → name · team, not the id
assertEqual(
    resolveUgPlayerLabel("192442", squad, {}, teams),
    "Эрлинг Холанд · Манчестер Сити",
    "squad resolves id to name · team"
);
assertEqual(
    resolveUgPlayerLabel("555", squad, {}, teams),
    "Мохамед Салах · Ливерпуль",
    "away side resolves with away team"
);

// 2. no squad, but local snapshot has the player
assertEqual(
    resolveUgPlayerLabel("192442", null, { "192442": { n: "Эрлинг Холанд", t: "Манчестер Сити" } }, teams),
    "Эрлинг Холанд · Манчестер Сити",
    "snapshot resolves without squad"
);
assertEqual(
    resolveUgPlayerLabel("192442", null, { "192442": { n: "Эрлинг Холанд" } }, teams),
    "Эрлинг Холанд",
    "snapshot without team gives bare name"
);

// 3. nothing available → readable fallback, never the bare id
assertEqual(
    resolveUgPlayerLabel("192442", null, {}, teams),
    "Игрок #192442",
    "fallback is 'Игрок #id'"
);

// 4. withTeam=false keeps just the name
assertEqual(
    resolveUgPlayerLabel("192442", squad, {}, { ...teams, withTeam: false }),
    "Эрлинг Холанд",
    "withTeam=false omits team"
);

// 5. generic helper: player question routes through the resolver…
assertEqual(
    getBonusAnswerDisplayLabel("user_goalscorer", "192442", null, squad, {}, teams),
    "Эрлинг Холанд · Манчестер Сити",
    "display helper resolves player question"
);
// …and option questions keep their option label
assertEqual(
    getBonusAnswerDisplayLabel("total_goals", "yes", "Да", null, {}, teams),
    "Да",
    "display helper passes through option label"
);
// empty answer → null
assertEqual(
    getBonusAnswerDisplayLabel("user_goalscorer", null, null, squad, {}, teams),
    null,
    "no answer → null"
);

console.log(process.exitCode ? "\nFAILED" : "\nAll checks passed");

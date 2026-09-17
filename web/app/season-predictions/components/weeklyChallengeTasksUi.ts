import type { WeeklyChallengeUnclaimedRewardsResponse } from "../types";

export function shouldShowWeeklyUnclaimedArchive(data: WeeklyChallengeUnclaimedRewardsResponse | null): boolean {
  return !!data && (data.items.length > 0 || !!data.next_cursor);
}

export function mergeWeeklyUnclaimedRewardsPage(
  previous: WeeklyChallengeUnclaimedRewardsResponse | null,
  next: WeeklyChallengeUnclaimedRewardsResponse,
  cursor?: string | null,
): WeeklyChallengeUnclaimedRewardsResponse {
  if (!cursor || !previous) return next;
  const existingIds = new Set(previous.items.map((item) => item.challenge.id));
  const nextItems = next.items.filter((item) => !existingIds.has(item.challenge.id));
  return {
    ...next,
    items: [...previous.items, ...nextItems],
    total_claimable: previous.total_claimable + next.total_claimable,
  };
}

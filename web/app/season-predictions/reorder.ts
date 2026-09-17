import { arrayMove } from "@dnd-kit/sortable";

/**
 * Pure id-based reorder used by the league-table drag editor.
 * Moves the item identified by `activeId` to the position of `overId`.
 * Returns the original array (same reference) when ids are equal, unknown,
 * or the list contains no usable ids — so callers can safely no-op.
 */
export function reorderByIds<T>(
  items: T[],
  activeId: string,
  overId: string,
  getId: (item: T) => string,
): T[] {
  if (!activeId || !overId || activeId === overId) return items;
  const fromIndex = items.findIndex((item) => getId(item) === activeId);
  const toIndex = items.findIndex((item) => getId(item) === overId);
  if (fromIndex < 0 || toIndex < 0) return items;
  return arrayMove(items, fromIndex, toIndex);
}

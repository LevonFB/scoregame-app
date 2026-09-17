// Pure helper for the admin candidate-list provider visibility filter (M5.1).
// NO I/O. Extracted so the source-import visibility rule is testable and DRY.
//
// Background: while the system runs AllSports-only, getCandidates hides rows whose
// api_provider isn't AllSports. That guard also hid matches the admin explicitly
// imported from the source catalog (e.g. Football-Data). This helper lets such
// imported rows (source_id set) through, while STILL requiring the row to resolve
// to a known catalog competition (so no junk leaks) and leaving the mode filter
// untouched. Legacy rows (source_id null, non-AllSports provider) stay hidden.

export function passesProviderDisplayFilter(params: {
  apiProvider: unknown;
  sourceId: number | null | undefined;
  catalogResolved: boolean;
  allSportsOnly: boolean;
}): boolean {
  // When not in AllSports-only mode the legacy behavior returns every row as-is.
  if (!params.allSportsOnly) return true;

  const isAllSports = String(params.apiProvider || "").toLowerCase().includes("allsports");
  const isSourceImported = params.sourceId !== null && params.sourceId !== undefined;

  // Manually imported source candidates are allowed regardless of provider, but the
  // competition must still resolve to the catalog (keeps youth/garbage out).
  return (isAllSports || isSourceImported) && params.catalogResolved;
}

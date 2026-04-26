/**
 * Calendar/heatmap layout helpers.
 *
 * Generates a rolling 365-day grid anchored on today,
 * aligned from pew's implementation.
 */

// ---------------------------------------------------------------------------
// Calendar layout (rolling 365 days)
// ---------------------------------------------------------------------------

/**
 * Build an array of week arrays (Date[][]) covering the last 365 days,
 * anchored on Sundays. Ends on today, starts from the Sunday on or before
 * 365 days ago.
 */
export function getLast365DaysWeeks(): Date[][] {
  const weeks: Date[][] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Go back 365 days and find the Sunday on or before that date
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 364); // 365 days including today
  startDate.setDate(startDate.getDate() - startDate.getDay()); // Align to Sunday

  const currentDate = new Date(startDate);
  let currentWeek: Date[] = [];

  while (currentDate <= today) {
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Push remaining days (partial week ending on today)
  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }

  return weeks;
}

// ---------------------------------------------------------------------------
// Color index (percentile-based)
// ---------------------------------------------------------------------------

/**
 * Compute percentile boundaries for color bucketing.
 *
 * Given a sorted array of **non-zero** values, splits them into `levels`
 * equal-frequency buckets and returns the upper-bound value of each bucket.
 *
 * Example with 4 levels and [1,2,3,4,5,6,7,8]:
 *   boundaries = [2, 4, 6, 8]  — each bucket holds ~25% of values.
 *
 * Returns an empty array when `sortedValues` is empty.
 */
export function computePercentileBoundaries(
  sortedValues: number[],
  levels: number,
): number[] {
  if (sortedValues.length === 0 || levels <= 0) return [];

  const boundaries: number[] = [];
  for (let i = 1; i <= levels; i++) {
    // Index at the i/levels percentile (clamp to last element)
    const idx = Math.min(
      Math.ceil((i / levels) * sortedValues.length) - 1,
      sortedValues.length - 1,
    );
    boundaries.push(sortedValues[idx] as number);
  }
  return boundaries;
}

/**
 * Map a numeric value to an index in a color scale array using
 * percentile boundaries.
 *
 * Index 0 is reserved for zero values (empty/no-data).
 * Non-zero values are placed into buckets [1..colorScale.length-1]
 * based on which percentile boundary they fall into.
 *
 * When boundaries are empty (no non-zero data), any non-zero value
 * maps to the lowest color index (1).
 */
export function getColorIndex(
  value: number,
  boundaries: number[],
  colorScale: readonly string[],
): number {
  if (value === 0) return 0;
  if (boundaries.length === 0) return 1;

  // Find the first boundary that this value fits into
  for (let i = 0; i < boundaries.length; i++) {
    if (value <= (boundaries[i] as number)) return i + 1;
  }
  // Value exceeds all boundaries — top bucket
  return colorScale.length - 1;
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

/** Format a Date object as an ISO date string "YYYY-MM-DD". */
export function formatDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

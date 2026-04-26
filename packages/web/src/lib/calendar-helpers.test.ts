import { describe, expect, test } from "vitest";
import {
  computePercentileBoundaries,
  formatDateISO,
  getColorIndex,
  getLast365DaysWeeks,
} from "./calendar-helpers";

// ---------------------------------------------------------------------------
// getLast365DaysWeeks
// ---------------------------------------------------------------------------

describe("getLast365DaysWeeks", () => {
  test("returns array of week arrays", () => {
    const weeks = getLast365DaysWeeks();
    expect(Array.isArray(weeks)).toBe(true);
    expect(weeks.length).toBeGreaterThan(50); // ~52 weeks
    expect(weeks.length).toBeLessThanOrEqual(54); // max weeks
  });

  test("each week is an array of Date objects", () => {
    const weeks = getLast365DaysWeeks();
    for (const week of weeks) {
      expect(Array.isArray(week)).toBe(true);
      expect(week.length).toBeGreaterThan(0);
      expect(week.length).toBeLessThanOrEqual(7);
      for (const day of week) {
        expect(day).toBeInstanceOf(Date);
      }
    }
  });

  test("first day of each full week is a Sunday", () => {
    const weeks = getLast365DaysWeeks();
    // Skip last week which might be partial
    for (let i = 0; i < weeks.length - 1; i++) {
      const week = weeks[i]!;
      if (week.length === 7) {
        expect(week[0]!.getDay()).toBe(0); // Sunday = 0
      }
    }
  });

  test("last day is today or yesterday", () => {
    const weeks = getLast365DaysWeeks();
    const lastWeek = weeks[weeks.length - 1]!;
    const lastDay = lastWeek[lastWeek.length - 1]!;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const lastDayStr = formatDateISO(lastDay);
    const todayStr = formatDateISO(today);
    const yesterdayStr = formatDateISO(yesterday);

    expect([todayStr, yesterdayStr]).toContain(lastDayStr);
  });

  test("covers approximately 365 days", () => {
    const weeks = getLast365DaysWeeks();
    let totalDays = 0;
    for (const week of weeks) {
      totalDays += week.length;
    }
    // Should be 365-371 days (365 + up to 6 padding days for Sunday alignment)
    expect(totalDays).toBeGreaterThanOrEqual(365);
    expect(totalDays).toBeLessThanOrEqual(371);
  });
});

// ---------------------------------------------------------------------------
// computePercentileBoundaries
// ---------------------------------------------------------------------------

describe("computePercentileBoundaries", () => {
  test("returns empty array for empty input", () => {
    expect(computePercentileBoundaries([], 4)).toEqual([]);
  });

  test("returns empty array for zero levels", () => {
    expect(computePercentileBoundaries([1, 2, 3], 0)).toEqual([]);
  });

  test("splits values into equal buckets", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8];
    const boundaries = computePercentileBoundaries(values, 4);
    expect(boundaries.length).toBe(4);
    // Each bucket holds ~25% of values
    expect(boundaries[0]).toBe(2);
    expect(boundaries[1]).toBe(4);
    expect(boundaries[2]).toBe(6);
    expect(boundaries[3]).toBe(8);
  });

  test("handles single value", () => {
    const boundaries = computePercentileBoundaries([5], 4);
    expect(boundaries.length).toBe(4);
    expect(boundaries.every((b) => b === 5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getColorIndex
// ---------------------------------------------------------------------------

describe("getColorIndex", () => {
  const colorScale = ["#0", "#1", "#2", "#3", "#4"];
  const boundaries = [10, 20, 30, 40];

  test("returns 0 for zero values", () => {
    expect(getColorIndex(0, boundaries, colorScale)).toBe(0);
  });

  test("returns 1 for empty boundaries with non-zero value", () => {
    expect(getColorIndex(5, [], colorScale)).toBe(1);
  });

  test("maps values to correct buckets", () => {
    expect(getColorIndex(5, boundaries, colorScale)).toBe(1);
    expect(getColorIndex(10, boundaries, colorScale)).toBe(1);
    expect(getColorIndex(15, boundaries, colorScale)).toBe(2);
    expect(getColorIndex(25, boundaries, colorScale)).toBe(3);
    expect(getColorIndex(35, boundaries, colorScale)).toBe(4);
  });

  test("returns top bucket for values exceeding all boundaries", () => {
    expect(getColorIndex(100, boundaries, colorScale)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// formatDateISO
// ---------------------------------------------------------------------------

describe("formatDateISO", () => {
  test("formats date as YYYY-MM-DD", () => {
    expect(formatDateISO(new Date(2025, 0, 1))).toBe("2025-01-01");
    expect(formatDateISO(new Date(2025, 11, 31))).toBe("2025-12-31");
  });

  test("pads single digit month and day", () => {
    expect(formatDateISO(new Date(2025, 2, 5))).toBe("2025-03-05");
  });
});

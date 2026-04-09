/**
 * Duration parsing utilities for CLI flags.
 *
 * Supports human-readable durations: 30 (seconds), 5m (minutes), 2h (hours), 1d (days)
 */

const MULTIPLIERS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

/**
 * Parse duration string to seconds.
 *
 * @param input Duration string (e.g., "30", "5m", "2h", "1d")
 * @returns Number of seconds
 * @throws Error if format is invalid
 *
 * @example
 * parseDuration("30")   // 30
 * parseDuration("5m")   // 300
 * parseDuration("2h")   // 7200
 * parseDuration("1d")   // 86400
 */
export function parseDuration(input: string): number {
  const match = input.match(/^(\d+)(s|m|h|d)?$/);
  if (!match) {
    throw new Error(
      `Invalid duration: "${input}". Expected format: <number>[s|m|h|d] (e.g., 30, 5m, 2h, 1d)`,
    );
  }

  const value = parseInt(match[1]!, 10);
  const unit = match[2] || "s";

  return value * MULTIPLIERS[unit]!;
}

/**
 * Parse a string to a non-negative integer.
 *
 * @param value String to parse
 * @param paramName Parameter name for error messages
 * @returns Parsed integer
 * @throws Error if value is not a valid non-negative integer
 */
export function parsePositiveInt(value: string, paramName: string): number {
  const num = parseInt(value, 10);
  if (Number.isNaN(num)) {
    throw new Error(
      `Invalid value for ${paramName}: "${value}" is not a valid integer`,
    );
  }
  if (num < 0) {
    throw new Error(
      `Invalid value for ${paramName}: must be a non-negative integer`,
    );
  }
  return num;
}

/**
 * Format seconds as human-readable duration.
 *
 * @param seconds Number of seconds
 * @returns Human-readable string (e.g., "2h 30m", "45s")
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

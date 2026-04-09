import { describe, expect, it } from "vitest";
import { formatDuration, parseDuration, parsePositiveInt } from "./duration.js";

describe("parseDuration", () => {
  it("parses plain numbers as seconds", () => {
    expect(parseDuration("30")).toBe(30);
    expect(parseDuration("0")).toBe(0);
    expect(parseDuration("100")).toBe(100);
  });

  it("parses seconds with 's' suffix", () => {
    expect(parseDuration("30s")).toBe(30);
    expect(parseDuration("0s")).toBe(0);
  });

  it("parses minutes", () => {
    expect(parseDuration("5m")).toBe(300);
    expect(parseDuration("1m")).toBe(60);
    expect(parseDuration("60m")).toBe(3600);
  });

  it("parses hours", () => {
    expect(parseDuration("2h")).toBe(7200);
    expect(parseDuration("1h")).toBe(3600);
    expect(parseDuration("24h")).toBe(86400);
  });

  it("parses days", () => {
    expect(parseDuration("1d")).toBe(86400);
    expect(parseDuration("7d")).toBe(604800);
  });

  it("throws on invalid format", () => {
    expect(() => parseDuration("")).toThrow('Invalid duration: ""');
    expect(() => parseDuration("abc")).toThrow('Invalid duration: "abc"');
    expect(() => parseDuration("5x")).toThrow('Invalid duration: "5x"');
    expect(() => parseDuration("-5m")).toThrow('Invalid duration: "-5m"');
    expect(() => parseDuration("5.5m")).toThrow('Invalid duration: "5.5m"');
    expect(() => parseDuration("5 m")).toThrow('Invalid duration: "5 m"');
  });
});

describe("formatDuration", () => {
  it("formats seconds only", () => {
    expect(formatDuration(30)).toBe("30s");
    expect(formatDuration(59)).toBe("59s");
    expect(formatDuration(0)).toBe("0s");
  });

  it("formats minutes", () => {
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(300)).toBe("5m");
    expect(formatDuration(90)).toBe("1m 30s");
    expect(formatDuration(3599)).toBe("59m 59s");
  });

  it("formats hours", () => {
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(7200)).toBe("2h");
    expect(formatDuration(5400)).toBe("1h 30m");
    expect(formatDuration(86399)).toBe("23h 59m");
  });

  it("formats days", () => {
    expect(formatDuration(86400)).toBe("1d");
    expect(formatDuration(172800)).toBe("2d");
    expect(formatDuration(90000)).toBe("1d 1h");
    expect(formatDuration(604800)).toBe("7d");
  });
});

describe("parsePositiveInt", () => {
  it("parses valid integers", () => {
    expect(parsePositiveInt("0", "--test")).toBe(0);
    expect(parsePositiveInt("1", "--test")).toBe(1);
    expect(parsePositiveInt("100", "--test")).toBe(100);
    expect(parsePositiveInt("999999", "--test")).toBe(999999);
  });

  it("throws on non-numeric strings", () => {
    expect(() => parsePositiveInt("abc", "--test")).toThrow(
      'Invalid value for --test: "abc" is not a valid integer',
    );
    expect(() => parsePositiveInt("", "--test")).toThrow(
      'Invalid value for --test: "" is not a valid integer',
    );
  });

  it("parses integers from strings with trailing non-digits (parseInt behavior)", () => {
    // Note: parseInt("12.5") returns 12, which is acceptable for CLI integer params
    expect(parsePositiveInt("12.5", "--test")).toBe(12);
    expect(parsePositiveInt("100abc", "--test")).toBe(100);
  });

  it("throws on negative integers", () => {
    expect(() => parsePositiveInt("-1", "--test")).toThrow(
      "Invalid value for --test: must be a non-negative integer",
    );
    expect(() => parsePositiveInt("-100", "--test")).toThrow(
      "Invalid value for --test: must be a non-negative integer",
    );
  });

  it("includes param name in error message", () => {
    expect(() => parsePositiveInt("xyz", "--min-messages")).toThrow(
      "--min-messages",
    );
  });
});

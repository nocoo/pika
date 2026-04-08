import { describe, expect, it } from "vitest";
import {
  parsePaginationArgs,
  buildPaginationParams,
  extractPaginationInfo,
} from "./pagination.js";

describe("parsePaginationArgs", () => {
  it("returns defaults when no args", () => {
    const result = parsePaginationArgs({});

    expect(result).toEqual({
      limit: 50,
      page: undefined,
      cursor: undefined,
      mode: "cursor",
    });
  });

  it("parses limit", () => {
    const result = parsePaginationArgs({ limit: "25" });
    expect(result.limit).toBe(25);
  });

  it("clamps limit to max", () => {
    const result = parsePaginationArgs({ limit: "200" });
    expect(result.limit).toBe(100);
  });

  it("uses custom maxLimit", () => {
    const result = parsePaginationArgs({ limit: "200" }, { maxLimit: 50 });
    expect(result.limit).toBe(50);
  });

  it("uses custom defaultLimit", () => {
    const result = parsePaginationArgs({}, { defaultLimit: 20 });
    expect(result.limit).toBe(20);
  });

  it("parses page", () => {
    const result = parsePaginationArgs({ page: "3" });

    expect(result).toEqual({
      limit: 50,
      page: 3,
      cursor: undefined,
      mode: "page",
    });
  });

  it("parses cursor", () => {
    const result = parsePaginationArgs({ cursor: "abc123" });

    expect(result).toEqual({
      limit: 50,
      page: undefined,
      cursor: "abc123",
      mode: "cursor",
    });
  });

  it("throws when both page and cursor provided", () => {
    expect(() =>
      parsePaginationArgs({ page: "1", cursor: "abc" })
    ).toThrowError("Cannot use both --page and --cursor");
  });

  it("ignores invalid page", () => {
    const result = parsePaginationArgs({ page: "invalid" });
    expect(result.page).toBeUndefined();
  });

  it("ignores zero page", () => {
    const result = parsePaginationArgs({ page: "0" });
    expect(result.page).toBeUndefined();
  });

  it("ignores negative page", () => {
    const result = parsePaginationArgs({ page: "-1" });
    expect(result.page).toBeUndefined();
  });
});

describe("buildPaginationParams", () => {
  it("builds params with limit only", () => {
    const result = buildPaginationParams({
      limit: 50,
      mode: "cursor",
    });

    expect(result).toEqual({ limit: "50" });
  });

  it("includes cursor when present", () => {
    const result = buildPaginationParams({
      limit: 50,
      cursor: "abc123",
      mode: "cursor",
    });

    expect(result).toEqual({ limit: "50", cursor: "abc123" });
  });

  it("includes page when present", () => {
    const result = buildPaginationParams({
      limit: 50,
      page: 2,
      mode: "page",
    });

    expect(result).toEqual({ limit: "50", page: "2" });
  });
});

describe("extractPaginationInfo", () => {
  it("extracts cursor pagination info", () => {
    const response = {
      sessions: [],
      cursor: "next123",
      hasMore: true,
    };

    const result = extractPaginationInfo(response);

    expect(result).toEqual({
      hasMore: true,
      nextCursor: "next123",
      totalCount: undefined,
      currentPage: undefined,
    });
  });

  it("extracts page pagination info", () => {
    const response = {
      sessions: [],
      hasMore: true,
      totalCount: 150,
      page: 1,
      pageSize: 50,
    };

    const result = extractPaginationInfo(response);

    expect(result).toEqual({
      hasMore: true,
      nextCursor: undefined,
      totalCount: 150,
      currentPage: 1,
    });
  });

  it("handles missing fields", () => {
    const result = extractPaginationInfo({});

    expect(result).toEqual({
      hasMore: false,
      nextCursor: undefined,
      totalCount: undefined,
      currentPage: undefined,
    });
  });
});

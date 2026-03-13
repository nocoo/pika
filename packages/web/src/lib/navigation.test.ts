import { describe, it, expect } from "vitest";
import {
  NAV_GROUPS,
  ROUTE_LABELS,
  breadcrumbsFromPathname,
} from "./navigation";

// ── NAV_GROUPS ─────────────────────────────────────────────────

describe("NAV_GROUPS", () => {
  it("has at least one group", () => {
    expect(NAV_GROUPS.length).toBeGreaterThan(0);
  });

  it("every item has href, label, and icon", () => {
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        expect(item.href).toBeTruthy();
        expect(item.label).toBeTruthy();
        expect(item.icon).toBeTruthy();
      }
    }
  });

  it("all hrefs start with /dashboard", () => {
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        expect(item.href).toMatch(/^\/dashboard/);
      }
    }
  });
});

// ── ROUTE_LABELS ───────────────────────────────────────────────

describe("ROUTE_LABELS", () => {
  it("contains dashboard, sessions, search", () => {
    expect(ROUTE_LABELS.dashboard).toBe("Dashboard");
    expect(ROUTE_LABELS.sessions).toBe("Sessions");
    expect(ROUTE_LABELS.search).toBe("Search");
  });

  it("contains settings and tags", () => {
    expect(ROUTE_LABELS.settings).toBe("Settings");
    expect(ROUTE_LABELS.tags).toBe("Tags");
  });
});

// ── breadcrumbsFromPathname ────────────────────────────────────

describe("breadcrumbsFromPathname", () => {
  it("returns Home for /dashboard", () => {
    const result = breadcrumbsFromPathname("/dashboard");
    expect(result).toEqual([
      { label: "Home", href: "/dashboard" },
      { label: "Dashboard" }, // last segment, no href
    ]);
  });

  it("builds breadcrumbs for /dashboard/sessions", () => {
    const result = breadcrumbsFromPathname("/dashboard/sessions");
    expect(result).toEqual([
      { label: "Home", href: "/dashboard" },
      { label: "Dashboard", href: "/dashboard" },
      { label: "Sessions" },
    ]);
  });

  it("builds breadcrumbs for /dashboard/sessions/abc123", () => {
    const result = breadcrumbsFromPathname("/dashboard/sessions/abc123");
    expect(result).toEqual([
      { label: "Home", href: "/dashboard" },
      { label: "Dashboard", href: "/dashboard" },
      { label: "Sessions", href: "/dashboard/sessions" },
      { label: "abc123" }, // unknown segment truncated to 16 chars
    ]);
  });

  it("truncates unknown segments to 16 characters", () => {
    const result = breadcrumbsFromPathname(
      "/dashboard/sessions/this-is-a-very-long-session-id-that-should-be-truncated",
    );
    const last = result[result.length - 1]!;
    expect(last.label).toBe("this-is-a-very-l");
  });

  it("handles /dashboard/search", () => {
    const result = breadcrumbsFromPathname("/dashboard/search");
    expect(result).toEqual([
      { label: "Home", href: "/dashboard" },
      { label: "Dashboard", href: "/dashboard" },
      { label: "Search" },
    ]);
  });

  it("handles /dashboard/settings/tags", () => {
    const result = breadcrumbsFromPathname("/dashboard/settings/tags");
    expect(result).toEqual([
      { label: "Home", href: "/dashboard" },
      { label: "Dashboard", href: "/dashboard" },
      { label: "Settings", href: "/dashboard/settings" },
      { label: "Tags" },
    ]);
  });
});

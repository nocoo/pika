import { describe, it, expect } from "vitest";
import {
  validateCreateTag,
  validateUpdateTag,
  buildListTagsQuery,
  buildGetTagQuery,
  buildCreateTagQuery,
  buildUpdateTagQuery,
  buildDeleteTagQuery,
  buildAddSessionTagQuery,
  buildRemoveSessionTagQuery,
  buildSessionTagsQuery,
  buildVerifySessionOwnerQuery,
} from "./tags";

// ── validateCreateTag ──────────────────────────────────────────

describe("validateCreateTag", () => {
  it("accepts valid input with name only", () => {
    const r = validateCreateTag({ name: "bug" });
    expect(r.valid).toBe(true);
    expect(r.data).toEqual({ name: "bug", color: null });
  });

  it("accepts valid input with name and color", () => {
    const r = validateCreateTag({ name: "feature", color: "#ff6b6b" });
    expect(r.valid).toBe(true);
    expect(r.data).toEqual({ name: "feature", color: "#ff6b6b" });
  });

  it("trims whitespace from name", () => {
    const r = validateCreateTag({ name: "  bug  " });
    expect(r.valid).toBe(true);
    expect(r.data?.name).toBe("bug");
  });

  it("rejects null body", () => {
    const r = validateCreateTag(null);
    expect(r.valid).toBe(false);
    expect(r.errors[0].field).toBe("body");
  });

  it("rejects non-object body", () => {
    const r = validateCreateTag("string");
    expect(r.valid).toBe(false);
  });

  it("rejects missing name", () => {
    const r = validateCreateTag({ color: "#ff0000" });
    expect(r.valid).toBe(false);
    expect(r.errors[0].field).toBe("name");
  });

  it("rejects empty name", () => {
    const r = validateCreateTag({ name: "" });
    expect(r.valid).toBe(false);
    expect(r.errors[0].field).toBe("name");
  });

  it("rejects whitespace-only name", () => {
    const r = validateCreateTag({ name: "   " });
    expect(r.valid).toBe(false);
    expect(r.errors[0].field).toBe("name");
  });

  it("rejects name longer than 50 chars", () => {
    const r = validateCreateTag({ name: "a".repeat(51) });
    expect(r.valid).toBe(false);
    expect(r.errors[0].message).toContain("50");
  });

  it("accepts name of exactly 50 chars", () => {
    const r = validateCreateTag({ name: "a".repeat(50) });
    expect(r.valid).toBe(true);
  });

  it("rejects invalid color format", () => {
    const r = validateCreateTag({ name: "bug", color: "red" });
    expect(r.valid).toBe(false);
    expect(r.errors[0].field).toBe("color");
  });

  it("rejects short hex color", () => {
    const r = validateCreateTag({ name: "bug", color: "#fff" });
    expect(r.valid).toBe(false);
  });

  it("accepts null color explicitly", () => {
    const r = validateCreateTag({ name: "bug", color: null });
    expect(r.valid).toBe(true);
    expect(r.data?.color).toBeNull();
  });

  it("accepts undefined color", () => {
    const r = validateCreateTag({ name: "bug" });
    expect(r.valid).toBe(true);
    expect(r.data?.color).toBeNull();
  });

  it("accepts uppercase hex color", () => {
    const r = validateCreateTag({ name: "bug", color: "#FF6B6B" });
    expect(r.valid).toBe(true);
  });
});

// ── validateUpdateTag ──────────────────────────────────────────

describe("validateUpdateTag", () => {
  it("accepts name update", () => {
    const r = validateUpdateTag({ name: "new-name" });
    expect(r.valid).toBe(true);
    expect(r.data?.name).toBe("new-name");
  });

  it("accepts color update", () => {
    const r = validateUpdateTag({ color: "#00ff00" });
    expect(r.valid).toBe(true);
    expect(r.data?.color).toBe("#00ff00");
  });

  it("accepts both name and color", () => {
    const r = validateUpdateTag({ name: "x", color: "#aabbcc" });
    expect(r.valid).toBe(true);
    expect(r.data).toEqual({ name: "x", color: "#aabbcc" });
  });

  it("accepts color set to null (remove color)", () => {
    const r = validateUpdateTag({ color: null });
    expect(r.valid).toBe(true);
    expect(r.data?.color).toBeNull();
  });

  it("rejects empty body", () => {
    const r = validateUpdateTag({});
    expect(r.valid).toBe(false);
    expect(r.errors[0].message).toContain("At least one field");
  });

  it("rejects null body", () => {
    const r = validateUpdateTag(null);
    expect(r.valid).toBe(false);
  });

  it("rejects empty name", () => {
    const r = validateUpdateTag({ name: "" });
    expect(r.valid).toBe(false);
  });

  it("rejects name longer than 50 chars", () => {
    const r = validateUpdateTag({ name: "a".repeat(51) });
    expect(r.valid).toBe(false);
  });

  it("rejects invalid color format", () => {
    const r = validateUpdateTag({ color: "not-a-color" });
    expect(r.valid).toBe(false);
  });

  it("trims name whitespace", () => {
    const r = validateUpdateTag({ name: "  trimmed  " });
    expect(r.valid).toBe(true);
    expect(r.data?.name).toBe("trimmed");
  });
});

// ── Query builders ─────────────────────────────────────────────

describe("buildListTagsQuery", () => {
  it("returns SQL with userId param", () => {
    const q = buildListTagsQuery("u1");
    expect(q.sql).toContain("WHERE user_id = ?");
    expect(q.sql).toContain("ORDER BY name");
    expect(q.params).toEqual(["u1"]);
  });
});

describe("buildGetTagQuery", () => {
  it("filters by tagId and userId", () => {
    const q = buildGetTagQuery("t1", "u1");
    expect(q.sql).toContain("WHERE id = ? AND user_id = ?");
    expect(q.params).toEqual(["t1", "u1"]);
  });
});

describe("buildCreateTagQuery", () => {
  it("inserts with all fields", () => {
    const q = buildCreateTagQuery("t1", "u1", { name: "bug", color: "#ff0000" });
    expect(q.sql).toContain("INSERT INTO tags");
    expect(q.params).toEqual(["t1", "u1", "bug", "#ff0000"]);
  });

  it("uses null for missing color", () => {
    const q = buildCreateTagQuery("t1", "u1", { name: "bug" });
    expect(q.params).toEqual(["t1", "u1", "bug", null]);
  });
});

describe("buildUpdateTagQuery", () => {
  it("updates name only", () => {
    const q = buildUpdateTagQuery("t1", "u1", { name: "new" });
    expect(q.sql).toContain("SET name = ?");
    expect(q.sql).not.toContain("color");
    expect(q.params).toEqual(["new", "t1", "u1"]);
  });

  it("updates color only", () => {
    const q = buildUpdateTagQuery("t1", "u1", { color: "#00ff00" });
    expect(q.sql).toContain("SET color = ?");
    expect(q.sql).not.toContain("name");
    expect(q.params).toEqual(["#00ff00", "t1", "u1"]);
  });

  it("updates both name and color", () => {
    const q = buildUpdateTagQuery("t1", "u1", { name: "x", color: "#aabbcc" });
    expect(q.sql).toContain("name = ?");
    expect(q.sql).toContain("color = ?");
    expect(q.params).toEqual(["x", "#aabbcc", "t1", "u1"]);
  });

  it("sets color to null", () => {
    const q = buildUpdateTagQuery("t1", "u1", { color: null });
    expect(q.params).toEqual([null, "t1", "u1"]);
  });
});

describe("buildDeleteTagQuery", () => {
  it("deletes by tagId and userId", () => {
    const q = buildDeleteTagQuery("t1", "u1");
    expect(q.sql).toContain("DELETE FROM tags");
    expect(q.params).toEqual(["t1", "u1"]);
  });
});

// ── Session ↔ Tag association ──────────────────────────────────

describe("buildAddSessionTagQuery", () => {
  it("uses INSERT OR IGNORE for idempotency", () => {
    const q = buildAddSessionTagQuery("s1", "t1");
    expect(q.sql).toContain("INSERT OR IGNORE");
    expect(q.params).toEqual(["s1", "t1"]);
  });
});

describe("buildRemoveSessionTagQuery", () => {
  it("deletes the junction row", () => {
    const q = buildRemoveSessionTagQuery("s1", "t1");
    expect(q.sql).toContain("DELETE FROM session_tags");
    expect(q.params).toEqual(["s1", "t1"]);
  });
});

describe("buildSessionTagsQuery", () => {
  it("joins tags with session_tags and filters by userId", () => {
    const q = buildSessionTagsQuery("s1", "u1");
    expect(q.sql).toContain("INNER JOIN session_tags");
    expect(q.sql).toContain("WHERE st.session_id = ? AND t.user_id = ?");
    expect(q.sql).toContain("ORDER BY t.name");
    expect(q.params).toEqual(["s1", "u1"]);
  });
});

describe("buildVerifySessionOwnerQuery", () => {
  it("checks session ownership", () => {
    const q = buildVerifySessionOwnerQuery("s1", "u1");
    expect(q.sql).toContain("WHERE id = ? AND user_id = ?");
    expect(q.params).toEqual(["s1", "u1"]);
  });
});

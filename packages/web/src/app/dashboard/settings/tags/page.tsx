"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

// ── Types ──────────────────────────────────────────────────────

interface Tag {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
}

// ── Preset colors ──────────────────────────────────────────────

const PRESET_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
];

// ── Page ───────────────────────────────────────────────────────

export default function TagsSettingsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fetch tags
  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch("/api/tags");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTags(data.tags);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tags");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  // Create tag
  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(typeof data.error === "string" ? data.error : "Failed to create tag");
      }
      const data = await res.json();
      setTags((prev) => [...prev, data.tag].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
      setNewColor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create tag");
    } finally {
      setCreating(false);
    }
  };

  // Start editing
  const startEdit = (tag: Tag) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  };

  // Save edit
  const handleSave = async () => {
    if (!editingId || !editName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tags/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), color: editColor }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(typeof data.error === "string" ? data.error : "Failed to update tag");
      }
      const data = await res.json();
      setTags((prev) =>
        prev
          .map((t) => (t.id === editingId ? data.tag : t))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update tag");
    } finally {
      setSaving(false);
    }
  };

  // Delete tag
  const handleDelete = async (tagId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/tags/${tagId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        throw new Error(`HTTP ${res.status}`);
      }
      setTags((prev) => prev.filter((t) => t.id !== tagId));
      if (editingId === tagId) setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete tag");
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight font-display">
          Tags
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create and manage tags to organize your sessions.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="text-sm text-destructive py-2">{error}</div>
      )}

      {/* Create form */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Create a new tag</h2>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Tag name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1"
            maxLength={50}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
          />
          <Button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            size="sm"
          >
            {creating ? "Creating..." : "Create"}
          </Button>
        </div>
        {/* Color picker */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground mr-1">Color:</span>
          <button
            onClick={() => setNewColor(null)}
            className={`h-5 w-5 rounded-full border-2 transition-all ${
              newColor === null ? "border-foreground scale-110" : "border-border"
            } bg-muted`}
            title="No color"
          />
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setNewColor(c)}
              className={`h-5 w-5 rounded-full border-2 transition-all ${
                newColor === c ? "border-foreground scale-110" : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
              title={c}
            />
          ))}
        </div>
        {/* Preview */}
        {newName.trim() && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Preview:</span>
            <Badge
              variant="outline"
              className="text-xs"
              style={newColor ? { borderColor: newColor, color: newColor } : undefined}
            >
              {newName.trim()}
            </Badge>
          </div>
        )}
      </div>

      {/* Tags list */}
      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : tags.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          No tags yet. Create one above to get started.
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
            >
              {editingId === tag.id ? (
                /* Edit mode */
                <div className="flex flex-1 flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 h-8"
                      maxLength={50}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSave();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleSave}
                      disabled={saving || !editName.trim()}
                    >
                      {saving ? "Saving..." : "Save"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setEditColor(null)}
                      className={`h-4 w-4 rounded-full border-2 transition-all ${
                        editColor === null ? "border-foreground scale-110" : "border-border"
                      } bg-muted`}
                      title="No color"
                    />
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setEditColor(c)}
                        className={`h-4 w-4 rounded-full border-2 transition-all ${
                          editColor === c ? "border-foreground scale-110" : "border-transparent"
                        }`}
                        style={{ backgroundColor: c }}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                /* View mode */
                <>
                  <Badge
                    variant="outline"
                    className="text-xs"
                    style={tag.color ? { borderColor: tag.color, color: tag.color } : undefined}
                  >
                    {tag.name}
                  </Badge>
                  <span className="flex-1" />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs"
                    onClick={() => startEdit(tag)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs text-destructive hover:text-destructive"
                    onClick={() => handleDelete(tag.id)}
                  >
                    Delete
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

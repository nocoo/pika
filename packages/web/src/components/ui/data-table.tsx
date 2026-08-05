"use client";

import {
  type ColumnDef,
  flexRender,
  type RowData,
  type Table as TanStackTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { DataTableFeatures } from "@/components/ui/data-table-features";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────

interface DataTableProps<TData extends RowData> {
  table: TanStackTable<DataTableFeatures, TData>;
  columns: ColumnDef<DataTableFeatures, TData, unknown>[];
  loading?: boolean;
  emptyMessage?: string;
  /** Number of skeleton rows to show when loading */
  skeletonRows?: number;
}

// ── Sort icon ─────────────────────────────────────────────────

function SortIcon({ direction }: { direction: false | "asc" | "desc" }) {
  if (direction === "asc") return <ArrowUp className="ml-1 h-3.5 w-3.5" />;
  if (direction === "desc") return <ArrowDown className="ml-1 h-3.5 w-3.5" />;
  return <ArrowUpDown className="ml-1 h-3.5 w-3.5 text-muted-foreground/40" />;
}

// ── DataTable ─────────────────────────────────────────────────

export function DataTable<TData extends RowData>({
  table,
  columns,
  loading = false,
  emptyMessage = "No results found.",
  skeletonRows = 10,
}: DataTableProps<TData>) {
  return (
    <div className="rounded-[var(--radius-card)] bg-secondary overflow-hidden">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={
                      canSort
                        ? header.column.getIsSorted() === "asc"
                          ? "ascending"
                          : header.column.getIsSorted() === "desc"
                            ? "descending"
                            : "none"
                        : undefined
                    }
                    className={cn(
                      canSort && "cursor-pointer select-none",
                      header.column.columnDef.meta?.headerClassName,
                    )}
                    style={{
                      width: header.column.columnDef.size
                        ? `${header.column.columnDef.size}px`
                        : undefined,
                    }}
                    onClick={
                      canSort
                        ? header.column.getToggleSortingHandler()
                        : undefined
                    }
                  >
                    {header.isPlaceholder ? null : (
                      <div
                        className={cn(
                          "flex items-center",
                          header.column.columnDef.meta?.headerClassName?.includes(
                            "text-right",
                          ) && "justify-end",
                        )}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {canSort && (
                          <SortIcon direction={header.column.getIsSorted()} />
                        )}
                      </div>
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {loading ? (
            // Skeleton loading state
            Array.from({ length: skeletonRows }).map((_, i) => (
              <TableRow key={`skeleton-${i}`}>
                {columns.map((_, j) => (
                  <TableCell key={`skeleton-${i}-${j}`}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : table.getRowModel().rows.length === 0 ? (
            // Empty state
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            // Data rows
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cell.column.columnDef.meta?.cellClassName}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

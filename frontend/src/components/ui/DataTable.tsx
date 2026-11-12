"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import type { RowData } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState, Loading, Notice } from "./Feedback";

export type Column<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortKey?: string;
  className?: string;
};

export type SortState = { field: string; order: "asc" | "desc" };

type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  loading?: boolean;
  error?: string;
  emptyTitle?: string;
  emptyText?: string;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  caption: string;
};

// TanStack Table builds the header/row model; data is already paged and sorted by the API.
const features = tableFeatures({});

export default function DataTable<T extends RowData>({ columns, rows, getRowId, loading, error, emptyTitle = "No records found", emptyText, sort, onSortChange, caption }: DataTableProps<T>) {
  const tableColumns = useMemo(() => {
    const helper = createColumnHelper<typeof features, T>();
    return helper.columns(columns.map((column) => helper.display({ id: column.id, header: column.header, cell: ({ row }) => column.cell(row.original) })));
  }, [columns]);

  const table = useTable({ features, columns: tableColumns, data: rows, getRowId: (row) => getRowId(row) });
  const columnById = new Map(columns.map((column) => [column.id, column]));

  if (error) return <Notice>{error}</Notice>;

  return (
    <div className="relative min-w-0 max-w-full overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-slate-50">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const column = columnById.get(header.column.id);
                const sortable = Boolean(column?.sortKey && onSortChange);
                const activeSort = sortable && sort?.field === column?.sortKey ? sort?.order : undefined;
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={activeSort ? (activeSort === "asc" ? "ascending" : "descending") : undefined}
                    className={`whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-600 ${column?.className || ""}`}
                  >
                    {sortable && column?.sortKey ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600"
                        onClick={() => onSortChange?.({ field: column.sortKey as string, order: activeSort === "asc" ? "desc" : "asc" })}
                      >
                        {column.header}
                        {activeSort === "asc" && <ArrowUp size={12} />}
                        {activeSort === "desc" && <ArrowDown size={12} />}
                      </button>
                    ) : (
                      column?.header
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50">
              {row.getAllCells().map((cell) => (
                <td key={cell.id} className={`px-3 py-2.5 align-middle text-slate-700 ${columnById.get(cell.column.id)?.className || ""}`}>
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {loading && rows.length === 0 && <Loading />}
      {loading && rows.length > 0 && <div className="absolute inset-0 bg-white/50" aria-hidden="true" />}
      {!loading && rows.length === 0 && <EmptyState title={emptyTitle} text={emptyText} />}
    </div>
  );
}

export function Pagination({ page, totalPages, total, onPageChange }: { page: number; totalPages: number; total: number; onPageChange: (page: number) => void }) {
  if (total === 0) return null;
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 pt-3 text-sm text-slate-600">
      <span>
        {total.toLocaleString()} record{total === 1 ? "" : "s"} · Page {page} of {Math.max(totalPages, 1)}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ChevronLeft size={14} /> Previous
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </nav>
  );
}

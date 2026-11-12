"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";
import { buildQuery } from "@/lib/api";
import { useApi, useDebounced } from "@/lib/useApi";
import { binLocation, levelPath } from "@/lib/types";
import type { Bin, Item, Paged, Warehouse } from "@/lib/types";
import { Spinner } from "@/components/ui/Feedback";

const inputClass = "mt-1 block h-10 min-w-0 max-w-full w-full rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-400";

type ItemOption = Pick<Item, "_id" | "itemCode" | "description" | "uom" | "itemGroup">;

// Searchable item selector backed by the paginated /items endpoint (never loads the whole catalog).
export function ItemPicker({ label, value, onChange, error, activeOnly = true, required }: { label: string; value: ItemOption | null; onChange: (item: ItemOption | null) => void; error?: string; activeOnly?: boolean; required?: boolean }) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(search, 250);
  const { data, loading } = useApi<Paged<"items", Item>>(open ? `/items${buildQuery({ search: debounced, limit: 10, isActive: activeOnly ? "true" : "", sort: "itemCode", order: "asc" })}` : null);

  return (
    <div className="relative">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">{label}{required && <span className="ml-0.5 text-red-600" aria-hidden="true">*</span>}</label>
      {value ? (
        <div className="mt-1 flex h-10 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm">
          <span className="truncate"><span className="font-medium">{value.itemCode}</span> · {value.description} <span className="text-slate-500">({value.uom})</span></span>
          <button type="button" onClick={() => onChange(null)} aria-label="Clear item" className="rounded p-1 text-slate-500 hover:bg-slate-200"><X size={14} /></button>
        </div>
      ) : (
        <input
          id={id}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          placeholder="Type an item code or description"
          value={search}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(event) => { setSearch(event.target.value); setOpen(true); }}
          className={inputClass}
        />
      )}
      {open && !value && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {loading && <li className="flex justify-center py-3"><Spinner /></li>}
          {!loading && data?.items.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No items found</li>}
          {!loading && data?.items.map((item) => (
            <li key={item._id} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { onChange(item); setSearch(""); setOpen(false); }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
              >
                <span className="font-medium">{item.itemCode}</span> <span className="text-slate-600">{item.description}</span> <span className="text-xs text-slate-400">{item.uom}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function WarehouseSelect({ label, value, onChange, includeAll, activeOnly, error, required }: { label: string; value: string; onChange: (id: string) => void; includeAll?: string; activeOnly?: boolean; error?: string; required?: boolean }) {
  const id = useId();
  const { data } = useApi<Warehouse[]>("/warehouses");
  const warehouses = (data || []).filter((warehouse) => !activeOnly || warehouse.isActive);
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">{label}{required && <span className="ml-0.5 text-red-600" aria-hidden="true">*</span>}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={error ? true : undefined} className={inputClass}>
        <option value="">{includeAll || "Select a warehouse"}</option>
        {warehouses.map((warehouse) => (
          <option key={warehouse._id} value={warehouse._id}>{warehouse.warehouseCode} · {warehouse.warehouseName}{warehouse.isActive ? "" : " (inactive)"}</option>
        ))}
      </select>
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// Searchable bin selector, optionally limited to one warehouse. Shows capacity so users can choose manually.
export function BinPicker({ label, value, onChange, warehouse, error, required }: { label: string; value: Bin | null; onChange: (bin: Bin | null) => void; warehouse?: string; error?: string; required?: boolean }) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(search, 250);
  const { data, loading } = useApi<Paged<"bins", Bin>>(open ? `/bins${buildQuery({ search: debounced, warehouse, isActive: "true", limit: 15 })}` : null);

  return (
    <div className="relative">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">{label}{required && <span className="ml-0.5 text-red-600" aria-hidden="true">*</span>}</label>
      {value ? (
        <div className="mt-1 flex h-10 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm">
          <span className="truncate"><span className="font-medium">{binLocation(value)}</span> <span className="text-slate-500">{levelPath(value.level)}</span></span>
          <button type="button" onClick={() => onChange(null)} aria-label="Clear bin" className="rounded p-1 text-slate-500 hover:bg-slate-200"><X size={14} /></button>
        </div>
      ) : (
        <input
          id={id}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          placeholder="Search bin code or location code"
          value={search}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(event) => { setSearch(event.target.value); setOpen(true); }}
          className={inputClass}
        />
      )}
      {open && !value && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {loading && <li className="flex justify-center py-3"><Spinner /></li>}
          {!loading && data?.bins.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No active bins found</li>}
          {!loading && data?.bins.map((bin) => (
            <li key={bin._id} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { onChange(bin); setSearch(""); setOpen(false); }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
              >
                <span className="font-medium">{binLocation(bin)}</span> <span className="text-xs text-slate-500">{levelPath(bin.level)}</span>
                <span className="block text-xs text-slate-500">
                  {bin.binStatus} · {bin.binType}
                  {bin.capacity !== null ? ` · ${bin.availableCapacity} ${bin.capacityUnit} free` : " · capacity not tracked"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

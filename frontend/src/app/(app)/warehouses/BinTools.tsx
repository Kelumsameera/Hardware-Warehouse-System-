"use client";

import { canPermission } from "@/lib/roles";

import { useMemo, useState } from "react";
import { buildQuery } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/useApi";
import { binLocation, levelPath } from "@/lib/types";
import type { Bin, Item, Paged } from "@/lib/types";
import { useSession } from "@/components/layout/SessionProvider";
import DataTable, { Pagination } from "@/components/ui/DataTable";
import type { Column } from "@/components/ui/DataTable";
import { Badge, Notice } from "@/components/ui/Feedback";
import { FilterSelect, Input, SearchInput } from "@/components/ui/Field";
import { ItemPicker, WarehouseSelect } from "@/components/Pickers";
import Button from "@/components/ui/Button";
import { BinStatusBadge, CapacityBar } from "./binDisplay";

export default function BinTools({ onOpenBin }: { onOpenBin: (bin: Bin) => void }) {
  const { user } = useSession();
  const [search, setSearch] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);

  const withPageReset = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  const { data, error, loading } = useApi<Paged<"bins", Bin>>(`/bins${buildQuery({ search: debounced, warehouse, isActive: status, page, limit: 20 })}`);

  const columns = useMemo<Column<Bin>[]>(() => [
    { id: "code", header: "Bin", cell: (bin) => <button type="button" className="font-medium text-blue-700 hover:underline" onClick={() => onOpenBin(bin)}>{binLocation(bin)}</button> },
    { id: "path", header: "Location", cell: (bin) => <span className="whitespace-nowrap text-slate-600">{levelPath(bin.level)}</span> },
    { id: "type", header: "Type", cell: (bin) => bin.binType },
    { id: "capacity", header: "Capacity", className: "min-w-48", cell: (bin) => <CapacityBar bin={bin} /> },
    { id: "status", header: "Status", cell: (bin) => <BinStatusBadge status={bin.binStatus} /> },
  ], [onOpenBin]);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-base font-semibold text-slate-900">Bin search</h2>
        <div className="my-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <SearchInput label="Search bins" value={search} onChange={withPageReset(setSearch)} placeholder="Bin code, name, or location code" />
          <div className="sm:w-64"><WarehouseSelect label="Warehouse" value={warehouse} onChange={withPageReset(setWarehouse)} includeAll="All warehouses" /></div>
          <FilterSelect label="Bin status" value={status} onChange={withPageReset(setStatus)}>
            <option value="">Active and inactive</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </FilterSelect>
        </div>
        <DataTable caption="Bins" columns={columns} rows={data?.bins || []} getRowId={(bin) => bin._id} loading={loading} error={error} emptyTitle="No bins found" />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
      </section>

      {canPermission(user, "movements.write") && <BinSuggestion onOpenBin={onOpenBin} />}
    </div>
  );
}

type ItemOption = Pick<Item, "_id" | "itemCode" | "description" | "uom" | "itemGroup">;

function BinSuggestion({ onOpenBin }: { onOpenBin: (bin: Bin) => void }) {
  const [item, setItem] = useState<ItemOption | null>(null);
  const [warehouse, setWarehouse] = useState("");
  const [quantity, setQuantity] = useState("");
  const [request, setRequest] = useState<string | null>(null);
  const { data, error, loading } = useApi<{ bins: Bin[] }>(request);
  const ready = item && warehouse && Number(quantity) > 0;

  return (
    <section className="border-t border-slate-200 pt-6">
      <h2 className="text-base font-semibold text-slate-900">Automatic bin suggestion</h2>
      <p className="mt-1 text-sm text-slate-500">Finds active bins that accept the item group and unit, have room for the quantity, and respect dedicated-bin rules. Bins already holding the item are listed first, then the tightest fit.</p>
      <div className="mt-3 grid gap-3 md:grid-cols-4 md:items-end">
        <div className="md:col-span-2"><ItemPicker label="Item" value={item} onChange={setItem} /></div>
        <WarehouseSelect label="Warehouse" value={warehouse} onChange={setWarehouse} activeOnly />
        <Input label="Quantity" type="number" min={0} step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
      </div>
      <Button className="mt-3" disabled={!ready || loading} onClick={() => setRequest(`/bins/suggest${buildQuery({ item: item?._id, warehouse, quantity })}`)}>
        {loading ? "Finding bins..." : "Suggest bins"}
      </Button>
      {error && <div className="mt-3"><Notice>{error}</Notice></div>}
      {data && (
        data.bins.length === 0 ? (
          <div className="mt-3"><Notice type="warning">No suitable bin found. Check bin capacity units, allowed item groups, and free space.</Notice></div>
        ) : (
          <ol className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {data.bins.slice(0, 10).map((bin, index) => (
              <li key={bin._id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <span className="w-6 text-slate-400">{index + 1}.</span>
                <button type="button" onClick={() => onOpenBin(bin)} className="font-medium text-blue-700 hover:underline">{binLocation(bin)}</button>
                <span className="text-slate-500">{bin.binName}</span>
                {bin.containsItem && <Badge tone="blue">Already holds this item</Badge>}
                <span className="ml-auto text-xs text-slate-500">{bin.capacity === null ? "Capacity not tracked" : `${formatNumber(bin.availableCapacity)} ${bin.capacityUnit} free`}</span>
              </li>
            ))}
          </ol>
        )
      )}
    </section>
  );
}

"use client";

import { useSession } from "@/components/layout/SessionProvider";
import { canPermission } from "@/lib/roles";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { buildQuery, downloadFile, errorMessage } from "@/lib/api";
import { endOfDay, formatDate, formatNumber, MOVEMENT_LABELS, startOfDay } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/useApi";
import { binLocation } from "@/lib/types";
import type { Item, Movement, Paged } from "@/lib/types";
import DataTable, { Pagination } from "@/components/ui/DataTable";
import type { Column } from "@/components/ui/DataTable";
import { Badge, Card, Notice, PageHeader } from "@/components/ui/Feedback";
import { FilterSelect, Input, SearchInput } from "@/components/ui/Field";
import { ItemPicker, WarehouseSelect } from "@/components/Pickers";
import Button from "@/components/ui/Button";
import MovementForm from "./MovementForm";

type ItemOption = Pick<Item, "_id" | "itemCode" | "description" | "uom" | "itemGroup">;

const TYPE_TONES: Record<string, "blue" | "amber" | "green" | "slate" | "red"> = {
  receipt: "green",
  issue: "amber",
  transfer: "blue",
  adjustment: "red",
  return: "slate",
};

export function MovementHistory({ fixedType, title, refreshKey = 0 }: { fixedType?: Movement["movementType"]; title?: string; refreshKey?: number }) {
  const { user } = useSession();
  const searchParams = useSearchParams();
  const presetItemId = searchParams.get("item") || "";
  const [itemCleared, setItemCleared] = useState(false);
  const [item, setItem] = useState<ItemOption | null>(null);
  const [type, setType] = useState<string>(fixedType || "");
  const [warehouse, setWarehouse] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [exportError, setExportError] = useState("");
  const debounced = useDebounced(search);

  const preset = useApi<Item>(presetItemId && !item && !itemCleared ? `/items/${presetItemId}` : null);
  const selectedItem = item || (!itemCleared ? preset.data : null);
  const waitingForPreset = Boolean(presetItemId && !itemCleared && !selectedItem);

  const filters = { item: selectedItem?._id, movementType: fixedType || type, warehouse, startDate: startOfDay(from), endDate: endOfDay(to), search: debounced };
  const { data, error, loading } = useApi<Paged<"movements", Movement>>(waitingForPreset ? null : `/stock-movements${buildQuery({ ...filters, page, limit: 25, _r: refreshKey || undefined })}`);

  const reset = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setPage(1); };

  const columns = useMemo<Column<Movement>[]>(() => [
    { id: "date", header: "Date", cell: (movement) => <span className="whitespace-nowrap">{formatDate(movement.occurredAt)}</span> },
    { id: "reference", header: "Reference", cell: (movement) => <span className="whitespace-nowrap font-mono text-xs">{movement.transactionReference}</span> },
    { id: "type", header: "Type", cell: (movement) => <Badge tone={TYPE_TONES[movement.movementType]}>{MOVEMENT_LABELS[movement.movementType]}{movement.adjustmentDirection ? ` (${movement.adjustmentDirection === "increase" ? "+" : "−"})` : ""}</Badge> },
    { id: "item", header: "Item", className: "min-w-48", cell: (movement) => <><span className="font-medium text-slate-900">{movement.item?.itemCode}</span><span className="block text-xs text-slate-500">{movement.item?.description}</span></> },
    { id: "quantity", header: "Quantity", className: "text-right", cell: (movement) => <span className="whitespace-nowrap">{formatNumber(movement.quantity)} {movement.item?.uom}</span> },
    { id: "from", header: "From", cell: (movement) => <span className="whitespace-nowrap">{binLocation(movement.sourceBin)}</span> },
    { id: "to", header: "To", cell: (movement) => <span className="whitespace-nowrap">{binLocation(movement.destinationBin)}</span> },
    { id: "user", header: "User", cell: (movement) => <span className="whitespace-nowrap">{movement.user?.fullName || "—"}</span> },
    { id: "remarks", header: "Remarks", className: "max-w-56", cell: (movement) => <span className="line-clamp-2 text-xs text-slate-500">{movement.remarks || "—"}</span> },
  ], []);

  const exportMovements = async () => {
    setExportError("");
    try {
      await downloadFile(`/reports/movements.xlsx${buildQuery(filters)}`, "stock-movements.xlsx");
    } catch (reason) {
      setExportError(errorMessage(reason));
    }
  };

  return (
    <Card title={title || "Transaction history"} actions={canPermission(user, "reports") ? <Button variant="secondary" size="sm" onClick={() => void exportMovements()}><Download size={14} /> Export Excel</Button> : undefined}>
      {exportError && <div className="mb-3"><Notice>{exportError}</Notice></div>}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 xl:items-end">
        <div className="xl:col-span-2"><ItemPicker label="Item" activeOnly={false} value={selectedItem || null} onChange={(value) => { setItem(value); setItemCleared(!value); setPage(1); }} /></div>
        {!fixedType && (
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Type</span>
            <FilterSelect label="Transaction type" value={type} onChange={reset(setType)}>
              <option value="">All types</option>
              {Object.entries(MOVEMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </FilterSelect>
          </div>
        )}
        <WarehouseSelect label="Warehouse" value={warehouse} onChange={reset(setWarehouse)} includeAll="All warehouses" />
        <Input label="From date" type="date" value={from} onChange={(event) => reset(setFrom)(event.target.value)} />
        <Input label="To date" type="date" value={to} onChange={(event) => reset(setTo)(event.target.value)} />
      </div>
      <div className="mb-3">
        <SearchInput label="Search movements" value={search} onChange={reset(setSearch)} placeholder="Reference, remarks, item code" />
      </div>
      <DataTable caption="Stock movement history" columns={columns} rows={data?.movements || []} getRowId={(movement) => movement._id} loading={loading || preset.loading} error={error || preset.error} emptyTitle="No movements match these filters" />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
    </Card>
  );
}

export default function MovementsView() {
  const { user } = useSession();
  const [historyKey, setHistoryKey] = useState(0);
  return (
    <>
      <PageHeader title="Stock Movements" description="Post receipts, issues, transfers, adjustments, and returns. Every posting is validated and logged by the server." />
      {(canPermission(user, "movements.write") || canPermission(user, "movements.adjust")) && <Card title="New movement">
        <MovementForm key={`${canPermission(user, "movements.write")}-${canPermission(user, "movements.adjust")}`} onPosted={() => setHistoryKey((value) => value + 1)} />
      </Card>}
      <MovementHistory refreshKey={historyKey} />
    </>
  );
}

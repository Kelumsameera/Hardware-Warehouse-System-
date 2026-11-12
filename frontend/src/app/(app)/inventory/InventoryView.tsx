"use client";

import { canPermission } from "@/lib/roles";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Download, History, Lock, Unlock } from "lucide-react";
import { api, buildQuery, downloadFile, errorMessage } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/useApi";
import { binLocation, levelPath } from "@/lib/types";
import type { InventoryRecord, Item, Paged } from "@/lib/types";
import { useSession } from "@/components/layout/SessionProvider";
import DataTable, { Pagination } from "@/components/ui/DataTable";
import type { Column } from "@/components/ui/DataTable";
import { Badge, Card, Notice, PageHeader } from "@/components/ui/Feedback";
import { Input, SearchInput } from "@/components/ui/Field";
import { ItemPicker, WarehouseSelect } from "@/components/Pickers";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

type ItemOption = Pick<Item, "_id" | "itemCode" | "description" | "uom" | "itemGroup">;

function StockStatus({ record }: { record: InventoryRecord }) {
  if (record.quantity <= 0) return <Badge tone="slate">Empty</Badge>;
  if (record.availableQuantity <= 0) return <Badge tone="amber">Fully reserved</Badge>;
  if (record.reservedQuantity > 0) return <Badge tone="blue">Partly reserved</Badge>;
  return <Badge tone="green">Available</Badge>;
}

export default function InventoryView() {
  const { user } = useSession();
  const canReserve = canPermission(user, "inventory.reserve");
  const searchParams = useSearchParams();
  const initialItemId = searchParams.get("item") || "";
  const [item, setItem] = useState<ItemOption | null>(null);
  const [itemCleared, setItemCleared] = useState(false);
  const [warehouse, setWarehouse] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [reserving, setReserving] = useState<{ record: InventoryRecord; direction: "reserve" | "release" } | null>(null);
  const [message, setMessage] = useState("");
  const [exportError, setExportError] = useState("");
  const debounced = useDebounced(search);

  // An item can be preselected from a link such as /inventory?item=<id>.
  const preset = useApi<Item>(initialItemId && !item && !itemCleared ? `/items/${initialItemId}` : null);
  const selectedItem = item || (!itemCleared ? preset.data : null);

  const query = buildQuery({ item: selectedItem?._id, warehouse, search: debounced, page, limit: 25 });
  const { data, error, loading, reload } = useApi<Paged<"inventory", InventoryRecord>>(initialItemId && !itemCleared && !selectedItem ? null : `/inventory${query}`);
  const totals = useApi<{ quantity: number; reservedQuantity: number; availableQuantity: number; itemBinCount: number }>("/inventory/summary");

  const columns = useMemo<Column<InventoryRecord>[]>(() => [
    { id: "item", header: "Item", className: "min-w-56", cell: (record) => <><span className="font-medium text-slate-900">{record.item?.itemCode}</span><span className="block text-xs text-slate-500">{record.item?.description}</span></> },
    { id: "warehouse", header: "Warehouse", cell: (record) => record.bin?.level?.rack?.zone?.warehouse?.warehouseName || "—" },
    { id: "bin", header: "Bin", cell: (record) => <><span className="font-medium">{binLocation(record.bin)}</span><span className="block whitespace-nowrap text-xs text-slate-500">{levelPath(record.bin?.level)}</span></> },
    { id: "quantity", header: "On hand", className: "text-right", cell: (record) => <span className="whitespace-nowrap">{formatNumber(record.quantity)} {record.item?.uom}</span> },
    { id: "reserved", header: "Reserved", className: "text-right", cell: (record) => formatNumber(record.reservedQuantity) },
    { id: "available", header: "Available", className: "text-right", cell: (record) => <span className="font-semibold">{formatNumber(record.availableQuantity)}</span> },
    { id: "status", header: "Status", cell: (record) => <StockStatus record={record} /> },
    { id: "updated", header: "Last change", cell: (record) => <span className="whitespace-nowrap text-xs text-slate-500">{formatDate(record.updatedAt)}</span> },
    {
      id: "actions",
      header: "Actions",
      className: "text-right",
      cell: (record) => (
        <div className="flex justify-end gap-1">
          {canPermission(user, "movements") && record.item && <Link href={`/movements?item=${record.item._id}`} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Movement history" title="Movement history"><History size={14} /></Link>}
          {canReserve && record.availableQuantity > 0 && <Button variant="ghost" size="sm" onClick={() => setReserving({ record, direction: "reserve" })} aria-label="Reserve stock" title="Reserve stock"><Lock size={14} /></Button>}
          {canReserve && record.reservedQuantity > 0 && <Button variant="ghost" size="sm" onClick={() => setReserving({ record, direction: "release" })} aria-label="Release reservation" title="Release reservation"><Unlock size={14} /></Button>}
        </div>
      ),
    },
  ], [canReserve, user]);

  const exportStock = async () => {
    setExportError("");
    try {
      if (warehouse) await downloadFile(`/reports/warehouse-stock.xlsx${buildQuery({ warehouse, search: debounced })}`, "warehouse-stock.xlsx");
      else await downloadFile(`/reports/bin-stock.xlsx${buildQuery({ search: debounced })}`, "bin-stock.xlsx");
    } catch (reason) {
      setExportError(errorMessage(reason));
    }
  };

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Current stock by item, warehouse, and bin. Quantities change only through stock movements."
        actions={canPermission(user, "reports") ? <Button variant="secondary" onClick={() => void exportStock()}><Download size={16} /> Export Excel</Button> : undefined}
      />

      {totals.data && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            ["Stocked item-bin records", formatNumber(totals.data.itemBinCount)],
            ["Quantity on hand", formatNumber(totals.data.quantity)],
            ["Reserved", formatNumber(totals.data.reservedQuantity)],
            ["Available", formatNumber(totals.data.availableQuantity)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">{label}</p>
              <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
            </div>
          ))}
        </div>
      )}

      {message && <Notice type="success">{message}</Notice>}
      {exportError && <Notice>{exportError}</Notice>}

      <Card>
        <div className="mb-4 grid gap-3 md:grid-cols-3 md:items-end">
          <ItemPicker label="Item" activeOnly={false} value={selectedItem || null} onChange={(value) => { setItem(value); setItemCleared(!value); setPage(1); }} />
          <WarehouseSelect label="Warehouse" value={warehouse} onChange={(value) => { setWarehouse(value); setPage(1); }} includeAll="All warehouses" />
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Search</span>
            <SearchInput label="Search inventory" value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Item code or description" />
          </div>
        </div>
        <DataTable caption="Inventory by bin" columns={columns} rows={data?.inventory || []} getRowId={(record) => record._id} loading={loading || preset.loading} error={error || preset.error} emptyTitle="No inventory records match these filters" emptyText="Stock appears here after a receipt or return is posted." />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
      </Card>

      {reserving && canReserve && (
        <ReservationDialog
          record={reserving.record}
          direction={reserving.direction}
          onClose={() => setReserving(null)}
          onDone={(text) => { setReserving(null); setMessage(text); reload(); totals.reload(); }}
        />
      )}
    </>
  );
}

function ReservationDialog({ record, direction, onClose, onDone }: { record: InventoryRecord; direction: "reserve" | "release"; onClose: () => void; onDone: (message: string) => void }) {
  const [quantity, setQuantity] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const limit = direction === "reserve" ? record.availableQuantity : record.reservedQuantity;

  const submit = async () => {
    const amount = Number(quantity);
    if (!Number.isFinite(amount) || amount <= 0) return setError("Enter a quantity greater than zero");
    if (amount > limit) return setError(`Quantity cannot exceed ${formatNumber(limit)}`);
    setSaving(true);
    setError("");
    try {
      await api.post(`/inventory/${record._id}/${direction}`, { quantity: amount });
      onDone(`${formatNumber(amount)} ${record.item?.uom || ""} ${direction === "reserve" ? "reserved" : "released"} for ${record.item?.itemCode}.`);
    } catch (reason) {
      setError(errorMessage(reason));
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={direction === "reserve" ? "Reserve stock" : "Release reservation"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => void submit()} disabled={saving}>{saving ? "Saving..." : "Confirm"}</Button></>}
    >
      <div className="space-y-3 text-sm">
        <p><span className="font-medium">{record.item?.itemCode}</span> in bin <span className="font-medium">{binLocation(record.bin)}</span></p>
        <p className="text-slate-500">{direction === "reserve" ? `Available to reserve: ${formatNumber(limit)}` : `Currently reserved: ${formatNumber(limit)}`} {record.item?.uom}</p>
        {error && <Notice>{error}</Notice>}
        <Input label="Quantity" type="number" min={0} step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
      </div>
    </Modal>
  );
}

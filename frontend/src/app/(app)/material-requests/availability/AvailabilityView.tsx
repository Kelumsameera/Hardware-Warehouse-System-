"use client";

import { canPermission } from "@/lib/roles";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilePlus2, ShoppingCart, Trash2 } from "lucide-react";
import { buildQuery } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/useApi";
import type { ItemAvailability, Paged } from "@/lib/types";
import { useSession } from "@/components/layout/SessionProvider";
import { ItemThumb, StockStatusBadge } from "@/components/ItemThumb";
import DataTable, { Pagination } from "@/components/ui/DataTable";
import type { Column } from "@/components/ui/DataTable";
import { Card, Notice, PageHeader } from "@/components/ui/Feedback";
import { SearchInput } from "@/components/ui/Field";
import Button from "@/components/ui/Button";

type CartLine = { item: ItemAvailability; quantity: string };

export default function AvailabilityView() {
  const router = useRouter();
  const { user } = useSession();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [cart, setCart] = useState<CartLine[]>([]);
  const debounced = useDebounced(search);
  const { data, error, loading } = useApi<Paged<"items", ItemAvailability>>(`/items/availability${buildQuery({ search: debounced, page, limit: 20 })}`);
  const canRequest = canPermission(user, "materialRequests.create");

  const addToCart = (item: ItemAvailability) => {
    const quantity = quantities[item._id] || "1";
    setCart((current) => [...current.filter((line) => line.item._id !== item._id), { item, quantity }]);
  };

  const columns = useMemo<Column<ItemAvailability>[]>(() => [
    { id: "image", header: "", className: "w-14", cell: (item) => <ItemThumb image={item.image} alt="" /> },
    { id: "code", header: "Item code", cell: (item) => <span className="whitespace-nowrap font-medium text-slate-900">{item.itemCode}</span> },
    { id: "description", header: "Description", className: "min-w-56", cell: (item) => <>{item.description}<span className="block text-xs text-slate-500">{[item.itemGroup, item.itemType].filter(Boolean).join(" · ")}</span></> },
    { id: "uom", header: "Unit", cell: (item) => item.uom },
    { id: "available", header: "Available", className: "text-right", cell: (item) => <span className="font-semibold">{formatNumber(item.availableQuantity)}</span> },
    { id: "reserved", header: "Reserved", className: "text-right", cell: (item) => formatNumber(item.reservedQuantity) },
    { id: "status", header: "Status", cell: (item) => <StockStatusBadge status={item.stockStatus} /> },
    ...(canRequest ? [{
      id: "request",
      header: "Request qty",
      className: "text-right",
      cell: (item: ItemAvailability) => {
        const wanted = Number(quantities[item._id] || 0);
        return (
          <div className="flex items-center justify-end gap-2">
            <input
              type="number"
              min={0}
              step="any"
              aria-label={`Quantity of ${item.itemCode} to request`}
              value={quantities[item._id] || ""}
              onChange={(event) => setQuantities((current) => ({ ...current, [item._id]: event.target.value }))}
              className={`h-9 w-24 rounded-lg border px-2 text-right text-sm ${wanted > item.availableQuantity ? "border-amber-400 bg-amber-50" : "border-slate-300"}`}
            />
            <Button size="sm" variant="secondary" onClick={() => addToCart(item)}>Add to MR</Button>
          </div>
        );
      },
    }] : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canRequest, quantities]);

  const createRequest = () => {
    const items = cart.filter((line) => Number(line.quantity) > 0).map((line) => `${line.item._id}:${Number(line.quantity)}`).join(",");
    router.push(`/material-requests/new?items=${encodeURIComponent(items)}`);
  };

  return (
    <>
      <PageHeader title="Item availability" description="Check warehouse stock before requesting. Available = on hand minus reserved, across all bins. Stock can change before the store issues your request." />
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <Card>
          <div className="mb-4"><SearchInput label="Search items" value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Item code / part number, description, group, type" /></div>
          {debounced && data && data.total === 0 && (
            <div className="mb-4">
              <Notice type="warning">
                No item in the Item Master matches “{debounced}”. If it is a new material that the warehouse does not stock,{" "}
                {canPermission(user, "newItemRequests.create") ? <Link href={`/new-item-requests/edit?name=${encodeURIComponent(debounced)}`} className="font-medium underline">raise a New Item Request</Link> : "ask a technician to raise a New Item Request"}.
              </Notice>
            </div>
          )}
          <DataTable caption="Item availability" columns={columns} rows={data?.items || []} getRowId={(item) => item._id} loading={loading} error={error} emptyTitle={debounced ? "Not in the Item Master" : "No items"} />
          {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
        </Card>

        {canRequest && (
          <Card title={`Request list (${cart.length})`} className="h-fit xl:sticky xl:top-20">
            {cart.length === 0 ? (
              <p className="text-sm text-slate-500">Add items with “Add to MR”, then create one material request for all of them.</p>
            ) : (
              <ul className="space-y-2">
                {cart.map((line) => (
                  <li key={line.item._id} className="flex items-center gap-2 text-sm">
                    <ItemThumb image={line.item.image} alt="" size={32} />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{line.item.itemCode}</span><span className="text-xs text-slate-500">{formatNumber(Number(line.quantity))} {line.item.uom}{Number(line.quantity) > line.item.availableQuantity ? " · more than available" : ""}</span></span>
                    <button type="button" onClick={() => setCart((current) => current.filter((entry) => entry.item._id !== line.item._id))} aria-label={`Remove ${line.item.itemCode}`} className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex flex-col gap-2">
              <Button disabled={!cart.length} onClick={createRequest}><ShoppingCart size={16} /> Create material request</Button>
              {canPermission(user, "newItemRequests.create") && <Link href="/new-item-requests/edit" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"><FilePlus2 size={16} /> Request a new item</Link>}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

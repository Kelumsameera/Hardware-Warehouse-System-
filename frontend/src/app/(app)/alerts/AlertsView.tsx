"use client";

import { canPermission } from "@/lib/roles";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { buildQuery, downloadFile, errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/useApi";
import type { StockAlert } from "@/lib/types";
import { useSession } from "@/components/layout/SessionProvider";
import DataTable, { Pagination } from "@/components/ui/DataTable";
import type { Column } from "@/components/ui/DataTable";
import { Badge, Card, Notice, PageHeader } from "@/components/ui/Feedback";
import { SearchInput } from "@/components/ui/Field";
import { WarehouseSelect } from "@/components/Pickers";
import Button from "@/components/ui/Button";

type AlertResponse = {
  alertCount: number;
  totalItems: number;
  counts: Record<string, number>;
  page: number;
  totalPages: number;
  alerts: StockAlert[];
};

const ALERT_TABS = [
  { type: "", label: "All alerts" },
  { type: "out-of-stock", label: "Out of stock" },
  { type: "low-stock", label: "Low stock" },
  { type: "reorder", label: "Reorder level" },
  { type: "minimum", label: "Below minimum" },
  { type: "maximum", label: "Above maximum" },
];

function AlertBadges({ alert }: { alert: StockAlert }) {
  return (
    <div className="flex flex-wrap gap-1">
      {alert.outOfStock && <Badge tone="red">Out of stock</Badge>}
      {!alert.outOfStock && alert.belowMinimum && <Badge tone="amber">Below minimum</Badge>}
      {!alert.outOfStock && alert.atOrBelowReorder && <Badge tone="amber">Reorder</Badge>}
      {alert.aboveMaximum && <Badge tone="blue">Above maximum</Badge>}
    </div>
  );
}

export default function AlertsView() {
  const { user } = useSession();
  const canReplenish = canPermission(user, "movements.write");
  const searchParams = useSearchParams();
  const initialType = searchParams.get("type") || "";
  const [type, setType] = useState(ALERT_TABS.some((tab) => tab.type === initialType) ? initialType : "");
  const [warehouse, setWarehouse] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [exportError, setExportError] = useState("");
  const debounced = useDebounced(search);

  const { data, error, loading } = useApi<AlertResponse>(`/alerts${buildQuery({ type, warehouse, search: debounced, page, limit: 25 })}`);

  const columns = useMemo<Column<StockAlert>[]>(() => [
    { id: "item", header: "Item", className: "min-w-56", cell: (alert) => <><span className="font-medium text-slate-900">{alert.item.itemCode}</span><span className="block text-xs text-slate-500">{alert.item.description}</span></> },
    { id: "alert", header: "Alert", cell: (alert) => <AlertBadges alert={alert} /> },
    { id: "quantity", header: "On hand", className: "text-right", cell: (alert) => <span className="whitespace-nowrap font-semibold">{formatNumber(alert.quantity)} {alert.item.uom}</span> },
    { id: "available", header: "Available", className: "text-right", cell: (alert) => formatNumber(alert.availableQuantity) },
    { id: "min", header: "Minimum", className: "text-right", cell: (alert) => formatNumber(alert.minStock) },
    { id: "reorder", header: "Reorder", className: "text-right", cell: (alert) => formatNumber(alert.reorderLevel) },
    { id: "max", header: "Maximum", className: "text-right", cell: (alert) => alert.maxStock === null ? "—" : formatNumber(alert.maxStock) },
    {
      id: "suggested",
      header: "Suggested order",
      className: "text-right",
      cell: (alert) => {
        // Only shown when a maximum is set: order up to maximum stock.
        if (alert.maxStock === null || alert.quantity >= alert.maxStock) return "—";
        return <span className="whitespace-nowrap">{formatNumber(alert.maxStock - alert.quantity)} {alert.item.uom}</span>;
      },
    },
    {
      id: "actions",
      header: "Actions",
      className: "text-right",
      cell: (alert) => (
        <div className="flex justify-end gap-2 whitespace-nowrap text-sm">
          <Link href={`/inventory?item=${alert.item.id}`} className="font-medium text-blue-600 hover:underline">Stock</Link>
          {canReplenish && <Link href={`/movements?item=${alert.item.id}`} className="font-medium text-blue-600 hover:underline">Receive</Link>}
        </div>
      ),
    },
  ], [canReplenish]);

  const exportAlerts = async () => {
    setExportError("");
    try {
      const report = type === "reorder" ? "reorder" : "low-stock";
      await downloadFile(`/reports/${report}.xlsx${buildQuery({ warehouse, search: debounced })}`, `${report}-stock.xlsx`);
    } catch (reason) {
      setExportError(errorMessage(reason));
    }
  };

  return (
    <>
      <PageHeader
        title="Stock Alerts"
        description="Calculated from each item's minimum, reorder, and maximum levels against current inventory."
        actions={canPermission(user, "reports") ? <Button variant="secondary" onClick={() => void exportAlerts()}><Download size={16} /> Export {type === "reorder" ? "reorder" : "low-stock"} report</Button> : undefined}
      />
      {exportError && <Notice>{exportError}</Notice>}

      <div role="tablist" aria-label="Alert type" className="flex flex-wrap gap-2">
        {ALERT_TABS.map((tab) => {
          const count = tab.type ? data?.counts?.[tab.type] : undefined;
          return (
            <button
              key={tab.type || "all"}
              type="button"
              role="tab"
              aria-selected={type === tab.type}
              onClick={() => { setType(tab.type); setPage(1); }}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${type === tab.type ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              {tab.label}{count !== undefined ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 sm:items-end">
          <WarehouseSelect label="Warehouse" value={warehouse} onChange={(value) => { setWarehouse(value); setPage(1); }} includeAll="All warehouses" />
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Search</span>
            <SearchInput label="Search alerts" value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Item code or description" />
          </div>
        </div>
        {warehouse && <p className="mb-3 text-xs text-slate-500">Quantities are for the selected warehouse only; thresholds are item-level.</p>}
        <DataTable caption="Stock alerts" columns={columns} rows={data?.alerts || []} getRowId={(alert) => alert.item.id} loading={loading} error={error} emptyTitle="No alerts" emptyText="All active items are within their stock thresholds." />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.alertCount} onPageChange={setPage} />}
      </Card>
    </>
  );
}

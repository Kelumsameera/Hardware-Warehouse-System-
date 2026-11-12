"use client";

import { canPermission } from "@/lib/roles";

import { useMemo, useState } from "react";
import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { buildQuery, downloadFile, errorMessage } from "@/lib/api";
import { endOfDay, formatDate, formatNumber, startOfDay } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/useApi";
import { binLocation, levelPath } from "@/lib/types";
import type { Activity, InventoryRecord, Item, Movement, Paged, StockAlert } from "@/lib/types";
import { useSession } from "@/components/layout/SessionProvider";
import DataTable, { Pagination } from "@/components/ui/DataTable";
import type { Column } from "@/components/ui/DataTable";
import { Card, Notice, PageHeader, StatusBadge } from "@/components/ui/Feedback";
import { Input, SearchInput } from "@/components/ui/Field";
import { WarehouseSelect } from "@/components/Pickers";
import Button from "@/components/ui/Button";
import { MovementHistory } from "../movements/MovementsView";

type ReportKey =
  | "items" | "inventory" | "warehouse" | "summary"
  | "receipt" | "issue" | "transfer" | "adjustment" | "return" | "movements"
  | "low-stock" | "reorder" | "activity";

type ReportDefinition = { key: ReportKey; label: string; group: string; description: string };

const REPORTS: ReportDefinition[] = [
  { key: "items", label: "Item Master", group: "Master data", description: "All items with units and stock thresholds." },
  { key: "inventory", label: "Current Inventory / Bin Stock", group: "Inventory", description: "Stock per item and bin, optionally for one warehouse." },
  { key: "warehouse", label: "Warehouse Stock", group: "Inventory", description: "Stock held in a single warehouse with full location paths." },
  { key: "summary", label: "Stock Summary", group: "Inventory", description: "Totals per item per warehouse (Excel only)." },
  { key: "receipt", label: "Stock Receipts", group: "Transactions", description: "Posted receipt transactions." },
  { key: "issue", label: "Stock Issues", group: "Transactions", description: "Posted issue transactions." },
  { key: "transfer", label: "Stock Transfers", group: "Transactions", description: "Bin-to-bin transfers." },
  { key: "adjustment", label: "Stock Adjustments", group: "Transactions", description: "Count corrections (increase / decrease)." },
  { key: "return", label: "Stock Returns", group: "Transactions", description: "Stock returned into bins." },
  { key: "movements", label: "Stock Movement History", group: "Transactions", description: "Every transaction type." },
  { key: "low-stock", label: "Low Stock", group: "Exceptions", description: "Items at or below minimum or reorder level." },
  { key: "reorder", label: "Reorder", group: "Exceptions", description: "Items at or below their reorder level." },
  { key: "activity", label: "Activity History", group: "Audit", description: "Who changed what and when." },
];

function ExportButton({ path, fileName, disabled }: { path: string; fileName: string; disabled?: boolean }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await downloadFile(path, fileName);
          } catch (reason) {
            setError(errorMessage(reason));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Download size={14} /> {busy ? "Preparing..." : "Export Excel"}
      </Button>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ItemReport() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const { data, error, loading } = useApi<Paged<"items", Item>>(`/items${buildQuery({ search: debounced, page, limit: 25, sort: "itemCode", order: "asc" })}`);
  const columns = useMemo<Column<Item>[]>(() => [
    { id: "code", header: "Item code", cell: (item) => <span className="font-medium">{item.itemCode}</span> },
    { id: "description", header: "Description", cell: (item) => item.description },
    { id: "group", header: "Group", cell: (item) => item.itemGroup || "—" },
    { id: "type", header: "Type", cell: (item) => item.itemType || "—" },
    { id: "uom", header: "UoM", cell: (item) => item.uom },
    { id: "min", header: "Min", className: "text-right", cell: (item) => formatNumber(item.minStock) },
    { id: "reorder", header: "Reorder", className: "text-right", cell: (item) => formatNumber(item.reorderLevel) },
    { id: "max", header: "Max", className: "text-right", cell: (item) => item.maxStock === null ? "—" : formatNumber(item.maxStock) },
    { id: "status", header: "Status", cell: (item) => <StatusBadge active={item.isActive} /> },
  ], []);
  return (
    <Card title="Item Master" actions={<ExportButton path={`/reports/items.xlsx${buildQuery({ search: debounced })}`} fileName="item-master.xlsx" />}>
      <div className="no-print mb-3"><SearchInput label="Search items" value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Item code, description, group" /></div>
      <DataTable caption="Item master report" columns={columns} rows={data?.items || []} getRowId={(item) => item._id} loading={loading} error={error} />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
    </Card>
  );
}

function InventoryReport({ requireWarehouse }: { requireWarehouse?: boolean }) {
  const [warehouse, setWarehouse] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const ready = !requireWarehouse || Boolean(warehouse);
  const { data, error, loading } = useApi<Paged<"inventory", InventoryRecord>>(ready ? `/inventory${buildQuery({ warehouse, search: debounced, page, limit: 25 })}` : null);
  const columns = useMemo<Column<InventoryRecord>[]>(() => [
    { id: "item", header: "Item", cell: (record) => <><span className="font-medium">{record.item?.itemCode}</span><span className="block text-xs text-slate-500">{record.item?.description}</span></> },
    { id: "warehouse", header: "Warehouse", cell: (record) => record.bin?.level?.rack?.zone?.warehouse?.warehouseCode || "—" },
    { id: "location", header: "Location", cell: (record) => <span className="whitespace-nowrap">{levelPath(record.bin?.level)} / {binLocation(record.bin)}</span> },
    { id: "qty", header: "Quantity", className: "text-right", cell: (record) => `${formatNumber(record.quantity)} ${record.item?.uom || ""}` },
    { id: "reserved", header: "Reserved", className: "text-right", cell: (record) => formatNumber(record.reservedQuantity) },
    { id: "available", header: "Available", className: "text-right", cell: (record) => formatNumber(record.availableQuantity) },
  ], []);
  const exportPath = requireWarehouse
    ? `/reports/warehouse-stock.xlsx${buildQuery({ warehouse, search: debounced })}`
    : `/reports/bin-stock.xlsx${buildQuery({ warehouse, search: debounced })}`;
  return (
    <Card title={requireWarehouse ? "Warehouse Stock" : "Current Inventory / Bin Stock"} actions={<ExportButton path={exportPath} fileName={requireWarehouse ? "warehouse-stock.xlsx" : "bin-stock.xlsx"} disabled={!ready} />}>
      <div className="no-print mb-3 grid gap-3 sm:grid-cols-2 sm:items-end">
        <WarehouseSelect label="Warehouse" required={requireWarehouse} value={warehouse} onChange={(value) => { setWarehouse(value); setPage(1); }} includeAll={requireWarehouse ? "Select a warehouse" : "All warehouses"} />
        <SearchInput label="Search stock" value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Item code or description" />
      </div>
      {!ready ? <Notice type="info">Select a warehouse to run this report.</Notice> : (
        <>
          <DataTable caption="Inventory report" columns={columns} rows={data?.inventory || []} getRowId={(record) => record._id} loading={loading} error={error} />
          {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
        </>
      )}
    </Card>
  );
}

function SummaryReport() {
  const [warehouse, setWarehouse] = useState("");
  const [search, setSearch] = useState("");
  return (
    <Card title="Stock Summary" actions={<ExportButton path={`/reports/summary.xlsx${buildQuery({ warehouse, search })}`} fileName="stock-summary.xlsx" />}>
      <p className="mb-3 text-sm text-slate-500">Totals per item per warehouse, including the number of bins holding each item. This report is produced as an Excel file.</p>
      <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
        <WarehouseSelect label="Warehouse" value={warehouse} onChange={setWarehouse} includeAll="All warehouses" />
        <SearchInput label="Item search" value={search} onChange={setSearch} placeholder="Item code or description (optional)" />
      </div>
    </Card>
  );
}

function AlertReport({ type }: { type: "low-stock" | "reorder" }) {
  const [warehouse, setWarehouse] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, loading } = useApi<{ alerts: StockAlert[]; alertCount: number; page: number; totalPages: number }>(`/alerts${buildQuery({ type, warehouse, page, limit: 25 })}`);
  const columns = useMemo<Column<StockAlert>[]>(() => [
    { id: "item", header: "Item", cell: (alert) => <><span className="font-medium">{alert.item.itemCode}</span><span className="block text-xs text-slate-500">{alert.item.description}</span></> },
    { id: "qty", header: "Quantity", className: "text-right", cell: (alert) => `${formatNumber(alert.quantity)} ${alert.item.uom || ""}` },
    { id: "available", header: "Available", className: "text-right", cell: (alert) => formatNumber(alert.availableQuantity) },
    { id: "min", header: "Minimum", className: "text-right", cell: (alert) => formatNumber(alert.minStock) },
    { id: "reorder", header: "Reorder", className: "text-right", cell: (alert) => formatNumber(alert.reorderLevel) },
    { id: "max", header: "Maximum", className: "text-right", cell: (alert) => alert.maxStock === null ? "—" : formatNumber(alert.maxStock) },
  ], []);
  return (
    <Card title={type === "reorder" ? "Reorder Report" : "Low Stock Report"} actions={<ExportButton path={`/reports/${type}.xlsx${buildQuery({ warehouse })}`} fileName={`${type}-stock.xlsx`} />}>
      <div className="no-print mb-3 sm:w-80"><WarehouseSelect label="Warehouse" value={warehouse} onChange={(value) => { setWarehouse(value); setPage(1); }} includeAll="All warehouses" /></div>
      <DataTable caption="Stock exception report" columns={columns} rows={data?.alerts || []} getRowId={(alert) => alert.item.id} loading={loading} error={error} emptyTitle="No items in this report" />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.alertCount} onPageChange={setPage} />}
    </Card>
  );
}

function ActivityReport() {
  const [entityType, setEntityType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, loading } = useApi<Paged<"activities", Activity>>(`/activities${buildQuery({ entityType, startDate: startOfDay(from), endDate: endOfDay(to), page, limit: 25 })}`);
  const columns = useMemo<Column<Activity>[]>(() => [
    { id: "date", header: "Date", cell: (activity) => <span className="whitespace-nowrap">{formatDate(activity.createdAt)}</span> },
    { id: "user", header: "User", cell: (activity) => <>{activity.user?.fullName || "—"}<span className="block text-xs text-slate-500">{activity.user?.role}</span></> },
    { id: "action", header: "Action", cell: (activity) => <span className="font-mono text-xs">{activity.action}</span> },
    { id: "entity", header: "Record", cell: (activity) => activity.entityType },
    { id: "details", header: "Details", className: "max-w-72", cell: (activity) => <span className="line-clamp-2 break-all text-xs text-slate-500">{Object.keys(activity.details || {}).length ? JSON.stringify(activity.details) : "—"}</span> },
    { id: "ip", header: "IP", cell: (activity) => <span className="text-xs text-slate-500">{activity.ipAddress || "—"}</span> },
  ], []);
  return (
    <Card title="Activity History">
      <div className="no-print mb-3 grid gap-3 sm:grid-cols-3 sm:items-end">
        <div>
          <label htmlFor="entity-type" className="block text-sm font-medium text-slate-700">Record type</label>
          <select id="entity-type" value={entityType} onChange={(event) => { setEntityType(event.target.value); setPage(1); }} className="mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm">
            <option value="">All record types</option>
            {["User", "Item", "Warehouse", "Zone", "Rack", "Level", "Bin", "Inventory", "StockMovement"].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <Input label="From date" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} />
        <Input label="To date" type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} />
      </div>
      <DataTable caption="Activity history" columns={columns} rows={data?.activities || []} getRowId={(activity) => activity._id} loading={loading} error={error} emptyTitle="No activity recorded for these filters" />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
    </Card>
  );
}

function MovementExportOnly({ type }: { type?: Movement["movementType"] }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [warehouse, setWarehouse] = useState("");
  return (
    <Card title="Transaction export" actions={<ExportButton path={`/reports/movements.xlsx${buildQuery({ movementType: type, warehouse, startDate: startOfDay(from), endDate: endOfDay(to) })}`} fileName="stock-movements.xlsx" />}>
      <p className="mb-3 text-sm text-slate-500">On-screen transaction history is limited to roles that post stock movements. You can still export this report to Excel.</p>
      <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
        <WarehouseSelect label="Warehouse" value={warehouse} onChange={setWarehouse} includeAll="All warehouses" />
        <Input label="From date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Input label="To date" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
      </div>
    </Card>
  );
}

export default function ReportsView() {
  const { user } = useSession();
  const reports = REPORTS.filter((report) => report.key !== "activity" || canPermission(user, "activities"));
  const [selected, setSelected] = useState<ReportKey>("inventory");
  const current = reports.find((report) => report.key === selected) || reports[0];
  const groups = [...new Set(reports.map((report) => report.group))];
  const movementTypes: ReportKey[] = ["receipt", "issue", "transfer", "adjustment", "return", "movements"];
  const isMovementReport = movementTypes.includes(current.key);
  const fixedType = current.key === "movements" ? undefined : (current.key as Movement["movementType"]);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Operational and exception reports built from live records. Export to Excel or print the on-screen view."
        actions={<Button variant="secondary" onClick={() => window.print()} className="no-print"><Printer size={16} /> Print</Button>}
      />
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <nav aria-label="Reports" className="no-print space-y-4">
          {groups.map((group) => (
            <div key={group}>
              <p className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</p>
              <ul className="mt-1 space-y-0.5">
                {reports.filter((report) => report.group === group).map((report) => (
                  <li key={report.key}>
                    <button
                      type="button"
                      onClick={() => setSelected(report.key)}
                      aria-current={current.key === report.key ? "true" : undefined}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${current.key === report.key ? "bg-blue-50 font-medium text-blue-700" : "text-slate-700 hover:bg-white"}`}
                    >
                      <FileSpreadsheet size={14} aria-hidden="true" /> {report.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0 space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{current.label}</h2>
            <p className="text-sm text-slate-500">{current.description}</p>
          </div>
          {current.key === "items" && <ItemReport />}
          {current.key === "inventory" && <InventoryReport key="inventory" />}
          {current.key === "warehouse" && <InventoryReport key="warehouse" requireWarehouse />}
          {current.key === "summary" && <SummaryReport />}
          {(current.key === "low-stock" || current.key === "reorder") && <AlertReport key={current.key} type={current.key} />}
          {current.key === "activity" && <ActivityReport />}
          {isMovementReport && (canPermission(user, "movements")
            ? <MovementHistory key={current.key} fixedType={fixedType} title={current.label} />
            : <MovementExportOnly key={current.key} type={fixedType} />)}
        </div>
      </div>
    </>
  );
}

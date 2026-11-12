"use client";

import { canPermission } from "@/lib/roles";

import Link from "next/link";
import { ArrowLeftRight, Boxes, Layers, Package, PackageX, Plus, RefreshCw, TriangleAlert, Warehouse } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "@/lib/useApi";
import { formatDate, formatDay, formatNumber, MOVEMENT_LABELS } from "@/lib/format";
import { binLocation } from "@/lib/types";
import type { Movement, StockAlert } from "@/lib/types";
import { useSession } from "@/components/layout/SessionProvider";
import { Badge, Card, EmptyState, Loading, Notice, PageHeader } from "@/components/ui/Feedback";
import Button from "@/components/ui/Button";

type DashboardData = {
  counts: {
    totalItems: number;
    activeItems: number;
    totalWarehouses: number;
    activeWarehouses: number;
    totalZones: number;
    totalRacks: number;
    totalLevels: number;
    totalBins: number;
    activeBins: number;
  };
  stock: {
    quantity: number;
    reservedQuantity: number;
    availableQuantity: number;
    stockedLocations: number;
    lowStockItems: number;
    outOfStockItems: number;
  };
  alerts: StockAlert[];
  capacity: { warehouse: string; warehouseCode: string; warehouseName: string; totalBins: number; activeBins: number; fullBins: number; occupiedBins: number; emptyActiveBins: number }[];
  movementSeries: ({ date: string } & Record<string, number | string>)[] | null;
  recentMovements: Movement[] | null;
};

const MOVEMENT_COLORS: Record<string, string> = {
  receipt: "#2563eb",
  issue: "#f97316",
  transfer: "#0d9488",
  adjustment: "#a855f7",
  return: "#64748b",
};

function StatCard({ label, value, detail, icon: Icon, tone = "blue", href }: { label: string; value: string; detail?: string; icon: LucideIcon; tone?: "blue" | "amber" | "red"; href?: string }) {
  const tones = { blue: "bg-blue-50 text-blue-600", amber: "bg-amber-50 text-amber-600", red: "bg-red-50 text-red-600" };
  const content = (
    <div className="h-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm text-slate-500">{label}</span>
        <span className={`rounded-lg p-2 ${tones[tone]}`}><Icon size={16} aria-hidden="true" /></span>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
      {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
    </div>
  );
  return href ? <Link href={href} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-blue-600">{content}</Link> : content;
}

export default function DashboardView() {
  const { user } = useSession();
  const { data, error, loading, reload } = useApi<DashboardData>("/dashboard");

  return (
    <>
      <PageHeader
        title="Warehouse Overview"
        description="Live figures calculated from inventory, location, and movement records."
        actions={
          <>
            <Button variant="secondary" onClick={reload} disabled={loading}><RefreshCw size={16} /> Refresh</Button>
            {canPermission(user, "movements.write") && <Link href="/movements" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"><ArrowLeftRight size={16} /> New movement</Link>}
            {canPermission(user, "items.write") && <Link href="/items?new=1" className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"><Plus size={16} /> New item</Link>}
          </>
        }
      />

      {error && <Notice>{error}</Notice>}
      {loading && !data && <Loading text="Loading dashboard..." />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Items" value={formatNumber(data.counts.totalItems)} detail={`${formatNumber(data.counts.activeItems)} active`} icon={Package} href={canPermission(user, "items") ? "/items" : undefined} />
            <StatCard label="Warehouses" value={formatNumber(data.counts.totalWarehouses)} detail={`${formatNumber(data.counts.activeWarehouses)} active`} icon={Warehouse} href={canPermission(user, "warehouses") ? "/warehouses" : undefined} />
            <StatCard label="Racks / Bins" value={`${formatNumber(data.counts.totalRacks)} / ${formatNumber(data.counts.totalBins)}`} detail={`${formatNumber(data.counts.activeBins)} active bins`} icon={Layers} href={canPermission(user, "warehouses") ? "/warehouses" : undefined} />
            <StatCard label="Quantity on hand" value={formatNumber(data.stock.quantity)} detail={`${formatNumber(data.stock.availableQuantity)} available · ${formatNumber(data.stock.reservedQuantity)} reserved`} icon={Boxes} href={canPermission(user, "inventory") ? "/inventory" : undefined} />
            <StatCard label="Low stock items" value={formatNumber(data.stock.lowStockItems)} detail="At or below minimum / reorder level" icon={TriangleAlert} tone="amber" href={canPermission(user, "alerts") ? "/alerts?type=low-stock" : undefined} />
            <StatCard label="Out of stock" value={formatNumber(data.stock.outOfStockItems)} detail="Active items with zero quantity" icon={PackageX} tone="red" href={canPermission(user, "alerts") ? "/alerts?type=out-of-stock" : undefined} />
          </div>
          <p className="-mt-2 text-xs text-slate-500">Quantities are summed across items with different units of measure; use Inventory for per-item figures.</p>

          <div className="grid gap-6 xl:grid-cols-3">
            {data.movementSeries ? (
              <Card title="Stock movements" description="Transactions per day, last 14 days" className="xl:col-span-2">
                {data.movementSeries.every((day) => Object.keys(MOVEMENT_COLORS).every((type) => !day[type])) ? (
                  <EmptyState title="No movements in the last 14 days" />
                ) : (
                  <div className="h-72" role="img" aria-label="Bar chart of stock movements per day for the last 14 days">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.movementSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="date" tickFormatter={formatDay} tick={{ fontSize: 11, fill: "#64748b" }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                        <Tooltip labelFormatter={(value) => formatDay(String(value))} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        {Object.entries(MOVEMENT_COLORS).map(([type, color]) => (
                          <Bar key={type} dataKey={type} name={MOVEMENT_LABELS[type]} stackId="movements" fill={color} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>
            ) : (
              <Card title="Stock movements" className="xl:col-span-2">
                <EmptyState title="Movement history is not available for your role" />
              </Card>
            )}

            <Card title="Stock alerts" description="Items needing replenishment" actions={canPermission(user, "alerts") ? <Link href="/alerts" className="text-sm font-medium text-blue-600 hover:underline">View all</Link> : undefined}>
              {data.alerts.length === 0 ? (
                <EmptyState title="No low-stock or out-of-stock items" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.alerts.map((alert) => (
                    <li key={alert.item.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">{alert.item.itemCode}</p>
                        <p className="truncate text-xs text-slate-500">{alert.item.description}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Badge tone={alert.outOfStock ? "red" : "amber"}>{alert.outOfStock ? "Out of stock" : "Low stock"}</Badge>
                        <p className="mt-1 text-xs text-slate-500">{formatNumber(alert.quantity)} {alert.item.uom} · reorder {formatNumber(alert.reorderLevel)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card title="Recent transactions" className="xl:col-span-2" actions={data.recentMovements ? <Link href="/movements" className="text-sm font-medium text-blue-600 hover:underline">View history</Link> : undefined}>
              {!data.recentMovements ? (
                <EmptyState title="Movement history is not available for your role" />
              ) : data.recentMovements.length === 0 ? (
                <EmptyState title="No stock movements recorded yet" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <caption className="sr-only">Most recent stock movements</caption>
                    <thead className="text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th scope="col" className="py-2 pr-3">Date</th>
                        <th scope="col" className="py-2 pr-3">Type</th>
                        <th scope="col" className="py-2 pr-3">Item</th>
                        <th scope="col" className="py-2 pr-3 text-right">Qty</th>
                        <th scope="col" className="py-2 pr-3">From → To</th>
                        <th scope="col" className="py-2">User</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.recentMovements.map((movement) => (
                        <tr key={movement._id}>
                          <td className="whitespace-nowrap py-2 pr-3 text-slate-500">{formatDate(movement.occurredAt)}</td>
                          <td className="py-2 pr-3"><Badge tone="blue">{MOVEMENT_LABELS[movement.movementType]}</Badge></td>
                          <td className="whitespace-nowrap py-2 pr-3 font-medium text-slate-800">{movement.item?.itemCode || "—"}</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(movement.quantity)}</td>
                          <td className="whitespace-nowrap py-2 pr-3 text-slate-600">{binLocation(movement.sourceBin)} → {binLocation(movement.destinationBin)}</td>
                          <td className="whitespace-nowrap py-2 text-slate-600">{movement.user?.fullName || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Warehouse capacity" description="Bin usage per warehouse">
              {data.capacity.length === 0 ? (
                <EmptyState title="No bins configured yet" action={canPermission(user, "warehouses.write") ? <Link href="/warehouses" className="text-sm font-medium text-blue-600 hover:underline">Set up locations</Link> : undefined} />
              ) : (
                <ul className="space-y-4">
                  {data.capacity.map((row) => {
                    const usedPercent = row.activeBins ? Math.round((row.occupiedBins / row.activeBins) * 100) : 0;
                    return (
                      <li key={row.warehouse}>
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="font-medium text-slate-800">{row.warehouseCode} · {row.warehouseName}</span>
                          <span className="text-xs text-slate-500">{usedPercent}% occupied</span>
                        </div>
                        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={usedPercent} aria-valuemin={0} aria-valuemax={100} aria-label={`${row.warehouseCode} bins occupied`}>
                          <div className="h-full rounded-full bg-blue-600" style={{ width: `${usedPercent}%` }} />
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {row.occupiedBins} occupied · {row.emptyActiveBins} empty · {row.fullBins} full · {row.totalBins - row.activeBins} inactive
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Location summary">
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-5">
              {[
                ["Warehouses", data.counts.totalWarehouses],
                ["Zones", data.counts.totalZones],
                ["Racks", data.counts.totalRacks],
                ["Levels", data.counts.totalLevels],
                ["Bins", data.counts.totalBins],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-lg bg-slate-50 p-3">
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="mt-1 text-lg font-semibold text-slate-900">{formatNumber(value as number)}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </>
      )}
    </>
  );
}

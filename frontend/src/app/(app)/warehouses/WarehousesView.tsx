"use client";

import { canPermission } from "@/lib/roles";

import { useState } from "react";
import { ChevronRight, Pencil, Plus, Power } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { Bin, InventoryRecord, Paged } from "@/lib/types";
import { useSession } from "@/components/layout/SessionProvider";
import { Badge, Card, EmptyState, Loading, Notice, PageHeader, StatusBadge } from "@/components/ui/Feedback";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { HIERARCHY, LOCATION_CONFIG } from "./locationConfig";
import type { LocationKind } from "./locationConfig";
import LocationForm from "./LocationForm";
import type { LocationRecord } from "./LocationForm";
import RackDesigner from "./RackDesigner";
import BinTools from "./BinTools";
import { BinStatusBadge, CapacityBar } from "./binDisplay";

type Selection = Partial<Record<LocationKind, LocationRecord>>;

function LocationColumn({ kind, parent, selected, onSelect, canEdit, onEdit, onAdd, refreshKey, onChanged }: {
  kind: LocationKind;
  parent: LocationRecord | null;
  selected?: LocationRecord;
  onSelect: (record: LocationRecord) => void;
  canEdit: boolean;
  onEdit: (record: LocationRecord) => void;
  onAdd: () => void;
  refreshKey: number;
  onChanged: (message: string, isError?: boolean) => void;
}) {
  const config = LOCATION_CONFIG[kind];
  const basePath = config.listPath(parent?._id || null);
  // _r changes after an edit so the list reloads; the backend ignores unknown query parameters.
  const path = config.parentField && !parent ? null : `${basePath}${basePath.includes("?") ? "&" : "?"}_r=${refreshKey}`;
  const { data, error, loading } = useApi<LocationRecord[] | Record<string, unknown>>(path);
  const records = (Array.isArray(data) ? data : (data?.[config.responseKey || ""] as LocationRecord[] | undefined)) || [];
  const total = Array.isArray(data) ? records.length : Number((data as { total?: number } | null)?.total || 0);

  const toggle = async (record: LocationRecord) => {
    const action = record.isActive ? config.deactivate(record._id) : config.activate(record._id);
    const code = String(record[config.codeField]);
    if (!window.confirm(`${record.isActive ? "Deactivate" : "Activate"} ${config.label.toLowerCase()} ${code}?`)) return;
    try {
      if (action.method === "delete") await api.delete(action.path);
      else if (action.method === "put") await api.put(action.path, "body" in action ? action.body : undefined);
      else await api.patch(action.path);
      onChanged(`${config.label} ${code} ${record.isActive ? "deactivated" : "activated"}.`);
    } catch (reason) {
      onChanged(errorMessage(reason), true);
    }
  };

  return (
    <section className="flex min-h-64 flex-col rounded-xl border border-slate-200 bg-white shadow-sm" aria-label={config.plural}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
        <h2 className="text-sm font-semibold text-slate-900">{config.plural} {parent || !config.parentField ? <span className="font-normal text-slate-500">({total})</span> : null}</h2>
        {canEdit && (!config.parentField || parent) && (
          <Button size="sm" variant="secondary" onClick={onAdd} disabled={Boolean(parent && !parent.isActive)} title={parent && !parent.isActive ? "Parent is inactive" : undefined} aria-label={`Add ${config.label.toLowerCase()}`}>
            <Plus size={14} /> Add
          </Button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {config.parentField && !parent ? (
          <p className="p-4 text-sm text-slate-400">Select a {LOCATION_CONFIG[HIERARCHY[HIERARCHY.indexOf(kind) - 1]].label.toLowerCase()} first.</p>
        ) : loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="p-3"><Notice>{error}</Notice></div>
        ) : records.length === 0 ? (
          <EmptyState title={`No ${config.plural.toLowerCase()}`} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {records.map((record) => {
              const isSelected = selected?._id === record._id;
              return (
                <li key={record._id} className={isSelected ? "bg-blue-50" : ""}>
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => onSelect(record)}
                      aria-pressed={isSelected}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-600"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">{String(record[config.codeField])}</span>
                        <span className="block truncate text-xs text-slate-500">{String(record[config.nameField] || "")}</span>
                        {kind === "bin" && <span className="mt-1 block"><CapacityBar bin={record as unknown as Bin} /></span>}
                      </span>
                      {kind === "bin" ? <BinStatusBadge status={(record as unknown as Bin).binStatus} /> : !record.isActive && <StatusBadge active={false} />}
                      {kind !== "bin" && <ChevronRight size={14} className="shrink-0 text-slate-400" aria-hidden="true" />}
                    </button>
                    {canEdit && (
                      <>
                        <button type="button" onClick={() => onEdit(record)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label={`Edit ${String(record[config.codeField])}`}><Pencil size={13} /></button>
                        <button type="button" onClick={() => void toggle(record)} className="rounded p-1.5 hover:bg-slate-100" aria-label={`${record.isActive ? "Deactivate" : "Activate"} ${String(record[config.codeField])}`}>
                          <Power size={13} className={record.isActive ? "text-red-600" : "text-emerald-600"} />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {total > records.length && <p className="px-3 py-2 text-xs text-slate-500">Showing the first {records.length} of {total}. Use Bin search to find others.</p>}
      </div>
    </section>
  );
}

function BinInventory({ bin, onClose }: { bin: Bin; onClose: () => void }) {
  const { data, error, loading } = useApi<Paged<"inventory", InventoryRecord>>(`/inventory?bin=${bin._id}&limit=100`);
  return (
    <Modal open onClose={onClose} title={`Bin ${bin.locationCode || bin.binCode}`} size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <BinStatusBadge status={bin.binStatus} />
          <Badge>{bin.binType}</Badge>
          {bin.allowedItemGroups.length > 0 && <span className="text-slate-500">Allowed groups: {bin.allowedItemGroups.join(", ")}</span>}
        </div>
        <CapacityBar bin={bin} />
        <h3 className="text-sm font-semibold">Stock in this bin</h3>
        {loading ? <Loading /> : error ? <Notice>{error}</Notice> : !data?.inventory.length ? (
          <EmptyState title="This bin is empty" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <caption className="sr-only">Inventory in bin</caption>
              <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                <tr><th scope="col" className="px-3 py-2">Item</th><th scope="col" className="px-3 py-2 text-right">Quantity</th><th scope="col" className="px-3 py-2 text-right">Reserved</th><th scope="col" className="px-3 py-2 text-right">Available</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.inventory.map((record) => (
                  <tr key={record._id}>
                    <td className="px-3 py-2"><span className="font-medium">{record.item?.itemCode}</span> <span className="text-slate-500">{record.item?.description}</span></td>
                    <td className="px-3 py-2 text-right">{formatNumber(record.quantity)} {record.item?.uom}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(record.reservedQuantity)}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatNumber(record.availableQuantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function WarehousesView() {
  const { user } = useSession();
  const canEdit = canPermission(user, "warehouses.write");
  const [tab, setTab] = useState<"hierarchy" | "bins">("hierarchy");
  const [selection, setSelection] = useState<Selection>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [form, setForm] = useState<{ kind: LocationKind; record: LocationRecord | null } | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [binDetail, setBinDetail] = useState<Bin | null>(null);

  const select = (kind: LocationKind, record: LocationRecord) => {
    const index = HIERARCHY.indexOf(kind);
    const next: Selection = {};
    for (const level of HIERARCHY.slice(0, index)) next[level] = selection[level];
    next[kind] = record;
    setSelection(next);
    if (kind === "bin") setBinDetail(record as unknown as Bin);
  };

  const parentOf = (kind: LocationKind) => {
    const index = HIERARCHY.indexOf(kind);
    return index === 0 ? null : selection[HIERARCHY[index - 1]] || null;
  };

  const breadcrumb = HIERARCHY.filter((kind) => selection[kind]).map((kind) => String(selection[kind]?.[LOCATION_CONFIG[kind].codeField]));

  return (
    <>
      <PageHeader title="Warehouse Management" description="Warehouse → Zone → Rack → Level → Bin location hierarchy." />

      <div role="tablist" aria-label="Warehouse views" className="flex gap-1 border-b border-slate-200">
        {[["hierarchy", "Location hierarchy"], ["bins", "Bin search & suggestions"]].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key as typeof tab)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === key ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-6"><RackDesigner /></div>
      {message && <Notice type={message.error ? "error" : "success"}>{message.text}</Notice>}

      {tab === "hierarchy" ? (
        <>
          <p className="text-sm text-slate-500">{breadcrumb.length ? `Selected: ${breadcrumb.join(" / ")}` : "Select a warehouse to browse its zones, racks, levels, and bins."}</p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {HIERARCHY.map((kind) => (
              <LocationColumn
                key={`${kind}-${parentOf(kind)?._id || "root"}`}
                kind={kind}
                parent={parentOf(kind)}
                selected={selection[kind]}
                onSelect={(record) => select(kind, record)}
                canEdit={canEdit}
                onEdit={(record) => setForm({ kind, record })}
                onAdd={() => setForm({ kind, record: null })}
                refreshKey={refreshKey}
                onChanged={(text, error) => {
                  setMessage({ text, error: Boolean(error) });
                  if (!error) setRefreshKey((value) => value + 1);
                }}
              />
            ))}
          </div>
        </>
      ) : (
        <Card>
          <BinTools onOpenBin={setBinDetail} />
        </Card>
      )}

      {form && canEdit && (
        <LocationForm
          config={LOCATION_CONFIG[form.kind]}
          record={form.record}
          parentId={parentOf(form.kind)?._id || null}
          parentLabel={breadcrumb.slice(0, HIERARCHY.indexOf(form.kind)).join(" / ")}
          onClose={() => setForm(null)}
          onSaved={() => {
            setMessage({ text: `${LOCATION_CONFIG[form.kind].label} saved.`, error: false });
            setForm(null);
            setRefreshKey((value) => value + 1);
          }}
        />
      )}

      {binDetail && <BinInventory bin={binDetail} onClose={() => setBinDetail(null)} />}
    </>
  );
}

"use client";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useApi, useDebounced } from "@/lib/useApi";
import { useSession } from "@/components/layout/SessionProvider";
import { canPermission } from "@/lib/roles";
import type { Rack } from "@/lib/types";
import { Card, Notice, Loading } from "@/components/ui/Feedback";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

type GridBin = { _id: string; level: string; gridColumn?: number; binCode: string; binName: string; isActive: boolean; archivedAt?: string; inventory: { _id: string; quantity: number; reservedQuantity: number; item: { itemCode: string; description: string; uom: string } | null }[] };
type Grid = { rack: Rack & { gridRows: number; gridColumns: number }; levels: { _id: string; levelNumber: number; levelName: string }[]; bins: GridBin[] };
export default function RackDesigner() {
  const { user } = useSession();
  const editable = canPermission(user, "warehouses.write");
  const [rackSearch, setRackSearch] = useState("");
  const search = useDebounced(rackSearch);
  const racks = useApi<{ racks: Rack[]; total: number }>(`/racks?limit=100&search=${encodeURIComponent(search)}`);
  const [rackId, setRackId] = useState("");
  const [revision, setRevision] = useState(0);
  const grid = useApi<Grid>(rackId ? `/racks/${rackId}/grid?r=${revision}` : null);
  const [rowInput, setRows] = useState<number | null>(null);
  const [columnInput, setColumns] = useState<number | null>(null);
  const [selected, setSelected] = useState<GridBin | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = grid.data?.rack._id === rackId && !grid.loading;
  const rows = rowInput ?? grid.data?.rack.gridRows ?? 1;
  const columns = columnInput ?? grid.data?.rack.gridColumns ?? 1;
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await action(); setSelected(null); setRevision((value) => value + 1); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  const open = (bin: GridBin) => { setSelected(bin); setName(bin.binName); };
  return <Card title="Visual rack and bin designer">
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <label className="min-w-0 text-sm">Find rack<input aria-label="Find rack" className="mt-1 block w-40 max-w-full rounded border p-2" value={rackSearch} onChange={(event) => setRackSearch(event.target.value)} /></label>
      <label className="min-w-0 text-sm">Rack<select aria-label="Designer rack" className="mt-1 block max-w-full rounded border p-2" value={rackId} onChange={(event) => { setRackId(event.target.value); setSelected(null); setRows(null); setColumns(null); setError(""); }}><option value="">Select rack</option>{racks.data?.racks.map((rack) => <option key={rack._id} value={rack._id}>{rack.rackCode} &mdash; {rack.rackName}</option>)}</select></label>
      {editable && rackId && <><label className="text-sm">Rows<input aria-label="Grid rows" className="mt-1 block w-20 rounded border p-2" type="number" min={1} max={20} value={rows} onChange={(event) => setRows(Number(event.target.value))} /></label>
      <label className="text-sm">Columns<input aria-label="Grid columns" className="mt-1 block w-20 rounded border p-2" type="number" min={1} max={20} value={columns} onChange={(event) => setColumns(Number(event.target.value))} /></label>
      <Button disabled={busy || !ready} onClick={() => void run(() => api.put(`/racks/${rackId}/grid`, { rows, columns }))}>Save grid</Button></>}
    </div>
    {(error || grid.error || racks.error) && <Notice type="error">{error || grid.error || racks.error}</Notice>}
    {grid.loading && <Loading />}
    {ready && grid.data && <>
      <p className="mb-3 text-sm text-slate-500">Select a bin to inspect stock or manage it. Saving adopts existing bins and creates empty cells. Shrinking archives empty bins and preserves their IDs.</p>
      <div className="space-y-4 overflow-x-auto" aria-label="Rack grid">
        {Array.from({ length: grid.data.rack.gridRows }, (_, index) => index + 1).map((row) => {
          const level = grid.data!.levels.find((entry) => entry.levelNumber === row);
          return <section key={row} aria-label={`Row ${row}`}><h3 className="mb-2 text-sm font-semibold">{level?.levelName || `Row ${row}`}</h3>
            <div className="rack-bin-grid grid gap-2" style={{ "--rack-columns": grid.data!.rack.gridColumns } as React.CSSProperties}>
              {Array.from({ length: grid.data!.rack.gridColumns }, (_, index) => index + 1).map((column) => {
                const bin = grid.data!.bins.find((entry) => entry.level === level?._id && entry.gridColumn === column);
                return bin ? <button key={column} type="button" onClick={() => open(bin)} className={`min-h-28 min-w-0 rounded-lg border p-3 text-left hover:ring-2 hover:ring-blue-400 ${bin.archivedAt ? "border-slate-300 bg-slate-200" : !bin.isActive ? "border-red-300 bg-red-50" : bin.inventory.length ? "border-blue-300 bg-blue-50" : "border-emerald-300 bg-emerald-50"}`}>
                  <span className="block break-words font-semibold">{bin.binCode}</span><span className="block break-words text-sm">{bin.binName}</span>
                  <span className="block text-xs">{bin.archivedAt ? "Archived" : !bin.isActive ? "Disabled" : !bin.inventory.length ? "Empty" : `${bin.inventory.length} item types`}</span>
                  {bin.inventory.map((entry) => <span key={entry._id} className="block break-words text-xs">{entry.item?.itemCode}: {entry.quantity} {entry.item?.uom}</span>)}
                </button> : <div key={column} className="rounded border border-dashed p-3 text-sm text-slate-400">Column {column} ? Save grid to create</div>;
              })}
            </div></section>;
        })}
      </div>
      {grid.data.bins.some((bin) => !bin.gridColumn && !bin.archivedAt) && <p className="mt-3 text-sm">Existing bins have no grid position. Save a grid wide enough to adopt them.</p>}
      {grid.data.bins.filter((bin) => bin.archivedAt).length > 0 && <details className="mt-4"><summary>Archived bins and retained history</summary>{grid.data.bins.filter((bin) => bin.archivedAt).map((bin) => <button key={bin._id} className="m-1 rounded border p-2 text-sm" onClick={() => open(bin)}>{bin.binCode} ? {bin.binName}</button>)}</details>}
    </>}
    <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected ? `Bin ${selected.binCode}` : "Bin"}>
      {selected && <div className="space-y-4"><p className="break-all text-xs text-slate-500">Stable ID: {selected._id}</p>
        <label className="block text-sm">Bin name<input aria-label="Bin name" className="mt-1 w-full rounded border p-2" value={name} disabled={!editable || Boolean(selected.archivedAt)} onChange={(event) => setName(event.target.value)} /></label>
        {selected.inventory.length ? selected.inventory.map((entry) => <p key={entry._id} className="text-sm">{entry.item?.itemCode} ? {entry.item?.description}: {entry.quantity} {entry.item?.uom} ({entry.reservedQuantity} reserved)</p>) : <p className="text-sm">No stock</p>}
        {editable && !selected.archivedAt && <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !name.trim()} onClick={() => void run(() => api.put(`/bins/${selected._id}`, { binName: name }))}>Rename</Button>
          <Button variant="secondary" disabled={busy || Boolean(selected.inventory.length)} onClick={() => void run(() => api.patch(`/bins/${selected._id}/${selected.isActive ? "deactivate" : "reactivate"}`))}>{selected.isActive ? "Disable" : "Enable"}</Button>
          <Button variant="danger" disabled={busy || Boolean(selected.inventory.length)} onClick={() => void run(() => api.delete(`/bins/${selected._id}`))}>Archive bin</Button>
        </div>}
        {error && <Notice type="error">{error}</Notice>}
      </div>}
    </Modal>
  </Card>;
}

"use client";

import { canPermission } from "@/lib/roles";

import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Eye, Pencil, Plus, Power, Upload } from "lucide-react";
import { api, buildQuery, downloadFile, errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/useApi";
import type { Item, Paged } from "@/lib/types";
import { useSession } from "@/components/layout/SessionProvider";
import DataTable, { Pagination } from "@/components/ui/DataTable";
import type { Column, SortState } from "@/components/ui/DataTable";
import { Card, Notice, PageHeader, StatusBadge } from "@/components/ui/Feedback";
import { FilterSelect, SearchInput } from "@/components/ui/Field";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import ItemForm from "./ItemForm";
import ItemDetails, { imageUrl } from "./ItemDetails";

type ItemOptions = { itemGroups: string[]; itemTypes: string[]; uoms: string[] };
type ImportResult = { total: number; imported: number; updated: number; skipped: number };
const emptyOptions: ItemOptions = { itemGroups: [], itemTypes: [], uoms: [] };

export default function ItemsView() {
  const { user } = useSession();
  const canEdit = canPermission(user, "items.write");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [itemGroup, setItemGroup] = useState("");
  const [itemType, setItemType] = useState("");
  const [sort, setSort] = useState<SortState>({ field: "createdAt", order: "desc" });
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [editing, setEditing] = useState<Item | null>(null);
  const searchParams = useSearchParams();
  const [formOpen, setFormOpen] = useState(() => canEdit && searchParams.get("new") === "1");
  const [viewing, setViewing] = useState<Item | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const debouncedSearch = useDebounced(search);

  const query = buildQuery({ page, limit: 20, search: debouncedSearch, isActive: status, itemGroup, itemType, sort: sort.field, order: sort.order });
  const { data, error, loading, reload } = useApi<Paged<"items", Item>>(`/items${query}`);
  const filters = useApi<ItemOptions>("/items/filters");
  const options = filters.data || emptyOptions;

  // Any filter change returns to the first page.
  const withPageReset = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const toggleActive = async (item: Item) => {
    const verb = item.isActive ? "Deactivate" : "Activate";
    if (!window.confirm(`${verb} item ${item.itemCode}?`)) return;
    setActionError("");
    try {
      if (item.isActive) await api.delete(`/items/${item._id}`);
      else await api.put(`/items/${item._id}`, { isActive: true });
      setMessage(`Item ${item.itemCode} ${item.isActive ? "deactivated" : "activated"}.`);
      reload();
    } catch (reason) {
      setActionError(errorMessage(reason));
    }
  };

  const exportItems = async () => {
    setActionError("");
    try {
      await downloadFile(`/reports/items.xlsx${buildQuery({ search: debouncedSearch })}`, "item-master.xlsx");
    } catch (reason) {
      setActionError(errorMessage(reason));
    }
  };

  const columns = useMemo<Column<Item>[]>(() => [
    {
      id: "image",
      header: "",
      className: "w-12",
      cell: (item) => item.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated image served through the API proxy
        <img src={imageUrl(item.image)} alt="" className="h-9 w-9 rounded-md border border-slate-200 object-cover" />
      ) : <div className="h-9 w-9 rounded-md bg-slate-100" aria-hidden="true" />,
    },
    { id: "itemCode", header: "Item code", sortKey: "itemCode", cell: (item) => <span className="whitespace-nowrap font-medium text-slate-900">{item.itemCode}</span> },
    { id: "description", header: "Description", sortKey: "description", className: "min-w-56", cell: (item) => item.description },
    { id: "itemGroup", header: "Group", sortKey: "itemGroup", cell: (item) => item.itemGroup || "—" },
    { id: "itemType", header: "Type", sortKey: "itemType", cell: (item) => item.itemType || "—" },
    { id: "uom", header: "UoM", sortKey: "uom", cell: (item) => item.uom || "—" },
    { id: "levels", header: "Min / Reorder / Max", cell: (item) => <span className="whitespace-nowrap">{formatNumber(item.minStock)} / {formatNumber(item.reorderLevel)} / {item.maxStock === null ? "—" : formatNumber(item.maxStock)}</span> },
    { id: "status", header: "Status", cell: (item) => <StatusBadge active={item.isActive} /> },
    {
      id: "actions",
      header: "Actions",
      className: "text-right",
      cell: (item) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setViewing(item)} aria-label={`View ${item.itemCode}`}><Eye size={14} /></Button>
          {canEdit && <Button variant="ghost" size="sm" onClick={() => { setEditing(item); setFormOpen(true); }} aria-label={`Edit ${item.itemCode}`}><Pencil size={14} /></Button>}
          {canEdit && <Button variant="ghost" size="sm" onClick={() => void toggleActive(item)} aria-label={`${item.isActive ? "Deactivate" : "Activate"} ${item.itemCode}`}><Power size={14} className={item.isActive ? "text-red-600" : "text-emerald-600"} /></Button>}
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canEdit]);

  return (
    <>
      <PageHeader
        title="Item Master"
        description="Engineering items, units of measure, and stock thresholds."
        actions={
          <>
            {canPermission(user, "reports") && <Button variant="secondary" onClick={() => void exportItems()}><Download size={16} /> Export Excel</Button>}
            {canEdit && <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload size={16} /> Import Excel</Button>}
            {canEdit && <Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus size={16} /> New item</Button>}
          </>
        }
      />

      {message && <Notice type="success">{message}</Notice>}
      {actionError && <Notice>{actionError}</Notice>}

      <Card>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <SearchInput label="Search items" value={search} onChange={withPageReset(setSearch)} placeholder="Search code, description, group" />
          <FilterSelect label="Status" value={status} onChange={withPageReset(setStatus)}>
            <option value="">All statuses</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </FilterSelect>
          <FilterSelect label="Item group" value={itemGroup} onChange={withPageReset(setItemGroup)}>
            <option value="">All groups</option>
            {options.itemGroups.map((group) => <option key={group} value={group}>{group}</option>)}
          </FilterSelect>
          <FilterSelect label="Item type" value={itemType} onChange={withPageReset(setItemType)}>
            <option value="">All types</option>
            {options.itemTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </FilterSelect>
        </div>
        <DataTable caption="Item master" columns={columns} rows={data?.items || []} getRowId={(item) => item._id} loading={loading} error={error} sort={sort} onSortChange={withPageReset(setSort)} emptyTitle="No items match these filters" />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
      </Card>

      {formOpen && canEdit && (
        <ItemForm
          key={editing?._id || "new"}
          open={formOpen}
          item={editing}
          options={options}
          onClose={() => setFormOpen(false)}
          onSaved={(saved) => {
            setFormOpen(false);
            setMessage(`Item ${saved.itemCode} ${editing ? "updated" : "created"}.`);
            if (viewing?._id === saved._id) setViewing(saved);
            reload();
            filters.reload();
          }}
        />
      )}

      {viewing && (
        <ItemDetails
          key={viewing._id}
          open={Boolean(viewing)}
          item={viewing}
          canEdit={canEdit}
          onClose={() => setViewing(null)}
          onChanged={(changed) => { setViewing(changed); reload(); }}
          onEdit={() => { setEditing(viewing); setFormOpen(true); }}
        />
      )}

      {importOpen && canEdit && <ImportDialog onClose={() => setImportOpen(false)} onImported={() => { reload(); filters.reload(); }} />}
    </>
  );
}

function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  const submit = async () => {
    if (!file) {
      setError("Choose an .xlsx file to import");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setError("Only .xlsx files are allowed");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("The file must be 5 MB or smaller");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      setResult(await api.upload<ImportResult>("/items/import", formData));
      onImported();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Import items from Excel"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{result ? "Close" : "Cancel"}</Button>
          {!result && <Button onClick={() => void submit()} disabled={uploading}>{uploading ? "Importing..." : "Import"}</Button>}
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-slate-600">
          Upload an .xlsx file (max 5 MB). The importer reads the sheet named <strong>Sheet2</strong>, or the first sheet, using these column headers:
          <span className="mt-1 block font-mono text-xs text-slate-700">Item No., Item Description, UoM Group, Item Type, Item Group, BOM Type, Active</span>
        </p>
        <p className="text-slate-600">Existing item codes are updated; rows without an item number or description are skipped.</p>
        {error && <Notice>{error}</Notice>}
        {result ? (
          <Notice type="success">
            Import complete: {result.imported} created, {result.updated} updated, {result.skipped} skipped ({result.total} rows).
          </Notice>
        ) : (
          <div>
            <label htmlFor="import-file" className="block text-sm font-medium text-slate-700">Excel file</label>
            <input
              ref={fileInput}
              id="import-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              className="mt-1 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-blue-700"
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

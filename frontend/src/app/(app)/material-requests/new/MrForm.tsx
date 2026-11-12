"use client";

import { canPermission } from "@/lib/roles";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { api, buildQuery, errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { Item, ItemAvailability, MaterialRequest, Paged } from "@/lib/types";
import { useSession } from "@/components/layout/SessionProvider";
import { ItemPicker } from "@/components/Pickers";
import { ItemThumb, StockStatusBadge } from "@/components/ItemThumb";
import { Card, Loading, Notice, PageHeader } from "@/components/ui/Feedback";
import { Input, Textarea } from "@/components/ui/Field";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

type ItemOption = Pick<Item, "_id" | "itemCode" | "description" | "uom" | "itemGroup">;
type Line = { key: number; item: ItemOption | null; requestedQuantity: string; remarks: string };

let nextKey = 1;
const emptyLine = (): Line => ({ key: nextKey++, item: null, requestedQuantity: "", remarks: "" });

function linesFrom(mr: MaterialRequest): Line[] {
  return mr.items.map((line) => ({
    key: nextKey++,
    item: { _id: line.item, itemCode: line.itemCode, description: line.description, uom: line.uom },
    requestedQuantity: String(line.requestedQuantity),
    remarks: line.remarks,
  }));
}

function Editor({ existing, prefill }: { existing: MaterialRequest | null; prefill?: Line[] }) {
  const router = useRouter();
  const { user } = useSession();
  const [department, setDepartment] = useState(existing?.department || "Engineering");
  const [workOrderNumber, setWorkOrderNumber] = useState(existing?.workOrderNumber || "");
  const [remarks, setRemarks] = useState(existing?.remarks || "");
  const [lines, setLines] = useState<Line[]>(existing ? linesFrom(existing) : prefill?.length ? prefill : [emptyLine()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Live stock for the chosen items. A request may exceed stock; the store re-checks when issuing.
  const selectedIds = [...new Set(lines.map((line) => line.item?._id).filter(Boolean))].join(",");
  const stock = useApi<Paged<"items", ItemAvailability>>(selectedIds ? `/items/availability${buildQuery({ ids: selectedIds, limit: 100 })}` : null);
  const stockById = new Map((stock.data?.items || []).map((item) => [item._id, item]));

  const deleteDraft = async () => {
    if (!existing || !window.confirm(`Delete draft ${existing.mrNumber}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.delete(`/material-requests/${existing._id}`);
      router.push("/material-requests");
    } catch (error) {
      setSubmitError(errorMessage(error));
      setDeleting(false);
    }
  };

  const updateLine = (key: number, change: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...change } : line)));

  const validate = () => {
    const found: Record<string, string> = {};
    if (!department.trim()) found.department = "Department is required";
    const filled = lines.filter((line) => line.item || line.requestedQuantity);
    if (!filled.length) found.lines = "Add at least one item";
    const seen = new Set<string>();
    for (const line of filled) {
      if (!line.item) found[`item-${line.key}`] = "Select an item";
      else if (seen.has(line.item._id)) found[`item-${line.key}`] = "This item is already on the request";
      else seen.add(line.item._id);
      const quantity = Number(line.requestedQuantity);
      if (!line.requestedQuantity || !Number.isFinite(quantity) || quantity <= 0) found[`qty-${line.key}`] = "Enter a quantity greater than zero";
    }
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const save = async (submit: boolean) => {
    setSaving(true);
    setSubmitError("");
    const body = {
      department: department.trim(),
      workOrderNumber: workOrderNumber.trim(),
      remarks: remarks.trim(),
      items: lines.filter((line) => line.item).map((line) => ({ item: line.item?._id, requestedQuantity: Number(line.requestedQuantity), remarks: line.remarks.trim() })),
    };
    try {
      let id = existing?._id;
      if (existing) {
        await api.put(`/material-requests/${existing._id}`, body);
        if (submit) await api.post(`/material-requests/${existing._id}/submit`);
      } else {
        const result = await api.post<{ materialRequest: MaterialRequest }>("/material-requests", { ...body, submit });
        id = result.materialRequest._id;
      }
      router.push(`/material-requests/view?id=${id}`);
    } catch (error) {
      setSubmitError(errorMessage(error));
      setSaving(false);
      setConfirming(false);
    }
  };

  if (!canPermission(user, "materialRequests.create")) return <Notice>Your role cannot create material requests.</Notice>;

  return (
    <>
      <PageHeader title={existing ? `Edit ${existing.mrNumber}` : "New material request"} description="Items, units, and descriptions come from the item master. The request goes to an Engineering Executive or Manager once you submit it." />
      {submitError && <Notice>{submitError}</Notice>}

      <Card title="Request details">
        <div className="grid gap-4 md:grid-cols-3">
          <Input label="Department" required value={department} onChange={(event) => setDepartment(event.target.value)} error={errors.department} maxLength={120} />
          <Input label="Work order number" value={workOrderNumber} onChange={(event) => setWorkOrderNumber(event.target.value)} maxLength={60} />
          <Input label="Requested by" value={existing?.requestedByName || user?.fullName || ""} disabled />
          <Textarea label="Request remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} maxLength={1000} wrapperClassName="md:col-span-3" placeholder="Purpose, job location, urgency..." />
        </div>
      </Card>

      <Card title="Items" actions={<Button variant="secondary" size="sm" onClick={() => setLines((current) => [...current, emptyLine()])} disabled={lines.length >= 50}><Plus size={14} /> Add item</Button>}>
        {errors.lines && <div className="mb-3"><Notice>{errors.lines}</Notice></div>}
        <div className="space-y-3">
          {lines.map((line, index) => (
            <div key={line.key} className="grid gap-3 rounded-lg border border-slate-200 p-3 md:grid-cols-[2rem_minmax(0,2fr)_10rem_minmax(0,1fr)_2.5rem] md:items-start">
              <span className="pt-8 text-sm font-medium text-slate-400 max-md:hidden">{index + 1}</span>
              <div>
                <ItemPicker label="Part number / item" required value={line.item} onChange={(item) => updateLine(line.key, { item })} error={errors[`item-${line.key}`]} />
                {line.item && (() => {
                  const available = stockById.get(line.item._id);
                  if (!available) return null;
                  const short = Number(line.requestedQuantity) > available.availableQuantity;
                  return (
                    <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                      <ItemThumb image={available.image} alt={available.itemCode} size={36} />
                      <span>Available {formatNumber(available.availableQuantity)} {available.uom}</span>
                      <StockStatusBadge status={available.stockStatus} />
                      {short && <span className="font-medium text-amber-700">Requested quantity is more than current stock; the store may issue it partially.</span>}
                    </div>
                  );
                })()}
              </div>
              <Input label={`Quantity${line.item?.uom ? ` (${line.item.uom})` : ""}`} type="number" min={0} step="any" required value={line.requestedQuantity} onChange={(event) => updateLine(line.key, { requestedQuantity: event.target.value })} error={errors[`qty-${line.key}`]} />
              <Input label="Item remarks" value={line.remarks} onChange={(event) => updateLine(line.key, { remarks: event.target.value })} maxLength={500} />
              <button
                type="button"
                onClick={() => setLines((current) => (current.length > 1 ? current.filter((entry) => entry.key !== line.key) : [emptyLine()]))}
                aria-label={`Remove line ${index + 1}`}
                className="mt-7 rounded-lg p-2 text-red-600 hover:bg-red-50"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Link href={existing ? `/material-requests/view?id=${existing._id}` : "/material-requests"} className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</Link>
        {existing && <Button variant="danger" disabled={saving || deleting} onClick={() => void deleteDraft()}><Trash2 size={16} /> Delete draft</Button>}
        <Link href="/material-requests/availability" className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">Check availability</Link>
        <Button variant="secondary" disabled={saving} onClick={() => validate() && void save(false)}>Save draft</Button>
        <Button disabled={saving} onClick={() => validate() && setConfirming(true)}>Submit for approval</Button>
      </div>

      {confirming && (
        <Modal
          open
          onClose={() => !saving && setConfirming(false)}
          title="Submit for approval?"
          footer={<><Button variant="secondary" onClick={() => setConfirming(false)} disabled={saving}>Back</Button><Button onClick={() => void save(true)} disabled={saving}>{saving ? "Submitting..." : "Submit"}</Button></>}
        >
          <p className="text-sm text-slate-600">After submitting you can no longer edit this request. It will be sent to an Engineering Executive or Engineering Manager.</p>
          <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
            {lines.filter((line) => line.item).map((line) => (
              <li key={line.key} className="flex justify-between gap-3 px-3 py-2">
                <span><span className="font-medium">{line.item?.itemCode}</span> {line.item?.description}</span>
                <span className="whitespace-nowrap">{formatNumber(Number(line.requestedQuantity))} {line.item?.uom}</span>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}

// "id:qty,id:qty" from the availability screen's request list.
function parsePrefill(value: string | null) {
  return (value || "").split(",").map((entry) => entry.split(":")).filter(([id, qty]) => /^[a-f0-9]{24}$/.test(id) && Number(qty) > 0).slice(0, 50);
}

export default function MrForm() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const prefill = parsePrefill(searchParams.get("items"));
  const prefillIds = prefill.map(([itemId]) => itemId).join(",");
  const { data, error, loading } = useApi<{ materialRequest: MaterialRequest }>(id ? `/material-requests/${id}` : null);
  const prefillItems = useApi<Paged<"items", ItemAvailability>>(!id && prefillIds ? `/items/availability${buildQuery({ ids: prefillIds, limit: 100 })}` : null);
  if (!id && prefillIds) {
    if (prefillItems.error) return <Notice>{prefillItems.error}</Notice>;
    if (!prefillItems.data) return <Loading />;
    const lines = prefill.flatMap(([itemId, qty]) => {
      const item = prefillItems.data?.items.find((entry) => entry._id === itemId);
      return item ? [{ key: nextKey++, item: { _id: item._id, itemCode: item.itemCode, description: item.description, uom: item.uom, itemGroup: item.itemGroup }, requestedQuantity: qty, remarks: "" }] : [];
    });
    return <Editor key={prefillIds} existing={null} prefill={lines} />;
  }
  if (!id) return <Editor existing={null} />;
  if (error) return <Notice>{error}</Notice>;
  if (loading || !data) return <Loading />;
  if (data.materialRequest.status !== "DRAFT") return <Notice type="warning">Only draft requests can be edited. <Link href={`/material-requests/view?id=${id}`} className="font-medium underline">Open the request</Link></Notice>;
  return <Editor key={id} existing={data.materialRequest} />;
}

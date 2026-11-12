"use client";

import { canPermission } from "@/lib/roles";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ImagePlus, Plus, Search, Trash2 } from "lucide-react";
import { api, buildQuery, errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { Item, NewItemRequest } from "@/lib/types";
import { useSession } from "@/components/layout/SessionProvider";
import { ItemThumb } from "@/components/ItemThumb";
import { Card, Loading, Notice, PageHeader } from "@/components/ui/Feedback";
import { Input, Select, Textarea } from "@/components/ui/Field";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

type Line = { key: number; _id?: string; itemName: string; description: string; specification: string; quantity: string; unit: string; remarks: string; referenceImage: string | null };
type Similar = Pick<Item, "_id" | "itemCode" | "description" | "uom" | "image">;

let nextKey = 1;
const emptyLine = (itemName = ""): Line => ({ key: nextKey++, itemName, description: "", specification: "", quantity: "", unit: "Pieces", remarks: "", referenceImage: null });
const linesFrom = (request: NewItemRequest): Line[] => request.items.map((line) => ({ ...line, key: nextKey++, quantity: String(line.quantity) }));

function Editor({ existing, initialName }: { existing: NewItemRequest | null; initialName: string }) {
  const router = useRouter();
  const { user } = useSession();
  const [request, setRequest] = useState<NewItemRequest | null>(existing);
  const [department, setDepartment] = useState(existing?.department || "Engineering");
  const [projectName, setProjectName] = useState(existing?.projectName || "");
  const [workOrderNumber, setWorkOrderNumber] = useState(existing?.workOrderNumber || "");
  const [priority, setPriority] = useState<NewItemRequest["priority"]>(existing?.priority || "Normal");
  const [justification, setJustification] = useState(existing?.justification || "");
  const [remarks, setRemarks] = useState(existing?.remarks || "");
  const [lines, setLines] = useState<Line[]>(existing ? linesFrom(existing) : [emptyLine(initialName)]);
  const [similar, setSimilar] = useState<Record<number, Similar[] | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({});

  const updateLine = (key: number, change: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...change } : line)));

  const checkSimilar = async (line: Line) => {
    const q = `${line.itemName} ${line.description}`.trim();
    if (q.length < 3) return;
    try {
      const result = await api.get<{ items: Similar[] }>(`/new-item-requests/similar-items${buildQuery({ q })}`);
      setSimilar((current) => ({ ...current, [line.key]: result.items }));
    } catch {
      setSimilar((current) => ({ ...current, [line.key]: null }));
    }
  };

  const validate = (forSubmit: boolean) => {
    const found: Record<string, string> = {};
    if (!department.trim()) found.department = "Department is required";
    if (forSubmit && !justification.trim()) found.justification = "Explain why this item is needed";
    if (forSubmit && !lines.some((line) => line.itemName.trim())) found.lines = "Add at least one item";
    for (const line of lines) {
      if (!line.itemName.trim() && !line.quantity) continue;
      if (!line.itemName.trim()) found[`name-${line.key}`] = "Item name is required";
      if (!line.unit.trim()) found[`unit-${line.key}`] = "Unit is required";
      const quantity = Number(line.quantity);
      if (!line.quantity || !Number.isFinite(quantity) || quantity <= 0) found[`qty-${line.key}`] = "Enter a quantity greater than zero";
    }
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const body = () => ({
    department: department.trim(),
    projectName: projectName.trim(),
    workOrderNumber: workOrderNumber.trim(),
    priority,
    justification: justification.trim(),
    remarks: remarks.trim(),
    items: lines.filter((line) => line.itemName.trim()).map((line) => ({ _id: line._id, itemName: line.itemName, description: line.description, specification: line.specification, quantity: Number(line.quantity), unit: line.unit, remarks: line.remarks })),
  });

  const applySaved = (saved: NewItemRequest) => {
    setRequest(saved);
    setLines(linesFrom(saved).length ? linesFrom(saved) : [emptyLine()]);
  };

  const saveDraft = async () => {
    if (!validate(false)) return null;
    setSaving(true);
    setError("");
    try {
      const result = request
        ? await api.put<{ request: NewItemRequest }>(`/new-item-requests/${request._id}`, body())
        : await api.post<{ request: NewItemRequest }>("/new-item-requests", body());
      applySaved(result.request);
      setMessage(`Draft ${result.request.requestNumber} saved. You can now add reference images.`);
      return result.request;
    } catch (reason) {
      setError(errorMessage(reason));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const saved = request
        ? (await api.put<{ request: NewItemRequest }>(`/new-item-requests/${request._id}`, body())).request
        : (await api.post<{ request: NewItemRequest }>("/new-item-requests", body())).request;
      await api.post(`/new-item-requests/${saved._id}/submit`);
      router.push(`/new-item-requests/view?id=${saved._id}`);
    } catch (reason) {
      setError(errorMessage(reason));
      setSaving(false);
      setConfirming(false);
    }
  };

  const uploadImage = async (line: Line, file: File) => {
    if (!request || !line._id) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError("Reference images must be JPEG, PNG, or WebP and 5 MB or smaller");
      return;
    }
    setError("");
    try {
      const form = new FormData();
      form.append("image", file);
      const result = await api.upload<{ request: NewItemRequest }>(`/new-item-requests/${request._id}/items/${line._id}/image`, form);
      const savedLine = result.request.items.find((entry) => entry._id === line._id);
      updateLine(line.key, { referenceImage: savedLine?.referenceImage || null });
      setRequest(result.request);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const removeImage = async (line: Line) => {
    if (!request || !line._id) return;
    try {
      await api.delete(`/new-item-requests/${request._id}/items/${line._id}/image`);
      updateLine(line.key, { referenceImage: null });
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const deleteDraft = async () => {
    if (!request || !window.confirm(`Delete draft ${request.requestNumber}?`)) return;
    try {
      await api.delete(`/new-item-requests/${request._id}`);
      router.push("/new-item-requests");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  if (!canPermission(user, "newItemRequests.create")) return <Notice>Your role cannot create new item requests.</Notice>;

  return (
    <>
      <PageHeader title={request ? `Edit ${request.requestNumber}` : "New item request"} description="For materials that are not in the warehouse Item Master. The request goes to the Engineering Executive. Nothing is added to stock or ordered automatically." />
      {message && <Notice type="success">{message}</Notice>}
      {error && <Notice>{error}</Notice>}

      <Card title="Request details">
        <div className="grid gap-4 md:grid-cols-3">
          <Input label="Department" required value={department} onChange={(event) => setDepartment(event.target.value)} error={errors.department} maxLength={120} />
          <Input label="Project name" value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={200} />
          <Input label="Work order number" value={workOrderNumber} onChange={(event) => setWorkOrderNumber(event.target.value)} maxLength={60} />
          <Input label="Requested by" value={request?.requestedByName || user?.fullName || ""} disabled />
          <Select label="Priority" value={priority} onChange={(event) => setPriority(event.target.value as NewItemRequest["priority"])}>
            {["Low", "Normal", "High", "Urgent"].map((option) => <option key={option} value={option}>{option}</option>)}
          </Select>
          <div className="hidden md:block" />
          <Textarea label="Purpose / justification" required value={justification} onChange={(event) => setJustification(event.target.value)} error={errors.justification} maxLength={2000} wrapperClassName="md:col-span-2" placeholder="Why is this material needed and why can an existing stock item not be used?" />
          <Textarea label="Remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} maxLength={1000} />
        </div>
      </Card>

      <Card title="Requested items" actions={<Button variant="secondary" size="sm" onClick={() => setLines((current) => [...current, emptyLine()])} disabled={lines.length >= 50}><Plus size={14} /> Add item</Button>}>
        {errors.lines && <div className="mb-3"><Notice>{errors.lines}</Notice></div>}
        <div className="space-y-4">
          {lines.map((line, index) => (
            <section key={line.key} className="rounded-lg border border-slate-200 p-4" aria-label={`Item ${index + 1}`}>
              <div className="grid gap-3 md:grid-cols-4">
                <Input label="Item name" required value={line.itemName} onChange={(event) => updateLine(line.key, { itemName: event.target.value })} onBlur={() => void checkSimilar(line)} error={errors[`name-${line.key}`]} wrapperClassName="md:col-span-2" maxLength={200} />
                <Input label="Quantity" type="number" min={0} step="any" required value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} error={errors[`qty-${line.key}`]} />
                <Input label="Unit" required value={line.unit} onChange={(event) => updateLine(line.key, { unit: event.target.value })} error={errors[`unit-${line.key}`]} maxLength={40} />
                <Textarea label="Description" value={line.description} onChange={(event) => updateLine(line.key, { description: event.target.value })} onBlur={() => void checkSimilar(line)} maxLength={1000} wrapperClassName="md:col-span-2" />
                <Textarea label="Technical specification" value={line.specification} onChange={(event) => updateLine(line.key, { specification: event.target.value })} maxLength={2000} wrapperClassName="md:col-span-2" placeholder="Model, rating, size, material, standard..." />
                <Input label="Item remarks" value={line.remarks} onChange={(event) => updateLine(line.key, { remarks: event.target.value })} maxLength={500} wrapperClassName="md:col-span-3" />
                <div className="flex items-end justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => void checkSimilar(line)} disabled={!line.itemName.trim()}><Search size={14} /> Check Item Master</Button>
                  <button type="button" onClick={() => setLines((current) => (current.length > 1 ? current.filter((entry) => entry.key !== line.key) : [emptyLine()]))} aria-label={`Remove item ${index + 1}`} className="rounded-lg p-2 text-red-600 hover:bg-red-50"><Trash2 size={16} /></button>
                </div>
              </div>

              {similar[line.key] && (similar[line.key]?.length ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                  <p className="font-medium text-amber-900">Possible existing items — check these before requesting a new one:</p>
                  <ul className="mt-2 space-y-1.5">
                    {similar[line.key]?.map((item) => (
                      <li key={item._id} className="flex items-center gap-2">
                        <ItemThumb image={item.image} alt={item.itemCode} size={28} />
                        <span><span className="font-medium">{item.itemCode}</span> {item.description} <span className="text-xs text-slate-500">({item.uom})</span></span>
                      </li>
                    ))}
                  </ul>
                  <Link href="/material-requests/availability" className="mt-2 inline-block text-sm font-medium text-blue-700 underline">Request an existing item instead</Link>
                </div>
              ) : (
                <p className="mt-3 text-sm text-emerald-700">No similar item found in the Item Master.</p>
              ))}

              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-sm">
                <ItemThumb image={line.referenceImage} alt={`${line.itemName} reference`} size={56} />
                {line._id ? (
                  <>
                    <input ref={(element) => { fileInputs.current[line.key] = element; }} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label={`Reference image for ${line.itemName || `item ${index + 1}`}`} onChange={(event) => event.target.files?.[0] && void uploadImage(line, event.target.files[0])} />
                    <Button variant="secondary" size="sm" onClick={() => fileInputs.current[line.key]?.click()}><ImagePlus size={14} /> {line.referenceImage ? "Replace" : "Add"} reference image</Button>
                    {line.referenceImage && <Button variant="ghost" size="sm" onClick={() => void removeImage(line)}>Remove image</Button>}
                  </>
                ) : (
                  <span className="text-slate-500">Save the draft to add a reference image (optional, JPEG/PNG/WebP up to 5 MB).</span>
                )}
              </div>
            </section>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Link href="/new-item-requests" className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</Link>
        {request && <Button variant="danger" onClick={() => void deleteDraft()} disabled={saving}><Trash2 size={16} /> Delete draft</Button>}
        <Button variant="secondary" disabled={saving} onClick={() => void saveDraft()}>{saving ? "Saving..." : "Save draft"}</Button>
        <Button disabled={saving} onClick={() => validate(true) && setConfirming(true)}>Submit to Engineering Executive</Button>
      </div>

      {confirming && (
        <Modal
          open
          onClose={() => !saving && setConfirming(false)}
          title="Submit new item request?"
          footer={<><Button variant="secondary" onClick={() => setConfirming(false)} disabled={saving}>Back</Button><Button onClick={() => void submit()} disabled={saving}>{saving ? "Submitting..." : "Submit"}</Button></>}
        >
          <p className="text-sm text-slate-600">The request becomes read-only and goes to the Engineering Executive for review.</p>
          <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
            {lines.filter((line) => line.itemName.trim()).map((line) => (
              <li key={line.key} className="flex justify-between gap-3 px-3 py-2"><span className="font-medium">{line.itemName}</span><span>{formatNumber(Number(line.quantity))} {line.unit}</span></li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}

export default function NirForm() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const { data, error, loading } = useApi<{ request: NewItemRequest }>(id ? `/new-item-requests/${id}` : null);
  if (!id) return <Editor existing={null} initialName={searchParams.get("name") || ""} />;
  if (error) return <Notice>{error}</Notice>;
  if (loading || !data) return <Loading />;
  if (data.request.status !== "DRAFT") return <Notice type="warning">This request was submitted and is read-only. <Link href={`/new-item-requests/view?id=${id}`} className="font-medium underline">Open it</Link></Notice>;
  return <Editor key={id} existing={data.request} initialName="" />;
}

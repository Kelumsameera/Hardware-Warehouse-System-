"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FileText, Pencil, Send, Trash2 } from "lucide-react";
import { canPermission } from "@/lib/roles";
import { api, errorMessage } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { NewItemRequest } from "@/lib/types";
import { useSession } from "@/components/layout/SessionProvider";
import { ItemThumb } from "@/components/ItemThumb";
import { Card, Loading, Notice } from "@/components/ui/Feedback";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { NirStatusBadge, PriorityBadge } from "../nirShared";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-sm font-medium text-slate-900">{value || "—"}</dd>
    </div>
  );
}

export default function NirDetails() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const { user } = useSession();
  const { data, error, loading } = useApi<{ request: NewItemRequest }>(id ? `/new-item-requests/${id}` : null);
  const [updated, setUpdated] = useState<NewItemRequest | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!id) return <Notice>No request selected.</Notice>;
  if (error) return <Notice>{error}</Notice>;
  const request = updated || data?.request;
  if (loading && !request) return <Loading />;
  if (!request) return null;
  const isOwnerDraft = request.requestedBy === user?.id && request.status === "DRAFT" && canPermission(user, "newItemRequests.create");

  const submit = async () => {
    setBusy(true);
    setActionError("");
    try {
      const result = await api.post<{ request: NewItemRequest }>(`/new-item-requests/${request._id}/submit`);
      setUpdated(result.request);
      setConfirming(false);
    } catch (reason) {
      setActionError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete draft ${request.requestNumber}?`)) return;
    try {
      await api.delete(`/new-item-requests/${request._id}`);
      router.push("/new-item-requests");
    } catch (reason) {
      setActionError(errorMessage(reason));
    }
  };

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/new-item-requests" className="text-sm text-blue-600 hover:underline">← New item requests</Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-bold text-slate-900">{request.requestNumber} <NirStatusBadge status={request.status} /></h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {isOwnerDraft && <Button variant="danger" onClick={() => void remove()}><Trash2 size={16} /> Delete draft</Button>}
          {isOwnerDraft && <Link href={`/new-item-requests/edit?id=${request._id}`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"><Pencil size={16} /> Edit</Link>}
          {isOwnerDraft && <Button onClick={() => setConfirming(true)}><Send size={16} /> Submit</Button>}
          <Link href={`/documents/new-item-request?id=${request._id}`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"><FileText size={16} /> Document / Print</Link>
        </div>
      </div>

      {actionError && <Notice>{actionError}</Notice>}
      {request.status === "PENDING_EXECUTIVE_REVIEW" && <Notice type="info">Submitted {formatDate(request.submittedAt)} and waiting for Engineering Executive review. No stock, Item Master, or purchasing changes are made by this request.</Notice>}

      <Card>
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Department" value={request.department} />
          <Field label="Requested by" value={request.requestedByName} />
          <Field label="Request date" value={formatDate(request.requestDate)} />
          <Field label="Priority" value={<PriorityBadge priority={request.priority} />} />
          <Field label="Project name" value={request.projectName} />
          <Field label="Work order number" value={request.workOrderNumber} />
          <div className="col-span-2"><Field label="Purpose / justification" value={request.justification} /></div>
          <div className="col-span-2 md:col-span-4"><Field label="Remarks" value={request.remarks} /></div>
        </dl>
      </Card>

      <Card title={`Requested items (${request.items.length})`}>
        <ul className="space-y-4">
          {request.items.map((line, index) => (
            <li key={line._id} className="flex flex-col gap-4 rounded-lg border border-slate-200 p-4 sm:flex-row">
              <ItemThumb image={line.referenceImage} alt={`${line.itemName} reference`} size={120} />
              <dl className="grid flex-1 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2"><Field label={`Item ${index + 1}`} value={line.itemName} /></div>
                <Field label="Quantity" value={`${formatNumber(line.quantity)} ${line.unit}`} />
                <div className="sm:col-span-3"><Field label="Description" value={line.description} /></div>
                <div className="sm:col-span-3"><Field label="Technical specification" value={line.specification} /></div>
                <div className="sm:col-span-3"><Field label="Remarks" value={line.remarks} /></div>
              </dl>
            </li>
          ))}
        </ul>
      </Card>

      {confirming && (
        <Modal open onClose={() => !busy && setConfirming(false)} title="Submit new item request?" footer={<><Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>Back</Button><Button onClick={() => void submit()} disabled={busy}>{busy ? "Submitting..." : "Submit"}</Button></>}>
          {actionError && <Notice>{actionError}</Notice>}
          <p className="text-sm text-slate-600">The request becomes read-only and goes to the Engineering Executive.</p>
        </Modal>
      )}
    </>
  );
}

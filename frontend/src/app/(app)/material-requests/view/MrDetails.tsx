"use client";

import { canPermission } from "@/lib/roles";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, FileText, Pause, Pencil, Play, Send, Trash2, XCircle } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { MaterialRequest, MrAudit, MrIssue } from "@/lib/types";
import { useSession } from "@/components/layout/SessionProvider";
import { ItemThumb } from "@/components/ItemThumb";
import { Card, EmptyState, Loading, Notice } from "@/components/ui/Feedback";
import { Textarea } from "@/components/ui/Field";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { MR_STATUS_LABELS, MrStatusBadge } from "../mrStatus";
import IssuePanel from "./IssuePanel";

type Action = "submit" | "approve" | "reject" | "hold" | "resume" | "receive";

const HOLD_REASONS = ["Insufficient Stock", "Item Not Located", "Awaiting Stock Replenishment", "Item Verification Required", "Other"];

const ACTION_TITLES: Record<Action, string> = {
  submit: "Submit for approval",
  approve: "Approve material request",
  reject: "Reject material request",
  hold: "Place request on hold",
  resume: "Resume request",
  receive: "Confirm received materials",
};

const AUDIT_LABELS: Record<string, string> = {
  created: "Created",
  updated: "Draft edited",
  submitted: "Submitted for approval",
  approved: "Approved",
  rejected: "Rejected",
  issued_full: "Issued (full)",
  issued_partial: "Issued (partial)",
  held: "Placed on hold",
  resumed: "Resumed",
  received: "Receipt confirmed",
  deleted: "Draft deleted",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-900">{value || "—"}</dd>
    </div>
  );
}

function ActionDialog({ mr, action, onClose, onDone }: { mr: MaterialRequest; action: Action; onClose: () => void; onDone: (mr: MaterialRequest, message: string) => void }) {
  const [remarks, setRemarks] = useState("");
  const [received, setReceived] = useState<Record<string, string>>(() => Object.fromEntries(mr.items.map((line) => [line._id, String(line.pendingReceiptQuantity)])));
  const [holdReason, setHoldReason] = useState(HOLD_REASONS[0]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const needsReason = action === "reject" || action === "hold";

  const submit = async () => {
    if (action === "reject" && !remarks.trim()) return setError("Enter the reason for rejecting");
    if (action === "hold" && holdReason === "Other" && !remarks.trim()) return setError("Describe the reason for the hold");
    let body: Record<string, unknown> = { remarks: remarks.trim() };
    if (action === "hold") body = { reason: holdReason === "Other" ? remarks.trim() : [holdReason, remarks.trim()].filter(Boolean).join(" – ") };
    if (action === "receive") {
      const open = mr.items.filter((line) => line.pendingReceiptQuantity > 0);
      const items = open.map((line) => ({ line: line._id, receivedQuantity: Number(received[line._id] || 0) }));
      const bad = open.find((line, index) => !Number.isFinite(items[index].receivedQuantity) || items[index].receivedQuantity < 0 || items[index].receivedQuantity > line.pendingReceiptQuantity);
      if (bad) return setError(`${bad.itemCode}: enter between 0 and ${formatNumber(bad.pendingReceiptQuantity)}`);
      if (!items.some((item) => item.receivedQuantity > 0)) return setError("Enter at least one received quantity");
      body = { items, remarks: remarks.trim() };
    }
    setSaving(true);
    setError("");
    try {
      const result = await api.post<{ materialRequest: MaterialRequest; message: string }>(`/material-requests/${mr._id}/${action}`, action === "submit" ? undefined : body);
      onDone(result.materialRequest, result.message);
    } catch (reason) {
      setError(errorMessage(reason));
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={() => !saving && onClose()}
      title={ACTION_TITLES[action]}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant={action === "reject" ? "danger" : "primary"} onClick={() => void submit()} disabled={saving}>{saving ? "Saving..." : "Confirm"}</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {error && <Notice>{error}</Notice>}
        {action === "approve" && <p className="text-slate-600">Approving releases {mr.mrNumber} to the store for issue. No stock is deducted until the Store Keeper issues it.</p>}
        {action === "reject" && <p className="text-slate-600">The requester will see your reason. A rejected request cannot be issued.</p>}
        {action === "hold" && <p className="text-slate-600">No stock changes. Quantities already issued are kept and the request can be resumed later.</p>}
        {action === "submit" && <p className="text-slate-600">After submitting you can no longer edit this request.</p>}
        {action === "receive" && (
          <table className="min-w-full text-sm">
            <caption className="sr-only">Received quantities</caption>
            <thead className="text-xs uppercase text-slate-500"><tr><th scope="col" className="py-1 text-left">Item</th><th scope="col" className="py-1 text-right">Issued</th><th scope="col" className="py-1 text-right">Already received</th><th scope="col" className="w-32 py-1 text-right">Received now</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {mr.items.filter((line) => line.pendingReceiptQuantity > 0).map((line) => (
                <tr key={line._id}>
                  <td className="py-2"><span className="font-medium">{line.itemCode}</span> <span className="text-slate-500">{line.description}</span></td>
                  <td className="py-2 text-right">{formatNumber(line.issuedQuantity)} {line.uom}</td>
                  <td className="py-2 text-right">{formatNumber(line.receivedQuantity)}</td>
                  <td className="py-1.5 text-right">
                    <input type="number" min={0} step="any" max={line.pendingReceiptQuantity} aria-label={`Received quantity of ${line.itemCode}`} value={received[line._id]} onChange={(event) => setReceived((current) => ({ ...current, [line._id]: event.target.value }))} className="h-9 w-28 rounded-lg border border-slate-300 px-2 text-right" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {action === "hold" && (
          <div>
            <label htmlFor="hold-reason" className="block text-sm font-medium text-slate-700">Hold reason<span className="ml-0.5 text-red-600" aria-hidden="true">*</span></label>
            <select id="hold-reason" value={holdReason} onChange={(event) => setHoldReason(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
              {HOLD_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
            </select>
          </div>
        )}
        {action === "receive" && <p className="text-slate-500">Confirm only what you physically received. You can confirm the rest later.</p>}
        {action !== "submit" && (
          <Textarea label={action === "hold" ? (holdReason === "Other" ? "Details (required)" : "Details") : needsReason ? "Reason" : "Remarks"} required={action === "reject" || (action === "hold" && holdReason === "Other")} value={remarks} onChange={(event) => setRemarks(event.target.value)} maxLength={1000} />
        )}
      </div>
    </Modal>
  );
}

function History({ mr }: { mr: MaterialRequest }) {
  const issues = useApi<{ issues: MrIssue[] }>(`/material-requests/${mr._id}/issues?_v=${mr.updatedAt}`);
  const audit = useApi<{ audit: MrAudit[] }>(`/material-requests/${mr._id}/audit?_v=${mr.updatedAt}`);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title="Issue history">
        {issues.loading && !issues.data ? <Loading /> : issues.error ? <Notice>{issues.error}</Notice> : !issues.data?.issues.length ? <EmptyState title="Nothing issued yet" /> : (
          <ol className="space-y-3">
            {issues.data.issues.map((issue, index) => (
              <li key={issue._id} className="rounded-lg border border-slate-200 p-3 text-sm">
                <p className="font-medium text-slate-900">Issue {index + 1} · {issue.issueType === "full" ? "Full" : "Partial"} · {formatDate(issue.issuedAt)}</p>
                <p className="text-xs text-slate-500">By {issue.issuedByName}{issue.remarks ? ` — ${issue.remarks}` : ""}</p>
                <ul className="mt-2 space-y-0.5">
                  {issue.lines.map((line) => <li key={`${line.line}-${line.bin}`} className="flex justify-between"><span>{line.itemCode} from {line.binCode}</span><span>{formatNumber(line.quantity)}</span></li>)}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card title="Audit history">
        {audit.loading && !audit.data ? <Loading /> : audit.error ? <Notice>{audit.error}</Notice> : (
          <ol className="relative space-y-3 border-l border-slate-200 pl-4">
            {audit.data?.audit.map((entry) => (
              <li key={entry._id} className="text-sm">
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-blue-600" aria-hidden="true" />
                <p className="font-medium text-slate-900">{AUDIT_LABELS[entry.action] || entry.action}{entry.toStatus && entry.toStatus !== entry.fromStatus ? ` → ${MR_STATUS_LABELS[entry.toStatus as keyof typeof MR_STATUS_LABELS] || entry.toStatus}` : ""}</p>
                <p className="text-xs text-slate-500">{formatDate(entry.createdAt)} · {entry.userName} ({entry.role})</p>
                {entry.remarks && <p className="mt-0.5 text-slate-600">“{entry.remarks}”</p>}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

export default function MrDetails() {
  const id = useSearchParams().get("id");
  const { user } = useSession();
  const { data, error, loading } = useApi<{ materialRequest: MaterialRequest }>(id ? `/material-requests/${id}` : null);
  const [updated, setUpdated] = useState<MaterialRequest | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const router = useRouter();

  if (!id) return <Notice>No material request selected. <Link href="/material-requests" className="font-medium underline">Back to the list</Link></Notice>;
  if (error) return <Notice>{error}</Notice>;
  const mr = updated && updated._id === id ? updated : data?.materialRequest;
  if (loading && !mr) return <Loading />;
  if (!mr) return null;

  const isRequester = mr.requestedBy === user?.id;
  const canDecide = canPermission(user, "materialRequests.approve") && !isRequester && mr.status === "PENDING_APPROVAL";
  const isStore = canPermission(user, "materialRequests.issue");
  const issuable = isStore && (mr.status === "PENDING_ISSUE" || mr.status === "PARTIALLY_ISSUED");
  const canReceive = canPermission(user, "materialRequests.receive") && ["PARTIALLY_ISSUED", "ON_HOLD", "ISSUED"].includes(mr.status) && mr.items.some((line) => line.pendingReceiptQuantity > 0);
  const deleteDraft = async () => {
    if (!window.confirm(`Delete draft ${mr.mrNumber}? This cannot be undone.`)) return;
    try {
      await api.delete(`/material-requests/${mr._id}`);
      router.push("/material-requests");
    } catch (reason) {
      setMessage("");
      setActionError(errorMessage(reason));
    }
  };
  const done = (next: MaterialRequest, text: string) => {
    setUpdated(next);
    setAction(null);
    setMessage(text);
  };

  return (
    <>
      <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/material-requests" className="text-sm text-blue-600 hover:underline">← Material requests</Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-bold text-slate-900">{mr.mrNumber} <MrStatusBadge status={mr.status} /></h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {isRequester && canPermission(user, "materialRequests.create") && mr.status === "DRAFT" && <Link href={`/material-requests/new?id=${mr._id}`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"><Pencil size={16} /> Edit</Link>}
          {isRequester && canPermission(user, "materialRequests.create") && mr.status === "DRAFT" && <Button onClick={() => setAction("submit")}><Send size={16} /> Submit</Button>}
          {canDecide && <Button variant="danger" onClick={() => setAction("reject")}><XCircle size={16} /> Reject</Button>}
          {canDecide && <Button onClick={() => setAction("approve")}><CheckCircle2 size={16} /> Approve</Button>}
          {issuable && <Button variant="secondary" onClick={() => setAction("hold")}><Pause size={16} /> Hold</Button>}
          {isStore && mr.status === "ON_HOLD" && <Button onClick={() => setAction("resume")}><Play size={16} /> Resume</Button>}
          {isRequester && canPermission(user, "materialRequests.create") && mr.status === "DRAFT" && <Button variant="danger" onClick={() => void deleteDraft()}><Trash2 size={16} /> Delete draft</Button>}
          {isRequester && canReceive && <Button onClick={() => setAction("receive")}><CheckCircle2 size={16} /> Confirm received</Button>}
          <Link href={`/documents/material-request?id=${mr._id}`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"><FileText size={16} /> Document / Print</Link>
        </div>
      </div>

      {message && <div className="no-print"><Notice type="success">{message}</Notice></div>}
      {actionError && <div className="no-print"><Notice>{actionError}</Notice></div>}
      {mr.status === "PENDING_APPROVAL" && canPermission(user, "materialRequests.approve") && isRequester && <div className="no-print"><Notice type="info">You raised this request, so another Engineering Executive or Manager must approve it.</Notice></div>}
      {mr.status === "ON_HOLD" && <Notice type="warning">On hold since {formatDate(mr.hold.date)} by {mr.hold.name}: {mr.hold.remarks}</Notice>}
      {mr.status === "REJECTED" && <Notice>Rejected by {mr.approval.name} ({mr.approval.role}) on {formatDate(mr.approval.date)}: {mr.approval.remarks}</Notice>}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <div className="mb-4 hidden border-b border-slate-300 pb-3 print:block">
          <p className="text-lg font-bold">Engineering Warehouse — Material Request Form</p>
          <p className="text-sm">{mr.mrNumber} · Status: {MR_STATUS_LABELS[mr.status]}</p>
        </div>
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="MR number" value={mr.mrNumber} />
          <Field label="Department" value={mr.department} />
          <Field label="Work order number" value={mr.workOrderNumber} />
          <Field label="Request date" value={formatDate(mr.requestDate)} />
          <Field label="Requested by" value={mr.requestedByName} />
          <Field label="Submitted" value={formatDate(mr.submittedAt)} />
          <Field label="Status" value={MR_STATUS_LABELS[mr.status]} />
          <Field label="Request remarks" value={mr.remarks} />
        </dl>

        <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <caption className="sr-only">Requested items</caption>
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">#</th>
                <th scope="col" className="px-3 py-2 text-left"><span className="sr-only">Image</span></th>
                <th scope="col" className="px-3 py-2 text-left">Part number</th>
                <th scope="col" className="px-3 py-2 text-left">Item description</th>
                <th scope="col" className="px-3 py-2 text-left">UoM</th>
                <th scope="col" className="px-3 py-2 text-right">Requested</th>
                <th scope="col" className="px-3 py-2 text-right">Issued</th>
                <th scope="col" className="px-3 py-2 text-right">Remaining</th>
                <th scope="col" className="px-3 py-2 text-right">Received</th>
                <th scope="col" className="px-3 py-2 text-left">Item remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mr.items.map((line, index) => (
                <tr key={line._id}>
                  <td className="px-3 py-2 text-slate-400">{index + 1}</td>
                  <td className="px-3 py-2"><ItemThumb image={line.image} alt="" /></td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{line.itemCode}</td>
                  <td className="px-3 py-2">{line.description}</td>
                  <td className="px-3 py-2">{line.uom}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(line.requestedQuantity)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(line.issuedQuantity)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${line.remainingQuantity > 0 ? "text-amber-700" : "text-emerald-700"}`}>{formatNumber(line.remainingQuantity)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(line.receivedQuantity)}</td>
                  <td className="px-3 py-2 text-slate-600">{line.remarks || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="mt-5 grid gap-4 border-t border-slate-100 pt-4 md:grid-cols-3">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approval</p>
            <Field label="Approved / rejected by" value={mr.approval.name && `${mr.approval.name} (${mr.approval.role})`} />
            <Field label="Decision date" value={mr.approval.date ? formatDate(mr.approval.date) : ""} />
            <Field label="Approval remarks" value={mr.approval.remarks} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Store</p>
            <Field label="Fully issued on" value={mr.issuedAt ? formatDate(mr.issuedAt) : ""} />
            <Field label="Last hold" value={mr.hold.name && `${mr.hold.name}, ${formatDate(mr.hold.date)}: ${mr.hold.remarks}`} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Receiving</p>
            {mr.receipts.length === 0 ? <Field label="Received" value="" /> : mr.receipts.map((receipt) => (
              <Field key={receipt._id} label={`${receipt.name}, ${formatDate(receipt.date)}`} value={`${receipt.lines.map((line) => `${line.itemCode} × ${formatNumber(line.quantity)}`).join(", ")}${receipt.remarks ? ` — ${receipt.remarks}` : ""}`} />
            ))}
          </div>
        </dl>

        <div className="mt-10 hidden grid-cols-4 gap-6 text-xs print:grid">
          {["Requested by", "Approved by", "Issued by (Store Keeper)", "Received by"].map((label) => (
            <div key={label} className="border-t border-slate-400 pt-1">{label}</div>
          ))}
        </div>
      </section>

      {issuable && (
        <div className="no-print">
          <IssuePanel key={mr.updatedAt} mr={mr} onIssued={done} />
        </div>
      )}

      <div className="no-print">
        <History mr={mr} />
      </div>

      {action && <ActionDialog mr={mr} action={action} onClose={() => setAction(null)} onDone={done} />}
    </>
  );
}

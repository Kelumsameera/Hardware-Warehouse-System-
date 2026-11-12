"use client";

import { useSearchParams } from "next/navigation";
import { formatNumber } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { MaterialRequest, MrIssue } from "@/lib/types";
import { uploadUrl } from "@/components/ItemThumb";
import DocumentShell, { CompanyMark, formatPrintDate } from "@/components/document/DocumentShell";
import { MR_STATUS_LABELS } from "@/app/(app)/material-requests/mrStatus";

const MIN_ROWS = 10;
const cell = "border border-black px-1.5 py-1 align-top";
const head = "border border-black px-1 py-1 text-center text-[7.5pt] font-bold uppercase leading-tight";

const WATERMARKS: Partial<Record<MaterialRequest["status"], string>> = {
  DRAFT: "DRAFT",
  PENDING_APPROVAL: "NOT APPROVED",
  REJECTED: "REJECTED",
};

function SignOff({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="doc-block flex min-h-[30mm] flex-col border border-black p-2">
      <p className="font-bold">{title}</p>
      <div className="mt-1 flex-1 space-y-0.5 text-[8.5pt]">
        {lines.map((line, index) => <p key={index}>{line}</p>)}
      </div>
      <p className="mt-2 text-[8pt]">Signature ...................................</p>
    </div>
  );
}

export default function MrDocument() {
  const id = useSearchParams().get("id");
  const mr = useApi<{ materialRequest: MaterialRequest }>(id ? `/material-requests/${id}` : null);
  const issues = useApi<{ issues: MrIssue[] }>(id ? `/material-requests/${id}/issues` : null);

  if (!id) return <p className="p-8 text-center text-sm">No material request selected.</p>;
  if (issues.error) return <p role="alert" className="p-8 text-center text-sm text-red-700">{issues.error}</p>;
  if (mr.error) return <p role="alert" className="p-8 text-center text-sm text-red-700">{mr.error}</p>;
  if (!mr.data || !issues.data) return <p role="status" className="p-8 text-center text-sm text-slate-500">Loading document...</p>;

  const request = mr.data.materialRequest;
  const issueList = issues.data.issues;
  const approval = request.approval;
  const emptyRows = Math.max(0, MIN_ROWS - request.items.length);

  const approvalLines = approval.decision
    ? [`${approval.decision === "APPROVED" ? "Approved" : "Rejected"} by ${approval.name}`, approval.role, formatPrintDate(approval.date), approval.remarks ? `Remarks: ${approval.remarks}` : ""].filter(Boolean)
    : [request.status === "DRAFT" ? "Not submitted" : "Awaiting approval"];

  const storeLines = issueList.length
    ? issueList.map((issue, index) => `Issue ${index + 1}: ${issue.issuedByName}, ${formatPrintDate(issue.issuedAt)} — ${issue.lines.map((line) => `${line.itemCode} × ${formatNumber(line.quantity)}`).join(", ")}`)
    : [request.status === "ON_HOLD" ? "On hold" : "Not issued"];
  if (request.status === "ON_HOLD" && request.hold.name) storeLines.push(`On hold by ${request.hold.name}, ${formatPrintDate(request.hold.date)}: ${request.hold.remarks}`);

  const receiptLines = request.receipts.length
    ? request.receipts.map((receipt) => `${receipt.name}, ${formatPrintDate(receipt.date)} — ${receipt.lines.map((line) => `${line.itemCode} × ${formatNumber(line.quantity)}`).join(", ")}${receipt.remarks ? ` (${receipt.remarks})` : ""}`)
    : ["Not received"];

  return (
    <DocumentShell
      title={`Material Request ${request.mrNumber}`}
      backHref={`/material-requests/view?id=${request._id}`}
      watermark={WATERMARKS[request.status]}
      footer={`${request.mrNumber} · Status: ${MR_STATUS_LABELS[request.status]}`}
    >
      <div className="doc-block grid grid-cols-[1fr_auto_1fr] items-stretch gap-3">
        <CompanyMark />
        <h1 className="self-center text-center text-[15pt] font-bold tracking-wide">MATERIAL REQUEST FORM</h1>
        <table className="ml-auto self-start border-collapse text-[8.5pt]">
          <tbody>
            <tr><td colSpan={2} className="border border-black px-1.5 py-0.5 text-center font-bold">Warehouse Use</td></tr>
            <tr><td className="border border-black px-1.5 py-0.5 font-semibold">Pu001</td><td className="border border-black px-1.5 py-0.5"><span className="font-semibold">Work ORDER No.</span> {request.workOrderNumber || ""}</td></tr>
            <tr><td className="border border-black px-1.5 py-0.5 font-semibold">Rev:02</td><td className="border border-black px-1.5 py-0.5"><span className="font-semibold">Date :</span> {formatPrintDate(request.requestDate)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="doc-block mt-3 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 border-y border-black py-1.5">
        <p><span className="font-bold">Department</span> {request.department}</p>
        <p><span className="font-bold">No.</span> <span className="font-mono text-[11pt] font-bold text-red-700">{request.mrNumber}</span></p>
        <p><span className="font-bold">Requested by</span> {request.requestedByName}</p>
        <p><span className="font-bold">Status</span> {MR_STATUS_LABELS[request.status]}</p>
        {request.remarks && <p className="col-span-2"><span className="font-bold">Remarks</span> {request.remarks}</p>}
      </div>

      <table className="doc-table mt-3 w-full table-fixed border-collapse">
        <colgroup>
          <col style={{ width: "14%" }} />
          <col style={{ width: "13mm" }} />
          <col />
          <col style={{ width: "8%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "13%" }} />
        </colgroup>
        <thead>
          <tr className="text-[8pt]">
            <th className={head}>Part No.</th>
            <th className={head}>Image</th>
            <th className={head}>Description</th>
            <th className={head}>Unit</th>
            <th className={head}>Qty Requested</th>
            <th className={head}>Qty Issued</th>
            <th className={head}>Qty Remaining</th>
            <th className={head}>Remark</th>
          </tr>
        </thead>
        <tbody>
          {request.items.map((line) => (
            <tr key={line._id}>
              <td className={`${cell} break-words font-semibold`}>{line.itemCode}</td>
              <td className={`${cell} text-center`}>
                {line.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- authenticated item image
                  <img src={uploadUrl(line.image)} alt="" className="mx-auto h-[11mm] w-[11mm] object-contain" />
                ) : <span className="text-[7pt] text-slate-400">—</span>}
              </td>
              <td className={`${cell} break-words`}>{line.description}</td>
              <td className={`${cell} text-center`}>{line.uom}</td>
              <td className={`${cell} text-right`}>{formatNumber(line.requestedQuantity)}</td>
              <td className={`${cell} text-right`}>{formatNumber(line.issuedQuantity)}</td>
              <td className={`${cell} text-right`}>{formatNumber(line.remainingQuantity)}</td>
              <td className={`${cell} break-words`}>{line.remarks}</td>
            </tr>
          ))}
          {Array.from({ length: emptyRows }, (_, index) => (
            <tr key={`empty-${index}`} aria-hidden="true">
              {Array.from({ length: 8 }, (__, column) => <td key={column} className={`${cell} h-[7mm]`} />)}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <SignOff title="Approved" lines={approvalLines} />
        <SignOff title="Store Keeper" lines={storeLines} />
        <SignOff title="Received" lines={receiptLines} />
      </div>
    </DocumentShell>
  );
}

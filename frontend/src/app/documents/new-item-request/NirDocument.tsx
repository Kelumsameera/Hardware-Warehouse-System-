"use client";

import { useSearchParams } from "next/navigation";
import { formatNumber } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { NewItemRequest } from "@/lib/types";
import { uploadUrl } from "@/components/ItemThumb";
import DocumentShell, { CompanyMark, formatPrintDate } from "@/components/document/DocumentShell";
import { NIR_STATUS_LABELS } from "@/app/(app)/new-item-requests/nirShared";

const cell = "border border-black px-1.5 py-1 align-top";
const head = "border border-black px-1.5 py-1 text-center font-bold uppercase";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <th className="w-[38mm] border border-black bg-slate-100 px-1.5 py-1 text-left font-bold">{label}</th>
      <td className="border border-black px-1.5 py-1 whitespace-pre-line">{value}</td>
    </tr>
  );
}

export default function NirDocument() {
  const id = useSearchParams().get("id");
  const { data, error } = useApi<{ request: NewItemRequest }>(id ? `/new-item-requests/${id}` : null);

  if (!id) return <p className="p-8 text-center text-sm">No request selected.</p>;
  if (error) return <p role="alert" className="p-8 text-center text-sm text-red-700">{error}</p>;
  if (!data) return <p role="status" className="p-8 text-center text-sm text-slate-500">Loading document...</p>;
  const request = data.request;

  return (
    <DocumentShell
      title={`New Item Request ${request.requestNumber}`}
      backHref={`/new-item-requests/view?id=${request._id}`}
      watermark={request.status === "DRAFT" ? "DRAFT" : undefined}
      footer={`${request.requestNumber} · Status: ${NIR_STATUS_LABELS[request.status]}`}
    >
      <div className="doc-block grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <CompanyMark />
        <h1 className="text-center text-[15pt] font-bold tracking-wide">NEW ITEM REQUEST</h1>
        <p className="text-right"><span className="font-bold">No.</span> <span className="font-mono text-[11pt] font-bold text-red-700">{request.requestNumber}</span></p>
      </div>

      <table className="doc-block mt-3 w-full border-collapse">
        <tbody>
          <Row label="Department" value={request.department} />
          <Row label="Requested by" value={request.requestedByName} />
          <Row label="Date" value={formatPrintDate(request.requestDate)} />
          <Row label="Project name" value={request.projectName || "—"} />
          <Row label="Work order no." value={request.workOrderNumber || "—"} />
          <Row label="Priority" value={request.priority} />
          <Row label="Status" value={NIR_STATUS_LABELS[request.status]} />
          <Row label="Justification" value={request.justification || "—"} />
          {request.remarks && <Row label="Remarks" value={request.remarks} />}
        </tbody>
      </table>

      <table className="doc-table mt-3 w-full table-fixed border-collapse">
        <colgroup>
          <col style={{ width: "6%" }} />
          <col style={{ width: "20%" }} />
          <col />
          <col style={{ width: "22mm" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "9%" }} />
        </colgroup>
        <thead>
          <tr className="text-[8pt]">
            <th className={head}>#</th>
            <th className={head}>Item name</th>
            <th className={head}>Description / Specification</th>
            <th className={head}>Reference image</th>
            <th className={head}>Qty</th>
            <th className={head}>Unit</th>
          </tr>
        </thead>
        <tbody>
          {request.items.map((line, index) => (
            <tr key={line._id}>
              <td className={`${cell} text-center`}>{index + 1}</td>
              <td className={`${cell} break-words font-semibold`}>{line.itemName}</td>
              <td className={`${cell} break-words`}>
                {line.description && <p>{line.description}</p>}
                {line.specification && <p className="mt-1 whitespace-pre-line"><span className="font-semibold">Spec:</span> {line.specification}</p>}
                {line.remarks && <p className="mt-1 text-[8pt] italic">Remarks: {line.remarks}</p>}
              </td>
              <td className={`${cell} text-center`}>
                {line.referenceImage ? (
                  // eslint-disable-next-line @next/next/no-img-element -- authenticated reference image
                  <img src={uploadUrl(line.referenceImage)} alt="" className="mx-auto h-[18mm] w-[18mm] object-contain" />
                ) : <span className="text-[7pt] text-slate-400">No image</span>}
              </td>
              <td className={`${cell} text-right`}>{formatNumber(line.quantity)}</td>
              <td className={`${cell} text-center`}>{line.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="doc-block mt-4 grid grid-cols-2 gap-3">
        <div className="min-h-[26mm] border border-black p-2">
          <p className="font-bold">Requested by</p>
          <p className="text-[8.5pt]">{request.requestedByName}{request.submittedAt ? `, submitted ${formatPrintDate(request.submittedAt)}` : ", not submitted"}</p>
          <p className="mt-4 text-[8pt]">Signature ...................................</p>
        </div>
        <div className="min-h-[26mm] border border-black p-2">
          <p className="font-bold">Engineering Executive review</p>
          <p className="text-[8.5pt]">{request.status === "PENDING_EXECUTIVE_REVIEW" ? "Pending review" : "Not submitted"}</p>
          <p className="mt-4 text-[8pt]">Signature ...................................</p>
        </div>
      </div>
    </DocumentShell>
  );
}

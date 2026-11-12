"use client";

import { canPermission } from "@/lib/roles";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PackageSearch, Plus } from "lucide-react";
import { buildQuery } from "@/lib/api";
import { endOfDay, formatDate, formatNumber, startOfDay } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/useApi";
import type { MaterialRequest, MrStatus, Paged } from "@/lib/types";
import { useSession } from "@/components/layout/SessionProvider";
import DataTable, { Pagination } from "@/components/ui/DataTable";
import type { Column } from "@/components/ui/DataTable";
import { Card, PageHeader } from "@/components/ui/Feedback";
import { FilterSelect, Input, SearchInput } from "@/components/ui/Field";
import { MR_STATUS_LABELS, MrStatusBadge } from "./mrStatus";

type Tab = "requests" | "approvals" | "queue";

const TAB_PATHS: Record<Tab, string> = {
  requests: "/material-requests",
  approvals: "/material-requests/approvals",
  queue: "/material-requests/issue-queue",
};

export default function MaterialRequestsView() {
  const { user } = useSession();
  const role = user?.role;
  const searchParams = useSearchParams();
  const tabs = ([
    ["requests", role === "Technician" ? "My requests" : "All requests"],
    canPermission(user, "materialRequests.approve") ? ["approvals", "Pending approval"] : null,
    canPermission(user, "materialRequests.issue") ? ["queue", "Store issue queue"] : null,
  ].filter(Boolean) as [Tab, string][]);
  const requested = searchParams.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(tabs.some(([key]) => key === requested) ? (requested as Tab) : "requests");
  const [status, setStatus] = useState("");
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);

  const { data, error, loading } = useApi<Paged<"requests", MaterialRequest>>(
    `${TAB_PATHS[tab]}${buildQuery({ status: tab === "approvals" ? "" : status, mine: mine ? "true" : "", search: debounced, startDate: startOfDay(from), endDate: endOfDay(to), page, limit: 20 })}`,
  );

  const columns = useMemo<Column<MaterialRequest>[]>(() => [
    { id: "number", header: "MR number", cell: (mr) => <Link href={`/material-requests/view?id=${mr._id}`} className="whitespace-nowrap font-medium text-blue-700 hover:underline">{mr.mrNumber}</Link> },
    { id: "date", header: "Request date", cell: (mr) => <span className="whitespace-nowrap">{formatDate(mr.requestDate)}</span> },
    { id: "requester", header: "Requested by", cell: (mr) => <span className="whitespace-nowrap">{mr.requestedByName}</span> },
    { id: "dept", header: "Department / WO", cell: (mr) => <>{mr.department}{mr.workOrderNumber && <span className="block text-xs text-slate-500">WO {mr.workOrderNumber}</span>}</> },
    { id: "items", header: "Items", cell: (mr) => <span className="text-slate-600">{mr.items.length} item{mr.items.length === 1 ? "" : "s"}<span className="block max-w-56 truncate text-xs text-slate-500">{mr.items.map((line) => line.itemCode).join(", ")}</span></span> },
    {
      id: "progress",
      header: "Issued",
      className: "text-right",
      cell: (mr) => {
        const requested = mr.items.reduce((sum, line) => sum + line.requestedQuantity, 0);
        const issued = mr.items.reduce((sum, line) => sum + line.issuedQuantity, 0);
        return <span className="whitespace-nowrap">{formatNumber(issued)} / {formatNumber(requested)}</span>;
      },
    },
    { id: "approval", header: "Approved by", cell: (mr) => mr.approval?.decision === "APPROVED" ? <span className="whitespace-nowrap text-xs">{mr.approval.name}<span className="block text-slate-500">{mr.approval.role}</span></span> : <span className="text-slate-400">—</span> },
    { id: "status", header: "Status", cell: (mr) => <MrStatusBadge status={mr.status} /> },
    { id: "open", header: "", className: "text-right", cell: (mr) => <Link href={`/material-requests/view?id=${mr._id}`} className="text-sm font-medium text-blue-600 hover:underline">Open</Link> },
  ], []);

  const queueStatuses: MrStatus[] = ["PENDING_ISSUE", "PARTIALLY_ISSUED", "ON_HOLD", "ISSUED"];
  const statusOptions = tab === "queue" ? queueStatuses : (Object.keys(MR_STATUS_LABELS) as MrStatus[]);

  return (
    <>
      <PageHeader
        title="Material Requests"
        description="Request materials for work orders, approve them, and issue stock from the store."
        actions={
          <>
            <Link href="/material-requests/availability" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"><PackageSearch size={16} /> Check availability</Link>
            {canPermission(user, "materialRequests.create") && <Link href="/material-requests/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"><Plus size={16} /> New material request</Link>}
          </>
        }
      />

      <div role="tablist" aria-label="Material request views" className="flex gap-1 border-b border-slate-200">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => { setTab(key); setStatus(""); setPage(1); }}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === key ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <Card>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <SearchInput label="Search material requests" value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="MR number, work order, item code, requester" />
          {tab !== "approvals" && (
            <FilterSelect label="Status" value={status} onChange={(value) => { setStatus(value); setPage(1); }}>
              <option value="">{tab === "queue" ? "Open (not yet issued)" : "All statuses"}</option>
              {statusOptions.map((option) => <option key={option} value={option}>{MR_STATUS_LABELS[option]}</option>)}
            </FilterSelect>
          )}
          <div className="flex gap-2">
            <Input label="From" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} wrapperClassName="w-40" />
            <Input label="To" type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} wrapperClassName="w-40" />
          </div>
          {tab === "requests" && role !== "Technician" && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={mine} onChange={(event) => { setMine(event.target.checked); setPage(1); }} />
              Only my requests
            </label>
          )}
        </div>
        <DataTable
          caption="Material requests"
          columns={columns}
          rows={data?.requests || []}
          getRowId={(mr) => mr._id}
          loading={loading}
          error={error}
          emptyTitle={tab === "approvals" ? "No requests waiting for approval" : tab === "queue" ? "Nothing waiting to be issued" : "No material requests yet"}
        />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
      </Card>
    </>
  );
}

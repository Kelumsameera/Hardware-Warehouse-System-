"use client";

import { canPermission } from "@/lib/roles";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { buildQuery } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/useApi";
import type { NewItemRequest, Paged } from "@/lib/types";
import { useSession } from "@/components/layout/SessionProvider";
import DataTable, { Pagination } from "@/components/ui/DataTable";
import type { Column } from "@/components/ui/DataTable";
import { Card, Notice, PageHeader } from "@/components/ui/Feedback";
import { SearchInput } from "@/components/ui/Field";
import { NirStatusBadge, PriorityBadge } from "./nirShared";

type Tab = "mine" | "pending";

export default function NewItemRequestsView() {
  const { user } = useSession();
  const reviewer = canPermission(user, "newItemRequests.review");
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(reviewer && (searchParams.get("tab") === "pending" || !canPermission(user, "newItemRequests.create")) ? "pending" : "mine");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const path = tab === "pending" ? "/new-item-requests/pending" : "/new-item-requests";
  const { data, error, loading } = useApi<Paged<"requests", NewItemRequest>>(`${path}${buildQuery({ mine: tab === "mine" ? "true" : "", search: debounced, page, limit: 20 })}`);

  const columns = useMemo<Column<NewItemRequest>[]>(() => [
    { id: "number", header: "Request number", cell: (request) => <Link href={`/new-item-requests/view?id=${request._id}`} className="whitespace-nowrap font-medium text-blue-700 hover:underline">{request.requestNumber}</Link> },
    { id: "date", header: "Date", cell: (request) => <span className="whitespace-nowrap">{formatDate(request.requestDate)}</span> },
    { id: "requester", header: "Requested by", cell: (request) => <span className="whitespace-nowrap">{request.requestedByName}<span className="block text-xs text-slate-500">{request.department}</span></span> },
    { id: "project", header: "Project / WO", cell: (request) => <>{request.projectName || "—"}{request.workOrderNumber && <span className="block text-xs text-slate-500">WO {request.workOrderNumber}</span>}</> },
    { id: "items", header: "Items", cell: (request) => <span className="block max-w-64 truncate text-slate-600">{request.items.map((line) => line.itemName).join(", ") || "—"}</span> },
    { id: "priority", header: "Priority", cell: (request) => <PriorityBadge priority={request.priority} /> },
    { id: "status", header: "Status", cell: (request) => <NirStatusBadge status={request.status} /> },
  ], []);

  return (
    <>
      <PageHeader
        title="New Item Requests"
        description="Request materials that are not in the warehouse Item Master. Submitted requests go to the Engineering Executive for review."
        actions={canPermission(user, "newItemRequests.create") ? <Link href="/new-item-requests/edit" className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"><Plus size={16} /> New item request</Link> : undefined}
      />
      {reviewer && (
        <div role="tablist" aria-label="New item request views" className="flex gap-1 border-b border-slate-200">
          {([canPermission(user, "newItemRequests.create") ? ["mine", "My requests"] : null, ["pending", "Pending executive review"]].filter(Boolean) as [Tab, string][]).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setPage(1); }} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === key ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{label}</button>
          ))}
        </div>
      )}
      {tab === "pending" && <Notice type="info">Review is the last step built so far. Forwarding to the Engineering Manager or Purchasing is planned for a later release.</Notice>}
      <Card>
        <div className="mb-4"><SearchInput label="Search new item requests" value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Request number, project, work order, item name" /></div>
        <DataTable caption="New item requests" columns={columns} rows={data?.requests || []} getRowId={(request) => request._id} loading={loading} error={error} emptyTitle={tab === "pending" ? "No requests waiting for review" : "No new item requests yet"} />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
      </Card>
    </>
  );
}

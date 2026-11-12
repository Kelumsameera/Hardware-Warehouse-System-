"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCheck, BellRing } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/components/layout/SessionProvider";
import { connectNotificationSocket } from "@/lib/notificationSocket";
import { Badge, Card, Notice, PageHeader } from "@/components/ui/Feedback";
import Button from "@/components/ui/Button";

type NotificationItem = {
  _id: string;
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  link?: string | null;
  readAt?: string | null;
  createdAt: string;
};

type NotificationResponse = {
  notifications: NotificationItem[];
  unreadCount: number;
  total: number;
  page: number;
  totalPages: number;
};

function notificationLink(link: string) {
  // Keep older persisted notifications useful after query-based detail routing.
  return link.replace(/^\/(material-requests|new-item-requests)\/([a-f0-9]{24})$/i, "/$1/view?id=$2");
}

function EmailDeliveries() {
  const [page, setPage] = useState(1);
  const { data, error, reload } = useApi<{ deliveries: { _id: string; subject: string; status: string; attempts: number; maxAttempts: number; lastError: string | null }[]; total: number }>(`/notifications/email-deliveries?page=${page}`);
  return <Card title="Email delivery status" className="mt-6">
    <Button variant="secondary" size="sm" onClick={reload}>Refresh deliveries</Button>
    {error && <Notice type="error">{error}</Notice>}
    <div className="mt-3 space-y-2">{data?.deliveries.map((delivery) => <div key={delivery._id} className="rounded border p-3 text-sm"><p className="break-words font-medium">{delivery.subject}</p><p>{delivery.status} ? {delivery.attempts}/{delivery.maxAttempts} attempts</p>{delivery.lastError && <p className="text-red-700">{delivery.lastError}</p>}</div>)}</div>
    <div className="mt-3 flex gap-2"><Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous deliveries</Button><Button variant="secondary" size="sm" disabled={!data || page * 50 >= data.total} onClick={() => setPage(page + 1)}>Next deliveries</Button></div>
  </Card>;
}
export default function NotificationsView() {
  const { user } = useSession();
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<NotificationResponse>(`/notifications?page=${page}`);

  useEffect(() => {
    const socket = connectNotificationSocket(() => {
      window.dispatchEvent(new Event("wms-notifications-changed"));
      reload();
    });
    return () => {
      socket?.disconnect();
    };
  }, [reload]);

  const markAllRead = async () => {
    try {
      await api.post("/notifications/read-all");
      window.dispatchEvent(new Event("wms-notifications-changed"));
      reload();
    } catch (reason) {
      console.error(errorMessage(reason));
    }
  };

  const markRead = async (id: string) => {
    try {
      await api.post(`/notifications/${id}/read`);
      window.dispatchEvent(new Event("wms-notifications-changed"));
      reload();
    } catch (reason) {
      console.error(errorMessage(reason));
    }
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Persistent, role-aware updates for approvals, issues, holds, resumes, and activity alerts."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void markAllRead()} disabled={!data?.notifications?.length}>
            <CheckCheck size={14} /> Mark all read
          </Button>
        }
      />

      {error && <Notice type="error">{error}</Notice>}

      <Card>
        {loading ? (
          <p className="text-sm text-slate-500">Loading notifications…</p>
        ) : !data?.notifications?.length ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <BellRing size={28} className="text-slate-300" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-700">No notifications</p>
            <p className="text-sm text-slate-500">When approvals, issues, or stock alerts are triggered, they will show here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {data.notifications.map((notification) => (
              <div key={notification._id} className={`rounded-xl border p-4 ${notification.readAt ? "border-slate-200 bg-slate-50" : "border-blue-200 bg-blue-50/40"}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900">{notification.title}</p>
                      <Badge tone={notification.type === "warning" ? "amber" : notification.type === "success" ? "green" : notification.type === "error" ? "red" : "blue"}>{notification.type}</Badge>
                    </div>
                    <p className="text-sm text-slate-700">{notification.message}</p>
                    <p className="mt-2 text-xs text-slate-500">{formatDateTime(notification.createdAt)}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {notification.link && (
                      <Link href={notificationLink(notification.link)} className="text-sm font-medium text-blue-600 hover:underline">
                        Open
                      </Link>
                    )}
                    {!notification.readAt && (
                      <Button variant="secondary" size="sm" onClick={() => void markRead(notification._id)}>
                        Mark read
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="mt-4 flex gap-2"><Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="secondary" disabled={!data || page >= data.totalPages} onClick={() => setPage(page + 1)}>Next</Button></div>
      {user?.permissions?.emailDeliveries && <EmailDeliveries />}
    </>
  );
}

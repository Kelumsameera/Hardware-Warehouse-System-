"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, History } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { Badge, Card, Notice, PageHeader } from "@/components/ui/Feedback";
import Button from "@/components/ui/Button";
import { loadPermissionAuditLog, loadRolePermissions, saveRolePermissions } from "@/lib/permissionApi";

const DEFAULT_PAGE_KEYS = [
  "dashboard",
  "items",
  "warehouses",
  "inventory",
  "materialRequests",
  "newItemRequests",
  "movements",
  "alerts",
  "notifications",
  "reports",
  "users",
  "settings",
];

const PAGE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  items: "Items",
  warehouses: "Warehouse Manager",
  inventory: "Inventory",
  materialRequests: "Material Requests",
  newItemRequests: "New Item Requests",
  movements: "Stock Movements",
  alerts: "Alerts",
  notifications: "Notifications",
  reports: "Reports",
  users: "Users",
  settings: "Settings",
};

export default function PermissionsView() {
  const [roles, setRoles] = useState<Array<{ role: string; permissions: Record<string, boolean>; pageVisibility: string[] }>>([]);
  const [audit, setAudit] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [permissions, activity] = await Promise.all([loadRolePermissions(), loadPermissionAuditLog()]);
      setRoles(permissions);
      setAudit(activity.entries || []);
      setError("");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!active) return;
      await load();
    };
    void run();
    return () => {
      active = false;
    };
  }, []);

  const updatePermission = (role: string, key: string, value: boolean) => {
    setRoles((current) => current.map((entry) => entry.role === role ? {
      ...entry,
      permissions: { ...entry.permissions, [key]: value },
      pageVisibility: value ? Array.from(new Set([...entry.pageVisibility, key])) : entry.pageVisibility.filter((item) => item !== key),
    } : entry));
  };

  const submit = async (role: string) => {
    const entry = roles.find((item) => item.role === role);
    if (!entry) return;
    setSaving(true);
    try {
      await saveRolePermissions(role, entry.permissions, entry.pageVisibility);
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const pageKeys = useMemo(() => Array.from(new Set([...DEFAULT_PAGE_KEYS, ...roles.flatMap((entry) => Object.keys(entry.permissions))])), [roles]);

  if (loading) return <Card><p className="text-sm text-slate-500">Loading permission definitions…</p></Card>;

  return (
    <>
      <PageHeader
        title="Role permission editor"
        description="Super Admin only. This enforces page visibility and action-level permission defaults in the database."
        actions={<Badge tone="blue"><ShieldCheck size={14} className="mr-1" /> Super Admin only</Badge>}
      />

      {error && <Notice type="error">{error}</Notice>}

      <div className="space-y-6">
        {roles.map((roleEntry) => (
          <Card key={roleEntry.role} title={roleEntry.role}>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-slate-600">Visible pages and permissions</p>
              <Button variant="secondary" size="sm" onClick={() => void submit(roleEntry.role)} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {pageKeys.map((key) => (
                <label key={`${roleEntry.role}-${key}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
                  <span className="text-sm font-medium text-slate-700">{PAGE_LABELS[key] || key}</span>
                  <input
                    type="checkbox"
                    disabled={roleEntry.role === "Super Admin" && ["users", "users.write", "settings"].includes(key) && roleEntry.permissions[key]}
                    checked={Boolean(roleEntry.permissions[key])}
                    onChange={(event) => updatePermission(roleEntry.role, key, event.target.checked)}
                  />
                </label>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Card title="Recent permission audit" className="mt-6">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700"><History size={16} /> Audit history</div>
        {audit.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No permission changes recorded yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {audit.map((entry, index) => (
              <div key={`${String(entry._id || index)}-${index}`} className="rounded border border-slate-200 p-3 text-sm text-slate-700">
                <p className="font-medium text-slate-900">{String((entry.details as Record<string, unknown>)?.role || entry.entityType || "RolePermission")}</p>
                <p>{String((entry.details as Record<string, unknown>)?.nextPageVisibility || "")}</p>
                <p className="text-xs text-slate-500">{String(entry.createdAt || "")}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

"use client";

import { canPermission } from "@/lib/roles";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Pencil, Plus, Power } from "lucide-react";
import { api, buildQuery, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { ADMIN_ROLES, USER_ROLES, normalizeRole, hasRole } from "@/lib/roles";
import { useApi, useDebounced } from "@/lib/useApi";
import type { Activity, Paged, UserRecord } from "@/lib/types";
import { useSession } from "@/components/layout/SessionProvider";
import DataTable, { Pagination } from "@/components/ui/DataTable";
import type { Column } from "@/components/ui/DataTable";
import { Badge, Card, Notice, PageHeader, StatusBadge } from "@/components/ui/Feedback";
import { FilterSelect, Input, SearchInput, Select } from "@/components/ui/Field";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

const ROLE_DESCRIPTIONS: Record<string, string> = {
  "Super Admin": "Full access, including administrator accounts.",
  Admin: "Manages items, locations, users (non-admin), and all stock movements.",
  "Warehouse Admin": "Legacy alias for Admin.",
  Supervisor: "Posts all stock movements including adjustments; views activity history.",
  "Store Keeper": "Posts receipts, issues, transfers, and returns; manages reservations; issues, holds, and resumes material requests.",
  Storekeeper: "Legacy alias for Store Keeper.",
  Viewer: "Read-only access to items, locations, inventory, alerts, and reports.",
  Technician: "Creates and submits material requests; confirms receipt of issued items.",
  "Engineering Executive": "Approves or rejects material requests (one approval from Executive or Manager is enough).",
  "Engineering Manager": "Approves or rejects material requests (one approval from Executive or Manager is enough).",
};

function UserForm({ user, assignableRoles, onClose, onSaved }: { user: UserRecord | null; assignableRoles: string[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [fullName, setFullName] = useState(user?.fullName || "");
  const [email, setEmail] = useState(user?.email || "");
  const [role, setRole] = useState<string>(normalizeRole(user?.role) || "Viewer");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [saving, setSaving] = useState(false);


  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!fullName.trim()) found.fullName = "Full name is required";
    if (!user && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) found.email = "Enter a valid email address";
    if (!user && password.length < 10) found.password = "Password must be at least 10 characters";
    if (user && password && password.length < 10) found.password = "Password must be at least 10 characters";
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    setSubmitError("");
    try {
      if (user) {
        const body: Record<string, string> = { fullName: fullName.trim() };
        if (role !== user.role) body.role = role;
        if (password) body.password = password;
        await api.patch(`/auth/users/${user._id}`, body);
        onSaved(`User ${email} updated.`);
      } else {
        await api.post("/auth/users", { fullName: fullName.trim(), email: email.trim(), role, password });
        onSaved(`User ${email} created.`);
      }
    } catch (reason) {
      setSubmitError(errorMessage(reason));
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={user ? "Edit user" : "New user"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="user-form" disabled={saving}>{saving ? "Saving..." : "Save"}</Button></>}
    >
      <form id="user-form" onSubmit={submit} className="space-y-4" noValidate>
        {submitError && <Notice>{submitError}</Notice>}
        <Input label="Full name" required value={fullName} onChange={(event) => setFullName(event.target.value)} error={errors.fullName} maxLength={120} />
        <Input label="Email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} error={errors.email} disabled={Boolean(user)} hint={user ? "Email addresses cannot be changed" : undefined} autoComplete="off" />
        <Select label="Role" value={role} onChange={(event) => setRole(event.target.value)} hint={ROLE_DESCRIPTIONS[role]}>
          {assignableRoles.map((option) => <option key={option} value={option}>{option}</option>)}
        </Select>
        <Input
          label={user ? "New password" : "Password"}
          type="password"
          required={!user}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.password}
          hint={user ? "Leave empty to keep the current password. Minimum 10 characters." : "Minimum 10 characters. Share it with the user securely."}
          autoComplete="new-password"
        />
      </form>
    </Modal>
  );
}

function UserActivity({ user, onClose }: { user: UserRecord; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const { data, error, loading } = useApi<Paged<"activities", Activity>>(`/activities${buildQuery({ user: user._id, page, limit: 15 })}`);
  const columns = useMemo<Column<Activity>[]>(() => [
    { id: "date", header: "Date", cell: (activity) => <span className="whitespace-nowrap">{formatDate(activity.createdAt)}</span> },
    { id: "action", header: "Action", cell: (activity) => <span className="font-mono text-xs">{activity.action}</span> },
    { id: "entity", header: "Record", cell: (activity) => activity.entityType },
  ], []);
  return (
    <Modal open onClose={onClose} title={`Activity · ${user.fullName}`} size="lg">
      <DataTable caption="User activity" columns={columns} rows={data?.activities || []} getRowId={(activity) => activity._id} loading={loading} error={error} emptyTitle="No activity recorded" />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
    </Modal>
  );
}

export default function UsersView() {
  const { user: currentUser } = useSession();
  const actorRole = currentUser?.role || "";
  const roleOptions = useApi<{ roles: string[] }>(canPermission(currentUser, "users.write") ? "/auth/assignable-roles" : null);
  const assignableRoles = roleOptions.data?.roles || [];
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [activityUser, setActivityUser] = useState<UserRecord | null>(null);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const debounced = useDebounced(search);
  const { data, error, loading, reload } = useApi<Paged<"users", UserRecord>>(`/auth/users${buildQuery({ search: debounced, role, isActive: status, page, limit: 20 })}`);

  const canManage = (target: UserRecord) => canPermission(currentUser, "users.write") && assignableRoles.includes(normalizeRole(target.role) || target.role);

  const toggleActive = async (target: UserRecord) => {
    if (!window.confirm(`${target.isActive ? "Deactivate" : "Activate"} ${target.fullName}?`)) return;
    setActionError("");
    try {
      await api.patch(`/auth/users/${target._id}/active`, { isActive: !target.isActive });
      setMessage(`${target.fullName} ${target.isActive ? "deactivated" : "activated"}.`);
      reload();
    } catch (reason) {
      setActionError(errorMessage(reason));
    }
  };

  const columns = useMemo<Column<UserRecord>[]>(() => [
    { id: "name", header: "Name", cell: (target) => <><span className="font-medium text-slate-900">{target.fullName}</span>{target._id === currentUser?.id && <span className="ml-2"><Badge tone="blue">You</Badge></span>}<span className="block text-xs text-slate-500">{target.email}</span></> },
    { id: "role", header: "Role", cell: (target) => <Badge tone={hasRole(target.role, ADMIN_ROLES) ? "amber" : "slate"}>{target.role}</Badge> },
    { id: "status", header: "Status", cell: (target) => <StatusBadge active={target.isActive} /> },
    { id: "created", header: "Created", cell: (target) => <span className="whitespace-nowrap text-xs text-slate-500">{formatDate(target.createdAt)}</span> },
    {
      id: "actions",
      header: "Actions",
      className: "text-right",
      cell: (target) => (
        <div className="flex justify-end gap-1">
          {canPermission(currentUser, "activities") && <Button variant="ghost" size="sm" onClick={() => setActivityUser(target)}>Activity</Button>}
          {canManage(target) && <Button variant="ghost" size="sm" onClick={() => { setEditing(target); setFormOpen(true); }} aria-label={`Edit ${target.fullName}`}><Pencil size={14} /></Button>}
          {canManage(target) && target._id !== currentUser?.id && (
            <Button variant="ghost" size="sm" onClick={() => void toggleActive(target)} aria-label={`${target.isActive ? "Deactivate" : "Activate"} ${target.fullName}`}>
              <Power size={14} className={target.isActive ? "text-red-600" : "text-emerald-600"} />
            </Button>
          )}
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [actorRole, currentUser, assignableRoles]);

  return (
    <>
      <PageHeader
        title="Users & Roles"
        description="Manage accounts and role-based access. Permissions are enforced by the backend."
        actions={canPermission(currentUser, "users.write") ? <Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus size={16} /> New user</Button> : undefined}
      />
      {message && <Notice type="success">{message}</Notice>}
      {actionError && <Notice>{actionError}</Notice>}

      <Card>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <SearchInput label="Search users" value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Name or email" />
          <FilterSelect label="Role" value={role} onChange={(value) => { setRole(value); setPage(1); }}>
            <option value="">All roles</option>
            {USER_ROLES.map((option) => <option key={option} value={option}>{option}</option>)}
          </FilterSelect>
          <FilterSelect label="Status" value={status} onChange={(value) => { setStatus(value); setPage(1); }}>
            <option value="">All statuses</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </FilterSelect>
        </div>
        <DataTable caption="Users" columns={columns} rows={data?.users || []} getRowId={(target) => target._id} loading={loading} error={error} emptyTitle="No users found" />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
      </Card>

      <Card title="Role permissions">
        <dl className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
          {USER_ROLES.map((option) => (
            <div key={option} className="rounded-lg bg-slate-50 p-3">
              <dt className="font-medium text-slate-900">{option}</dt>
              <dd className="mt-1 text-slate-600">{ROLE_DESCRIPTIONS[option]}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {formOpen && canPermission(currentUser, "users.write") && (
        <UserForm
          key={editing?._id || "new"}
          user={editing}
          assignableRoles={assignableRoles}
          onClose={() => setFormOpen(false)}
          onSaved={(text) => { setFormOpen(false); setMessage(text); reload(); }}
        />
      )}
      {activityUser && <UserActivity user={activityUser} onClose={() => setActivityUser(null)} />}
    </>
  );
}

"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/components/layout/SessionProvider";
import { Card, Notice, PageHeader } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Field";
import Button from "@/components/ui/Button";

function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!currentPassword) found.currentPassword = "Enter your current password";
    if (newPassword.length < 10) found.newPassword = "Use at least 10 characters";
    if (newPassword && newPassword === currentPassword) found.newPassword = "Choose a different password";
    if (confirmPassword !== newPassword) found.confirmPassword = "Passwords do not match";
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    setStatus(null);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      setStatus({ type: "success", text: "Password changed. Use the new password next time you sign in." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (reason) {
      setStatus({ type: "error", text: errorMessage(reason) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="max-w-md space-y-4" noValidate>
      {status && <Notice type={status.type}>{status.text}</Notice>}
      <Input label="Current password" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} error={errors.currentPassword} />
      <Input label="New password" type="password" autoComplete="new-password" required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} error={errors.newPassword} hint="Minimum 10 characters" />
      <Input label="Confirm new password" type="password" autoComplete="new-password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} error={errors.confirmPassword} />
      <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Change password"}</Button>
    </form>
  );
}

export default function SettingsView() {
  const { user } = useSession();
  const profile = useApi<{ user: { createdAt?: string } }>("/auth/me");
  const health = useApi<{ status: string; database: string }>("/health");

  return (
    <>
      <PageHeader title="Settings" description="Your profile, password, and application information." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Profile">
          <dl className="space-y-3 text-sm">
            {[
              ["Name", user?.fullName],
              ["Email", user?.email],
              ["Role", user?.role],
              ["Account created", formatDate(profile.data?.user.createdAt)],
            ].map(([label, value]) => (
              <div key={label} className="grid grid-cols-3 gap-2">
                <dt className="text-slate-500">{label}</dt>
                <dd className="col-span-2 font-medium text-slate-900">{value || "—"}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-slate-500">Name and role changes are made by an administrator in Users & Roles.</p>
        </Card>

        <Card title="Change password">
          <PasswordForm />
        </Card>

        <Card title="Application" className="lg:col-span-2">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-lg bg-slate-50 p-3"><dt className="text-slate-500">Application</dt><dd className="mt-1 font-medium">Engineering Warehouse WMS</dd></div>
            <div className="rounded-lg bg-slate-50 p-3"><dt className="text-slate-500">Backend API</dt><dd className="mt-1 font-medium">{health.error ? "Unavailable" : health.data?.status === "ok" ? "Online" : "Checking..."}</dd></div>
            <div className="rounded-lg bg-slate-50 p-3"><dt className="text-slate-500">Database</dt><dd className="mt-1 font-medium capitalize">{health.data?.database || (health.error ? "Unknown" : "Checking...")}</dd></div>
          </dl>
          <p className="mt-4 text-xs text-slate-500">Sessions last 8 hours and are stored in a secure, HTTP-only cookie. Sign out on shared computers.</p>
        </Card>
      </div>
    </>
  );
}

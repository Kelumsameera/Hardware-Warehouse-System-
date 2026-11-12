import { api } from "@/lib/api";

export type PermissionRole = {
  role: string;
  permissions: Record<string, boolean>;
  pageVisibility: string[];
  updatedAt?: string | null;
};

export async function loadRolePermissions() {
  const result = await api.get<{ roles: PermissionRole[] }>("/permissions/roles");
  return result.roles;
}

export async function saveRolePermissions(role: string, permissions: Record<string, boolean>, pageVisibility: string[]) {
  return api.put<{ message: string }>(`/permissions/roles/${encodeURIComponent(role)}`, {
    permissions,
    pageVisibility,
  });
}

export async function loadPermissionAuditLog() {
  return api.get<{ entries: Array<Record<string, unknown>> }>("/permissions/audit");
}

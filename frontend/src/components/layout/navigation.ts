import { ArrowLeftRight, BarChart3, Bell, Boxes, ClipboardList, FilePlus2, LayoutDashboard, Package, Settings, Shield, TriangleAlert, Users, Warehouse } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ADMIN_ROLES, MOVEMENT_ROLES, NEW_ITEM_CREATE_ROLES, NEW_ITEM_REVIEW_ROLES } from "@/lib/roles";
import type { Role } from "@/lib/roles";

const SUPER_ADMIN_ONLY: Role[] = ["Super Admin"];

export type NavItem = { href: string; label: string; icon: LucideIcon; roles?: Role[] };

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/items", label: "Item Master", icon: Package },
  { href: "/warehouses", label: "Warehouse Management", icon: Warehouse },
  { href: "/inventory", label: "Inventory", icon: Boxes },
  { href: "/material-requests", label: "Material Requests", icon: ClipboardList },
  { href: "/new-item-requests", label: "New Item Requests", icon: FilePlus2, roles: [...new Set([...NEW_ITEM_CREATE_ROLES, ...NEW_ITEM_REVIEW_ROLES])] },
  { href: "/movements", label: "Stock Movements", icon: ArrowLeftRight, roles: MOVEMENT_ROLES },
  { href: "/alerts", label: "Stock Alerts", icon: TriangleAlert },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/permissions", label: "Permission Editor", icon: Shield, roles: SUPER_ADMIN_ONLY },
  { href: "/users", label: "Users & Roles", icon: Users, roles: ADMIN_ROLES },
  { href: "/settings", label: "Settings", icon: Settings },
];

const PAGE_PERMISSIONS: Record<string, string> = {
  "/": "dashboard", "/items": "items", "/warehouses": "warehouses", "/inventory": "inventory",
  "/material-requests": "materialRequests", "/new-item-requests": "newItemRequests", "/movements": "movements",
  "/alerts": "alerts", "/notifications": "notifications", "/reports": "reports", "/users": "users", "/settings": "settings",
};
export function canOpenNav(user: { role: string; permissions?: Record<string, boolean> } | null, item?: NavItem) {
  if (!item) return false;
  if (item.href === "/permissions") return user?.role === "Super Admin";
  return user?.permissions?.[PAGE_PERMISSIONS[item.href]] === true;
}
export function visibleNavItems(user: { role: string; permissions?: Record<string, boolean> } | null) {
  return NAV_ITEMS.filter((item) => canOpenNav(user, item));
}

export function findNavItem(pathname: string) {
  if (pathname === "/") return NAV_ITEMS[0];
  return NAV_ITEMS.find((item) => item.href !== "/" && (pathname === item.href || pathname.startsWith(`${item.href}/`)));
}

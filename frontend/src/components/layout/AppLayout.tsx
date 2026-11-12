"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronRight, LogOut, Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { useSession } from "./SessionProvider";
import { findNavItem, visibleNavItems, canOpenNav } from "./navigation";

import { api } from "@/lib/api";
import { connectNotificationSocket } from "@/lib/notificationSocket";
import { Loading, Notice } from "@/components/ui/Feedback";
import Button from "@/components/ui/Button";

const COLLAPSE_KEY = "wms-sidebar-collapsed";

// The collapsed state is a per-browser preference kept in localStorage.
function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribeCollapsed(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(COLLAPSE_KEY, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(COLLAPSE_KEY, callback);
  };
}

function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { user } = useSession();
  const pathname = usePathname();
  const active = findNavItem(pathname);
  return (
    <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto p-3">
      {visibleNavItems(user).map((item) => {
        const Icon = item.icon;
        const isActive = active?.href === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-blue-400 ${
              isActive ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"
            } ${collapsed ? "justify-center" : ""}`}
          >
            <Icon size={18} aria-hidden="true" />
            <span className={collapsed ? "sr-only" : ""}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={`border-b border-slate-800 px-5 py-5 ${collapsed ? "px-2 text-center" : ""}`}>
      <p className="text-lg font-bold text-white">{collapsed ? "WMS" : "Engineering WMS"}</p>
      {!collapsed && <p className="mt-0.5 text-xs text-slate-400">Warehouse Management System</p>}
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading, error, logout } = useSession();
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationCount, setNotificationCount] = useState<number | null>(null);

  const refreshCounts = useCallback(async () => {
    if (!user) return;
    try {
      const notifications = user.permissions?.notifications
        ? await api.get<{ unreadCount: number }>("/notifications/unread-count")
        : { unreadCount: 0 };
      setNotificationCount(notifications.unreadCount ?? 0);
    } catch {
      setNotificationCount(null);
    }
  }, [user]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshCounts(), 0);
    const poll = window.setInterval(() => void refreshCounts(), 30000);
    window.addEventListener("wms-notifications-changed", refreshCounts);
    return () => { window.clearTimeout(timer); window.clearInterval(poll); window.removeEventListener("wms-notifications-changed", refreshCounts); };
  }, [refreshCounts, pathname]);

  useEffect(() => {
    if (!user?.permissions?.notifications) return;
    const socket = connectNotificationSocket(() => {
      void refreshCounts();
    });
    return () => {
      socket?.disconnect();
    };
  }, [user, refreshCounts]);

  useEffect(() => {
    if (!mobileOpen) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setMobileOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [mobileOpen]);

  const toggleCollapsed = () => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "0" : "1");
      window.dispatchEvent(new Event(COLLAPSE_KEY));
    } catch {
      // Storage can be unavailable (private mode); the sidebar then stays expanded.
    }
  };

  const current = findNavItem(pathname);
  const allowed = canOpenNav(user, current);

  return (
    <div className="flex min-h-screen bg-slate-100 text-slate-900 print:bg-white">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>

      <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col bg-slate-950 transition-all lg:flex ${collapsed ? "w-20" : "w-64"}`}>
        <Brand collapsed={collapsed} />
        <Sidebar collapsed={collapsed} />
        <div className="border-t border-slate-800 p-3">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-blue-400"
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            {!collapsed && "Collapse"}
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <aside className="relative flex h-full w-72 max-w-[85%] flex-col bg-slate-950" aria-label="Mobile navigation">
            <div className="flex items-center justify-between">
              <Brand collapsed={false} />
              <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close menu" className="mr-3 rounded p-2 text-slate-300 hover:bg-slate-800">
                <X size={20} />
              </button>
            </div>
            <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open menu" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden">
            <Menu size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-slate-500">
              <Link href="/" className="hover:text-slate-800">Home</Link>
              {current && current.href !== "/" && (
                <>
                  <ChevronRight size={12} aria-hidden="true" />
                  <span aria-current="page">{current.label}</span>
                </>
              )}
            </nav>
            <p className="truncate text-base font-semibold text-slate-900">{current?.label || "Engineering WMS"}</p>
          </div>

          {user?.permissions?.notifications && <Link href="/notifications" className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label={notificationCount ? `${notificationCount} unread notifications` : "Notifications"}>
            <Bell size={20} />
            {Boolean(notificationCount) && (
              <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-5 text-white">
                {(notificationCount ?? 0) > 99 ? "99+" : notificationCount ?? 0}
              </span>
            )}
          </Link>

          }

          {user && (
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-slate-800">{user.fullName}</p>
              <p className="text-xs text-slate-500">{user.role}</p>
            </div>
          )}
          <Button variant="secondary" size="sm" onClick={() => void logout()} aria-label="Sign out">
            <LogOut size={14} />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </header>

        <main id="main-content" className="flex-1 p-4 sm:p-6">
          {loading ? (
            <Loading text="Loading your session..." />
          ) : error ? (
            <Notice>{error}. Check that the backend is running, then refresh the page.</Notice>
          ) : !allowed ? (
            <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <h1 className="text-xl font-bold">Access denied</h1>
              <p className="mt-2 text-sm text-slate-500">Your role ({user?.role}) does not have access to {current?.label}.</p>
              <Link href="/" className="mt-4 inline-block text-sm font-medium text-blue-600 hover:underline">Back to dashboard</Link>
            </div>
          ) : (
            <div className="mx-auto max-w-7xl space-y-6">{children}</div>
          )}
        </main>
      </div>
    </div>
  );
}

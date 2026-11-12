"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { User } from "@/lib/types";

type SessionValue = {
  user: User | null;
  loading: boolean;
  error: string;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

// Last confirmed user, kept for the life of the browser tab so moving between the dashboard
// and other pages does not flash a loading screen. It is re-validated on every mount.
let cachedUser: User | null = null;

function goToLogin(expired: boolean) {
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  // A full page load clears all in-memory data from the previous session.
  window.location.replace(expired ? `/login?expired=1&next=${next}` : "/login");
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(cachedUser);
  const [loading, setLoading] = useState(!cachedUser);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const refresh = () => fetch("/api/session", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (response.status === 401) {
          cachedUser = null;
          goToLogin(true);
          return;
        }
        if (!response.ok) throw new Error(data.message || "Could not load your session");
        setError("");
        cachedUser = data.user;
        setUser(data.user);
        setLoading(false);
      })
      .catch((reason) => {
        if (cancelled) return;
        cachedUser = null;
        setUser(null);
        setError(reason instanceof Error ? reason.message : "Could not load your session");
        setLoading(false);
      });
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    cachedUser = null;
    await fetch("/api/session", { method: "DELETE", headers: { "x-wms-request": "1" } }).catch(() => null);
    goToLogin(false);
  }, []);

  return <SessionContext value={{ user, loading, error, logout }}>{children}</SessionContext>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}

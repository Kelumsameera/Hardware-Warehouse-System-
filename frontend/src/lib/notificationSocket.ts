"use client";
import { io } from "socket.io-client";
import { api } from "./api";

export function connectNotificationSocket(onNotification: (payload: Record<string, unknown>) => void) {
  if (typeof window === "undefined") return null;
  const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || `${window.location.protocol}//${window.location.hostname}:4000`, {
    transports: ["websocket", "polling"],
    auth: (callback) => {
      void api.post<{ token: string }>("/notifications/socket-ticket")
        .then(({ token }) => callback({ token })).catch(() => callback({}));
    },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
  });
  // MongoDB is authoritative: every reconnect refreshes history and unread totals,
  // including events missed while offline. Do not increment counts from duplicates.
  socket.on("connect", () => onNotification({}));
  socket.on("notification:new", (payload) => {
    onNotification(payload || {});
    window.dispatchEvent(new Event("wms-notifications-changed"));
  });
  return socket;
}

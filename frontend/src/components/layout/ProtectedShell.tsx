import type { ReactNode } from "react";
import AppLayout from "./AppLayout";
import { SessionProvider } from "./SessionProvider";

// Wraps every signed-in page with the session and the application layout.
export default function ProtectedShell({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AppLayout>{children}</AppLayout>
    </SessionProvider>
  );
}

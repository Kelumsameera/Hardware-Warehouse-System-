// Session permissions are loaded before protected content is rendered.
export const instant = false;

import ProtectedShell from "@/components/layout/ProtectedShell";
import DashboardView from "./DashboardView";

export const metadata = { title: "Dashboard · Engineering WMS" };

// The dashboard sits at the app root (outside the (app) route group) and uses the same shell.
export default function DashboardPage() {
  return (
    <ProtectedShell>
      <DashboardView />
    </ProtectedShell>
  );
}

// Session permissions are loaded before protected content is rendered.
export const instant = false;

import { Suspense } from "react";
import AlertsView from "./AlertsView";

export const metadata = { title: "Stock Alerts · Engineering WMS" };

export default function AlertsPage() {
  return (
    <Suspense fallback={null}>
      <AlertsView />
    </Suspense>
  );
}

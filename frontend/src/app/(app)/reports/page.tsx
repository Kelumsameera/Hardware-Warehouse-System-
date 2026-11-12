// Session permissions are loaded before protected content is rendered.
export const instant = false;

import { Suspense } from "react";
import ReportsView from "./ReportsView";

export const metadata = { title: "Reports · Engineering WMS" };

export default function ReportsPage() {
  return (
    <Suspense fallback={null}>
      <ReportsView />
    </Suspense>
  );
}

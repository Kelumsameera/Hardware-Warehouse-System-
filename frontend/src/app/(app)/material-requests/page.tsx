// Session permissions are loaded before protected content is rendered.
export const instant = false;

import { Suspense } from "react";
import MaterialRequestsView from "./MaterialRequestsView";

export const metadata = { title: "Material Requests · Engineering WMS" };

export default function MaterialRequestsPage() {
  return (
    <Suspense fallback={null}>
      <MaterialRequestsView />
    </Suspense>
  );
}

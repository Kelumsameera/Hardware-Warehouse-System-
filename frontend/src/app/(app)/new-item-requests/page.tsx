// Session permissions are loaded before protected content is rendered.
export const instant = false;

import { Suspense } from "react";
import NewItemRequestsView from "./NewItemRequestsView";

export const metadata = { title: "New Item Requests · Engineering WMS" };

export default function NewItemRequestsPage() {
  return (
    <Suspense fallback={null}>
      <NewItemRequestsView />
    </Suspense>
  );
}

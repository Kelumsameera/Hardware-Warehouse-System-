// Session permissions are loaded before protected content is rendered.
export const instant = false;

import { Suspense } from "react";
import InventoryView from "./InventoryView";

export const metadata = { title: "Inventory · Engineering WMS" };

export default function InventoryPage() {
  return (
    <Suspense fallback={null}>
      <InventoryView />
    </Suspense>
  );
}

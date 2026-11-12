// Session permissions are loaded before protected content is rendered.
export const instant = false;

import { Suspense } from "react";
import ItemsView from "./ItemsView";

export const metadata = { title: "Item Master · Engineering WMS" };

export default function ItemsPage() {
  return (
    <Suspense fallback={null}>
      <ItemsView />
    </Suspense>
  );
}

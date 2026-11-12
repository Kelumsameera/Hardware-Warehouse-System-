// Session permissions are loaded before protected content is rendered.
export const instant = false;

import { Suspense } from "react";
import MovementsView from "./MovementsView";

export const metadata = { title: "Stock Movements · Engineering WMS" };

export default function MovementsPage() {
  return (
    <Suspense fallback={null}>
      <MovementsView />
    </Suspense>
  );
}

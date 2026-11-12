// Session permissions are loaded before protected content is rendered.
export const instant = false;

import { Suspense } from "react";
import NirDetails from "./NirDetails";

export const metadata = { title: "New Item Request · Engineering WMS" };

export default function NewItemRequestPage() {
  return (
    <Suspense fallback={null}>
      <NirDetails />
    </Suspense>
  );
}

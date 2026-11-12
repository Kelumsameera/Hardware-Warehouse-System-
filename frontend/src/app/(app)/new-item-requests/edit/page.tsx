// Session permissions are loaded before protected content is rendered.
export const instant = false;

import { Suspense } from "react";
import NirForm from "./NirForm";

export const metadata = { title: "New Item Request · Engineering WMS" };

export default function NewItemRequestEditPage() {
  return (
    <Suspense fallback={null}>
      <NirForm />
    </Suspense>
  );
}

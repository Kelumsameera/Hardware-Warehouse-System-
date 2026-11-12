// Session permissions are loaded before protected content is rendered.
export const instant = false;

import { Suspense } from "react";
import MrDetails from "./MrDetails";

export const metadata = { title: "Material Request · Engineering WMS" };

export default function MaterialRequestPage() {
  return (
    <Suspense fallback={null}>
      <MrDetails />
    </Suspense>
  );
}

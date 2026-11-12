// Session permissions are loaded before protected content is rendered.
export const instant = false;

import { Suspense } from "react";
import MrForm from "./MrForm";

export const metadata = { title: "Material Request · Engineering WMS" };

export default function NewMaterialRequestPage() {
  return (
    <Suspense fallback={null}>
      <MrForm />
    </Suspense>
  );
}

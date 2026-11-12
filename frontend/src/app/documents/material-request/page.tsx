import { Suspense } from "react";
import MrDocument from "./MrDocument";

export const metadata = { title: "Material Request Form · Engineering WMS" };

export default function MaterialRequestDocumentPage() {
  return (
    <Suspense fallback={null}>
      <MrDocument />
    </Suspense>
  );
}

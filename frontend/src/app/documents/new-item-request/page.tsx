import { Suspense } from "react";
import NirDocument from "./NirDocument";

export const metadata = { title: "New Item Request Form · Engineering WMS" };

export default function NewItemRequestDocumentPage() {
  return (
    <Suspense fallback={null}>
      <NirDocument />
    </Suspense>
  );
}

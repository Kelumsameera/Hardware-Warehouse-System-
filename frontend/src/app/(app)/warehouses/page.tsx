// Session permissions are loaded before protected content is rendered.
export const instant = false;

import WarehousesView from "./WarehousesView";

export const metadata = { title: "Warehouse Management · Engineering WMS" };

export default function WarehousesPage() {
  return <WarehousesView />;
}

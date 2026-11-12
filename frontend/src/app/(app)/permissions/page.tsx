// Session permissions are loaded before protected content is rendered.
export const instant = false;

import PermissionsView from "./PermissionsView";

export const metadata = { title: "Role permissions · Engineering WMS" };

export default function PermissionsPage() {
  return <PermissionsView />;
}

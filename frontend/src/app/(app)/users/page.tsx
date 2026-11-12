// Session permissions are loaded before protected content is rendered.
export const instant = false;

import UsersView from "./UsersView";

export const metadata = { title: "Users & Roles · Engineering WMS" };

export default function UsersPage() {
  return <UsersView />;
}

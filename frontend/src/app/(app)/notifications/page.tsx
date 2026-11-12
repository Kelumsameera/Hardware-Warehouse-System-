// Session permissions are loaded before protected content is rendered.
export const instant = false;

import { Suspense } from "react";
import NotificationsView from "./NotificationsView";

export const metadata = { title: "Notifications · Engineering WMS" };

export default function NotificationsPage() {
  return (
    <Suspense fallback={null}>
      <NotificationsView />
    </Suspense>
  );
}

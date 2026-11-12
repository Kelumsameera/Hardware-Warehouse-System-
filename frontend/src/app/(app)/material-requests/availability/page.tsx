// Session permissions are loaded before protected content is rendered.
export const instant = false;

import AvailabilityView from "./AvailabilityView";

export const metadata = { title: "Item Availability · Engineering WMS" };

export default function AvailabilityPage() {
  return <AvailabilityView />;
}

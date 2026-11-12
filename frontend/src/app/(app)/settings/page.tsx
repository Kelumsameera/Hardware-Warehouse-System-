// Session permissions are loaded before protected content is rendered.
export const instant = false;

import SettingsView from "./SettingsView";

export const metadata = { title: "Settings · Engineering WMS" };

export default function SettingsPage() {
  return <SettingsView />;
}

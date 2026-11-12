import type { MrStatus } from "@/lib/types";
import { Badge } from "@/components/ui/Feedback";

export const MR_STATUS_LABELS: Record<MrStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  REJECTED: "Rejected",
  PENDING_ISSUE: "Approved – awaiting issue",
  PARTIALLY_ISSUED: "Partially issued",
  ON_HOLD: "On hold",
  ISSUED: "Issued",
  RECEIVED: "Received",
};

const tones: Record<MrStatus, "green" | "red" | "amber" | "blue" | "slate"> = {
  DRAFT: "slate",
  PENDING_APPROVAL: "amber",
  REJECTED: "red",
  PENDING_ISSUE: "blue",
  PARTIALLY_ISSUED: "blue",
  ON_HOLD: "amber",
  ISSUED: "green",
  RECEIVED: "green",
};

export function MrStatusBadge({ status }: { status: MrStatus }) {
  return <Badge tone={tones[status]}>{MR_STATUS_LABELS[status]}</Badge>;
}

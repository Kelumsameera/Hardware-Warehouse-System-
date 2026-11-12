import type { NewItemRequest, NewItemStatus } from "@/lib/types";
import { Badge } from "@/components/ui/Feedback";

export const NIR_STATUS_LABELS: Record<NewItemStatus, string> = {
  DRAFT: "Draft",
  PENDING_EXECUTIVE_REVIEW: "Pending executive review",
};

export function NirStatusBadge({ status }: { status: NewItemStatus }) {
  return <Badge tone={status === "DRAFT" ? "slate" : "amber"}>{NIR_STATUS_LABELS[status]}</Badge>;
}

const priorityTones: Record<NewItemRequest["priority"], "slate" | "blue" | "amber" | "red"> = { Low: "slate", Normal: "blue", High: "amber", Urgent: "red" };

export function PriorityBadge({ priority }: { priority: NewItemRequest["priority"] }) {
  return <Badge tone={priorityTones[priority]}>{priority}</Badge>;
}

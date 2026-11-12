export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(value: string | Date | null | undefined) {
  return formatDate(value);
}

export function formatDay(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const MOVEMENT_LABELS: Record<string, string> = {
  receipt: "Receipt",
  issue: "Issue",
  transfer: "Transfer",
  adjustment: "Adjustment",
  return: "Return",
};

// End of the selected day, so a date range filter includes the whole "to" day.
export function endOfDay(date: string) {
  return date ? new Date(`${date}T23:59:59.999`).toISOString() : "";
}

export function startOfDay(date: string) {
  return date ? new Date(`${date}T00:00:00`).toISOString() : "";
}

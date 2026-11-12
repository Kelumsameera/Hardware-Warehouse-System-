import { formatNumber } from "@/lib/format";
import type { Bin } from "@/lib/types";
import { Badge } from "@/components/ui/Feedback";

export function BinStatusBadge({ status }: { status?: string }) {
  const tone = status === "Full" ? "red" : status === "Occupied" ? "blue" : status === "Available" ? "green" : "slate";
  return <Badge tone={tone}>{status || "Unknown"}</Badge>;
}

export function CapacityBar({ bin }: { bin: Pick<Bin, "capacity" | "availableCapacity" | "capacityUnit"> }) {
  if (bin.capacity === null) return <span className="text-xs text-slate-500">Capacity not tracked</span>;
  const used = bin.capacity - (bin.availableCapacity ?? 0);
  const percent = bin.capacity > 0 ? Math.min(100, Math.round((used / bin.capacity) * 100)) : 100;
  const color = percent >= 100 ? "bg-red-500" : percent >= 80 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="w-full">
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Capacity used">
        <div className={`h-full ${color}`} style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">{formatNumber(used)} / {formatNumber(bin.capacity)} {bin.capacityUnit} used · {formatNumber(bin.availableCapacity)} free</p>
    </div>
  );
}

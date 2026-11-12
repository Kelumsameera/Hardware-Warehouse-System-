import { ImageOff } from "lucide-react";
import type { StockStatus } from "@/lib/types";
import { Badge } from "@/components/ui/Feedback";

// Uploaded images are served by the backend behind authentication, via the Next.js proxy.
export function uploadUrl(path: string | null | undefined) {
  return path && path.startsWith("/uploads/") ? `/api/backend${path}` : "";
}

export function ItemThumb({ image, alt, size = 40 }: { image: string | null | undefined; alt: string; size?: number }) {
  const src = uploadUrl(image);
  if (!src) {
    return (
      <span className="flex shrink-0 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-slate-300" style={{ width: size, height: size }} aria-label="No image">
        <ImageOff size={Math.round(size / 2.5)} aria-hidden="true" />
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- authenticated image served through the API proxy
  return <img src={src} alt={alt} width={size} height={size} className="shrink-0 rounded-md border border-slate-200 bg-white object-contain" style={{ width: size, height: size }} />;
}

const STATUS: Record<StockStatus, { label: string; tone: "green" | "amber" | "red" }> = {
  IN_STOCK: { label: "In stock", tone: "green" },
  LOW_STOCK: { label: "Low stock", tone: "amber" },
  OUT_OF_STOCK: { label: "Out of stock", tone: "red" },
};

export function StockStatusBadge({ status }: { status: StockStatus }) {
  return <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>;
}

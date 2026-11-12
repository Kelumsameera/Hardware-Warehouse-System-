"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ImagePlus, Star, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { Item, StockSummaryRow, Warehouse } from "@/lib/types";
import { Badge, Notice, Spinner, StatusBadge } from "@/components/ui/Feedback";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

// Uploaded images are served by the backend behind authentication, via the Next.js proxy.
export function imageUrl(path: string) {
  return path.startsWith("/uploads/") ? `/api/backend${path}` : "";
}

type ItemDetailsProps = {
  item: Item;
  open: boolean;
  canEdit: boolean;
  onClose: () => void;
  onChanged: (item: Item) => void;
  onEdit: () => void;
};

export default function ItemDetails({ item, open, canEdit, onClose, onChanged, onEdit }: ItemDetailsProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stock = useApi<{ summary: StockSummaryRow[] }>(`/inventory/item/${item._id}`);
  const warehouses = useApi<Warehouse[]>("/warehouses");
  const warehouseName = (id: string) => warehouses.data?.find((warehouse) => warehouse._id === id)?.warehouseName || "Warehouse";

  const upload = async (file: File) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Only JPEG, PNG, or WebP images are allowed");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Images must be 5 MB or smaller");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("image", file);
      const result = await api.upload<{ item: Item }>(`/items/${item._id}/images`, formData);
      onChanged(result.item);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const removeImage = async (image: string) => {
    if (!window.confirm("Remove this image?")) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.delete<{ item: Item }>(`/items/${item._id}/images`, { image });
      onChanged(result.item);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const makePrimary = async (image: string) => {
    setBusy(true);
    setError("");
    try {
      const result = await api.put<{ item: Item }>(`/items/${item._id}`, { image });
      onChanged(result.item);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const totalQuantity = stock.data?.summary.reduce((sum, row) => sum + row.quantity, 0) ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item.itemCode}
      size="xl"
      footer={
        <>
          <Link href={`/inventory?item=${item._id}`} className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">View inventory</Link>
          {canEdit && <Button onClick={onEdit}>Edit item</Button>}
        </>
      }
    >
      <div className="space-y-5">
        {error && <Notice>{error}</Notice>}
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-base font-medium text-slate-800">{item.description}</p>
          <StatusBadge active={item.isActive} />
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[
            ["Item group", item.itemGroup || "—"],
            ["Item type", item.itemType || "—"],
            ["Unit of measure", item.uom || "—"],
            ["BOM type", item.bomType || "—"],
            ["Minimum stock", formatNumber(item.minStock)],
            ["Reorder level", formatNumber(item.reorderLevel)],
            ["Maximum stock", item.maxStock === null ? "No maximum" : formatNumber(item.maxStock)],
            ["Last updated", formatDate(item.updatedAt)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-slate-50 p-3">
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="mt-0.5 font-medium text-slate-800">{value}</dd>
            </div>
          ))}
        </dl>

        <section>
          <h3 className="text-sm font-semibold text-slate-900">Stock by warehouse</h3>
          {stock.loading ? (
            <div className="py-3"><Spinner /></div>
          ) : stock.error ? (
            <Notice>{stock.error}</Notice>
          ) : stock.data?.summary.length ? (
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {stock.data.summary.map((row) => (
                <li key={row.warehouse} className="flex justify-between px-3 py-2 text-sm">
                  <span>{warehouseName(row.warehouse)}</span>
                  <span className="font-medium">{formatNumber(row.quantity)} {item.uom} <span className="text-xs font-normal text-slate-500">({formatNumber(row.availableQuantity)} available)</span></span>
                </li>
              ))}
              <li className="flex justify-between bg-slate-50 px-3 py-2 text-sm font-semibold">
                <span>Total</span>
                <span>{formatNumber(totalQuantity)} {item.uom}</span>
              </li>
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No stock recorded for this item.</p>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Images ({item.images.length})</h3>
            {canEdit && (
              <>
                <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id="item-image-upload" onChange={(event) => event.target.files?.[0] && void upload(event.target.files[0])} />
                <Button variant="secondary" size="sm" disabled={busy || item.images.length >= 10} onClick={() => fileInput.current?.click()}>
                  {busy ? <Spinner /> : <ImagePlus size={14} />} Upload image
                </Button>
              </>
            )}
          </div>
          {item.images.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No images uploaded. JPEG, PNG, or WebP up to 5 MB, maximum 10 per item.</p>
          ) : (
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {item.images.map((image) => (
                <li key={image} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  {/* eslint-disable-next-line @next/next/no-img-element -- authenticated image served through the API proxy */}
                  <img src={imageUrl(image)} alt={`${item.itemCode} image`} className="aspect-square w-full object-cover" />
                  <div className="flex items-center justify-between gap-1 p-1.5">
                    {item.image === image ? (
                      <Badge tone="blue">Primary</Badge>
                    ) : canEdit ? (
                      <button type="button" disabled={busy} onClick={() => void makePrimary(image)} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-slate-600 hover:bg-white">
                        <Star size={12} /> Set primary
                      </button>
                    ) : <span />}
                    {canEdit && (
                      <button type="button" disabled={busy} onClick={() => void removeImage(image)} aria-label="Remove image" className="rounded p-1 text-red-600 hover:bg-white">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}

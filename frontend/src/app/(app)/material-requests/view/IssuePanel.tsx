"use client";

import { useState } from "react";
import { Wand2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { MaterialRequest, MrStockLine } from "@/lib/types";
import { Card, Loading, Notice } from "@/components/ui/Feedback";
import { Textarea } from "@/components/ui/Field";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const round = (value: number) => Math.round(value * 1e6) / 1e6;

// Store Keeper issues stock line by line from the bins that hold it. Each confirmed issue carries
// one idempotency key, so a retried or double-clicked submit can never deduct stock twice.
export default function IssuePanel({ mr, onIssued }: { mr: MaterialRequest; onIssued: (mr: MaterialRequest, message: string) => void }) {
  const stock = useApi<{ lines: MrStockLine[] }>(`/material-requests/${mr._id}/stock?_v=${mr.updatedAt}`);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState("");
  const [confirm, setConfirm] = useState<"full" | "partial" | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const lines = (stock.data?.lines || []).filter((line) => line.remainingQuantity > 0);
  const key = (line: string, bin: string) => `${line}:${bin}`;
  const allocated = (line: MrStockLine) => round(line.bins.reduce((sum, bin) => sum + (Number(quantities[key(line.line, bin.bin)]) || 0), 0));

  const fillOutstanding = () => {
    const next: Record<string, string> = {};
    for (const line of lines) {
      let left = line.remainingQuantity;
      for (const bin of line.bins) {
        if (left <= 0) break;
        const take = round(Math.min(left, bin.availableQuantity));
        next[key(line.line, bin.bin)] = String(take);
        left = round(left - take);
      }
    }
    setQuantities(next);
  };

  const allocations = lines.flatMap((line) => line.bins
    .map((bin) => ({ line: line.line, bin: bin.bin, binLabel: bin.locationCode || bin.binCode, itemCode: line.itemCode, quantity: Number(quantities[key(line.line, bin.bin)]) || 0 }))
    .filter((entry) => entry.quantity > 0));

  const problems = lines.flatMap((line) => {
    const issues: string[] = [];
    if (allocated(line) > line.remainingQuantity) issues.push(`${line.itemCode}: more than the outstanding ${formatNumber(line.remainingQuantity)}`);
    for (const bin of line.bins) {
      const value = Number(quantities[key(line.line, bin.bin)]) || 0;
      if (value < 0) issues.push(`${line.itemCode}: quantities cannot be negative`);
      if (value > bin.availableQuantity) issues.push(`${line.itemCode}: only ${formatNumber(bin.availableQuantity)} available in ${bin.locationCode || bin.binCode}`);
    }
    return issues;
  });
  const coversAll = lines.length > 0 && lines.every((line) => allocated(line) === line.remainingQuantity);

  const submit = async () => {
    if (!confirm) return;
    setSaving(true);
    setError("");
    try {
      const result = await api.post<{ materialRequest: MaterialRequest; message: string }>(`/material-requests/${mr._id}/issue-${confirm}`, {
        idempotencyKey,
        remarks: remarks.trim(),
        allocations: allocations.map(({ line, bin, quantity }) => ({ line, bin, quantity })),
      });
      setQuantities({});
      setRemarks("");
      setConfirm(null);
      setIdempotencyKey(newKey());
      onIssued(result.materialRequest, result.message);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Issue stock" description="Enter the quantity to take from each bin. Only available (unreserved) stock is shown." actions={<Button variant="secondary" size="sm" onClick={fillOutstanding} disabled={!lines.length}><Wand2 size={14} /> Fill outstanding from stock</Button>}>
      {stock.loading && !stock.data ? <Loading /> : stock.error ? <Notice>{stock.error}</Notice> : (
        <div className="space-y-4">
          {error && !confirm && <Notice>{error}</Notice>}
          {lines.map((line) => {
            const total = allocated(line);
            return (
              <section key={line.line} className="rounded-lg border border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-900">{line.itemCode}</span>
                  <span className="text-slate-600">
                    Outstanding <strong>{formatNumber(line.remainingQuantity)}</strong> · In stock <strong className={line.totalAvailable < line.remainingQuantity ? "text-amber-700" : ""}>{formatNumber(line.totalAvailable)}</strong> · This issue <strong className={total > line.remainingQuantity ? "text-red-600" : ""}>{formatNumber(total)}</strong>
                  </span>
                </div>
                {line.bins.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-amber-700">No available stock for this item. Issue other items partially or place the request on hold.</p>
                ) : (
                  <table className="min-w-full text-sm">
                    <caption className="sr-only">Bins holding {line.itemCode}</caption>
                    <thead className="text-xs uppercase text-slate-500">
                      <tr><th scope="col" className="px-3 py-2 text-left">Bin</th><th scope="col" className="px-3 py-2 text-left">Location</th><th scope="col" className="px-3 py-2 text-right">Available</th><th scope="col" className="w-36 px-3 py-2 text-right">Issue qty</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {line.bins.map((bin) => (
                        <tr key={bin.bin}>
                          <td className="px-3 py-2 font-medium">{bin.locationCode || bin.binCode}</td>
                          <td className="px-3 py-2 text-slate-500">{bin.path}</td>
                          <td className="px-3 py-2 text-right">{formatNumber(bin.availableQuantity)}</td>
                          <td className="px-3 py-1.5 text-right">
                            <input
                              type="number"
                              min={0}
                              step="any"
                              max={bin.availableQuantity}
                              aria-label={`Issue quantity of ${line.itemCode} from ${bin.locationCode || bin.binCode}`}
                              value={quantities[key(line.line, bin.bin)] || ""}
                              onChange={(event) => setQuantities((current) => ({ ...current, [key(line.line, bin.bin)]: event.target.value }))}
                              className="h-9 w-28 rounded-lg border border-slate-300 px-2 text-right text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })}
          {problems.length > 0 && <Notice>{problems.join(". ")}</Notice>}
          <Textarea label="Issue remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} maxLength={1000} placeholder="Collected by, gate pass, notes..." />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" disabled={!allocations.length || problems.length > 0 || coversAll} onClick={() => setConfirm("partial")}>Issue partially</Button>
            <Button disabled={!coversAll || problems.length > 0} onClick={() => setConfirm("full")} title={coversAll ? undefined : "Enter quantities that cover every outstanding item"}>Issue all outstanding</Button>
          </div>
        </div>
      )}

      {confirm && (
        <Modal
          open
          onClose={() => !saving && setConfirm(null)}
          title={confirm === "full" ? "Confirm full issue" : "Confirm partial issue"}
          footer={<><Button variant="secondary" onClick={() => setConfirm(null)} disabled={saving}>Back</Button><Button onClick={() => void submit()} disabled={saving}>{saving ? "Issuing..." : "Issue stock"}</Button></>}
        >
          <div className="space-y-3 text-sm">
            {error && <Notice>{error}</Notice>}
            <p className="text-slate-600">Stock will be deducted from these bins for {mr.mrNumber}:</p>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {allocations.map((entry) => (
                <li key={`${entry.line}-${entry.bin}`} className="flex justify-between px-3 py-2"><span><span className="font-medium">{entry.itemCode}</span> from {entry.binLabel}</span><span>{formatNumber(entry.quantity)}</span></li>
              ))}
            </ul>
            {confirm === "partial" && <p className="text-slate-500">The remaining quantities stay outstanding and can be issued later.</p>}
          </div>
        </Modal>
      )}
    </Card>
  );
}

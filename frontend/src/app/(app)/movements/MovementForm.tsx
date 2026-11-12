"use client";

import { canPermission } from "@/lib/roles";

import { useState } from "react";
import { CheckCircle2, Wand2 } from "lucide-react";
import { api, buildQuery, errorMessage, newTransactionReference } from "@/lib/api";
import { formatNumber, MOVEMENT_LABELS } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import { binLocation, levelPath } from "@/lib/types";
import type { Bin, InventoryRecord, Item, Movement, Paged } from "@/lib/types";
import { useSession } from "@/components/layout/SessionProvider";
import { BinPicker, ItemPicker, WarehouseSelect } from "@/components/Pickers";
import { Badge, Notice, Spinner } from "@/components/ui/Feedback";
import { Input, Textarea } from "@/components/ui/Field";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

type MovementType = Movement["movementType"];
type ItemOption = Pick<Item, "_id" | "itemCode" | "description" | "uom" | "itemGroup">;

const ENDPOINTS: Record<MovementType, string> = {
  receipt: "/stock-movements/receipts",
  issue: "/stock-movements/issues",
  transfer: "/stock-movements/transfers",
  adjustment: "/stock-movements/adjustments",
  return: "/stock-movements/returns",
};

const PREFIX: Record<MovementType, string> = { receipt: "RCPT", issue: "ISS", transfer: "TRF", adjustment: "ADJ", return: "RET" };

const DESCRIPTIONS: Record<MovementType, string> = {
  receipt: "Receive stock into a bin (purchase, production, opening balance).",
  issue: "Issue stock out of a bin to a job, project, or department.",
  transfer: "Move stock from one bin to another.",
  adjustment: "Correct a stock count. Requires Supervisor or administrator role.",
  return: "Return previously issued stock back into a bin.",
};

// Picks the bin that stock leaves from, listing only bins that hold the item.
function SourceBinPicker({ itemId, value, onChange, error }: { itemId: string; value: InventoryRecord | null; onChange: (record: InventoryRecord | null) => void; error?: string }) {
  const { data, loading, error: loadError } = useApi<Paged<"inventory", InventoryRecord>>(`/inventory${buildQuery({ item: itemId, limit: 100 })}`);
  const records = (data?.inventory || []).filter((record) => record.quantity > 0);
  return (
    <div>
      <label htmlFor="source-bin" className="block text-sm font-medium text-slate-700">Source bin<span className="ml-0.5 text-red-600" aria-hidden="true">*</span></label>
      {loading && !data ? (
        <div className="mt-2"><Spinner /></div>
      ) : (
        <select
          id="source-bin"
          value={value?._id || ""}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(records.find((record) => record._id === event.target.value) || null)}
          className="mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-400"
        >
          <option value="">{records.length ? "Select the bin to take stock from" : "This item has no stock in any bin"}</option>
          {records.map((record) => (
            <option key={record._id} value={record._id}>
              {binLocation(record.bin)} — {levelPath(record.bin?.level)} — {formatNumber(record.availableQuantity)} available
            </option>
          ))}
        </select>
      )}
      {loadError && <p role="alert" className="mt-1 text-xs text-red-600">{loadError}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// Destination bin: manual search or the backend's automatic suggestion.
function DestinationBinPicker({ item, quantity, value, onChange, error }: { item: ItemOption; quantity: number; value: Bin | null; onChange: (bin: Bin | null) => void; error?: string }) {
  const [warehouse, setWarehouse] = useState("");
  const [suggestPath, setSuggestPath] = useState<string | null>(null);
  const suggestions = useApi<{ bins: Bin[] }>(suggestPath);

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <WarehouseSelect label="Warehouse" value={warehouse} onChange={(next) => { setWarehouse(next); setSuggestPath(null); onChange(null); }} includeAll="Any warehouse" activeOnly />
        <BinPicker label="Destination bin" required value={value} onChange={onChange} warehouse={warehouse || undefined} error={error} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={!warehouse || !(quantity > 0) || suggestions.loading}
          onClick={() => setSuggestPath(`/bins/suggest${buildQuery({ item: item._id, warehouse, quantity })}`)}
          title={!warehouse ? "Choose a warehouse first" : !(quantity > 0) ? "Enter a quantity first" : undefined}
        >
          {suggestions.loading ? <Spinner /> : <Wand2 size={14} />} Suggest bins
        </Button>
        <span className="text-xs text-slate-500">Suggestions respect capacity, unit of measure, allowed groups, and dedicated bins.</span>
      </div>
      {suggestions.error && <Notice>{suggestions.error}</Notice>}
      {suggestPath && suggestions.data && (
        suggestions.data.bins.length === 0 ? (
          <Notice type="warning">No bin in this warehouse can take {formatNumber(quantity)} {item.uom} of this item. Choose a bin manually or check bin setup.</Notice>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label="Suggested bins">
            {suggestions.data.bins.slice(0, 5).map((bin) => (
              <li key={bin._id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="font-medium">{binLocation(bin)}</span>
                <span className="text-xs text-slate-500">{bin.binName}</span>
                {bin.containsItem && <Badge tone="blue">Already holds item</Badge>}
                <span className="text-xs text-slate-500">{bin.capacity === null ? "Capacity not tracked" : `${formatNumber(bin.availableCapacity)} ${bin.capacityUnit} free`}</span>
                <Button size="sm" variant={value?._id === bin._id ? "primary" : "secondary"} className="ml-auto" onClick={() => onChange(bin)}>
                  {value?._id === bin._id ? "Selected" : "Use this bin"}
                </Button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

export default function MovementForm({ initialType = "receipt", onPosted }: { initialType?: MovementType; onPosted: () => void }) {
  const { user } = useSession();
  const canAdjust = canPermission(user, "movements.adjust");
  const [type, setType] = useState<MovementType>(canPermission(user, "movements.write") ? initialType : "adjustment");
  const [direction, setDirection] = useState<"increase" | "decrease">("increase");
  const [item, setItem] = useState<ItemOption | null>(null);
  const [quantity, setQuantity] = useState("");
  const [source, setSource] = useState<InventoryRecord | null>(null);
  const [destination, setDestination] = useState<Bin | null>(null);
  const [reference, setReference] = useState(() => newTransactionReference(PREFIX[initialType]));
  const [occurredAt, setOccurredAt] = useState("");
  const [remarks, setRemarks] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<{ movement: Movement; idempotent: boolean } | null>(null);

  const needsSource = type === "issue" || type === "transfer" || (type === "adjustment" && direction === "decrease");
  const needsDestination = type === "receipt" || type === "return" || type === "transfer" || (type === "adjustment" && direction === "increase");
  const amount = Number(quantity);

  const changeType = (next: MovementType) => {
    setType(next);
    setSource(null);
    setDestination(null);
    setErrors({});
    setReference(newTransactionReference(PREFIX[next]));
  };

  const changeItem = (next: ItemOption | null) => {
    setItem(next);
    setSource(null);
    setDestination(null);
  };

  const validate = () => {
    const found: Record<string, string> = {};
    if (!item) found.item = "Select an item";
    if (!quantity || !Number.isFinite(amount) || amount <= 0) found.quantity = "Enter a quantity greater than zero";
    if (!reference.trim()) found.reference = "A transaction reference is required";
    if (reference.trim().length > 100) found.reference = "Maximum 100 characters";
    if (needsSource && !source) found.source = "Select a source bin";
    if (needsSource && source && amount > source.availableQuantity) found.quantity = `Only ${formatNumber(source.availableQuantity)} ${item?.uom || ""} available in this bin`;
    if (needsDestination && !destination) found.destination = "Select a destination bin";
    if (type === "transfer" && source && destination && source.bin?._id === destination._id) found.destination = "Destination must differ from the source bin";
    if (needsDestination && destination && item && destination.capacity !== null) {
      if (destination.capacityUnit !== item.uom) found.destination = `This bin measures capacity in ${destination.capacityUnit}; the item unit is ${item.uom}`;
      else if (amount > (destination.availableCapacity ?? 0)) found.destination = `Only ${formatNumber(destination.availableCapacity)} ${destination.capacityUnit} of space left in this bin`;
    }
    if (needsDestination && destination && item && destination.allowedItemGroups.length && !destination.allowedItemGroups.includes(item.itemGroup || "")) {
      found.destination = "This bin does not accept the item's group";
    }
    if (occurredAt && Number.isNaN(new Date(occurredAt).getTime())) found.occurredAt = "Enter a valid date and time";
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const submit = async () => {
    if (submitting || !item) return;
    setSubmitting(true);
    setSubmitError("");
    const body: Record<string, unknown> = {
      transactionReference: reference.trim(),
      item: item._id,
      quantity: amount,
      remarks: remarks.trim(),
    };
    if (needsSource) body.sourceBin = source?.bin?._id;
    if (needsDestination) body.destinationBin = destination?._id;
    if (type === "adjustment") body.adjustmentDirection = direction;
    if (occurredAt) body.occurredAt = new Date(occurredAt).toISOString();
    try {
      const response = await api.post<{ movement: Movement; idempotent: boolean }>(ENDPOINTS[type], body);
      setResult(response);
      setReviewing(false);
      setQuantity("");
      setSource(null);
      setDestination(null);
      setRemarks("");
      setOccurredAt("");
      setReference(newTransactionReference(PREFIX[type]));
      onPosted();
    } catch (error) {
      // The same reference is kept, so retrying after a network error cannot post twice.
      setSubmitError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const types: MovementType[] = [...(canPermission(user, "movements.write") ? ["receipt", "issue", "transfer", "return"] as MovementType[] : []), ...(canAdjust ? ["adjustment"] as MovementType[] : [])];

  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label="Transaction type" className="flex flex-wrap gap-2">
        {types.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={type === option}
            onClick={() => changeType(option)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-blue-600 ${type === option ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}
          >
            {MOVEMENT_LABELS[option]}
          </button>
        ))}
      </div>
      <p className="text-sm text-slate-500">{DESCRIPTIONS[type]}</p>

      {result && (
        <Notice type="success">
          <span className="flex items-center gap-1">
            <CheckCircle2 size={14} aria-hidden="true" />
            {result.idempotent ? "This movement was already posted earlier" : "Movement posted"}: {result.movement.transactionReference} · {MOVEMENT_LABELS[result.movement.movementType]} of {formatNumber(result.movement.quantity)}.
          </span>
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ItemPicker label="Item" required value={item} onChange={changeItem} error={errors.item} />
        <Input label={`Quantity${item?.uom ? ` (${item.uom})` : ""}`} type="number" min={0} step="any" required value={quantity} onChange={(event) => setQuantity(event.target.value)} error={errors.quantity} />
        {type === "adjustment" && (
          <fieldset className="lg:col-span-2">
            <legend className="text-sm font-medium text-slate-700">Adjustment direction</legend>
            <div className="mt-1 flex gap-4 text-sm">
              {(["increase", "decrease"] as const).map((option) => (
                <label key={option} className="flex items-center gap-2">
                  <input type="radio" name="direction" value={option} checked={direction === option} onChange={() => { setDirection(option); setSource(null); setDestination(null); }} />
                  {option === "increase" ? "Increase (found stock)" : "Decrease (missing / damaged stock)"}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>

      {item && needsSource && (
        <SourceBinPicker key={`${item._id}-${type}`} itemId={item._id} value={source} onChange={setSource} error={errors.source} />
      )}
      {item && needsDestination && (
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Destination</p>
          <DestinationBinPicker key={`${item._id}-${type}`} item={item} quantity={amount} value={destination} onChange={setDestination} error={errors.destination} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Input label="Transaction reference" required value={reference} onChange={(event) => setReference(event.target.value)} error={errors.reference} hint="Unique per movement. Reusing a reference never posts stock twice." maxLength={100} />
        <Input label="Transaction date" type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} error={errors.occurredAt} hint="Leave empty to use the current time" />
        <Textarea label="Remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} maxLength={1000} wrapperClassName="lg:col-span-2" placeholder="Job number, supplier, reason for adjustment..." />
      </div>

      <div className="flex justify-end">
        <Button onClick={() => { setResult(null); if (validate()) setReviewing(true); }}>Review movement</Button>
      </div>

      {reviewing && item && (
        <Modal
          open
          onClose={() => !submitting && setReviewing(false)}
          title={`Confirm ${MOVEMENT_LABELS[type].toLowerCase()}`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setReviewing(false)} disabled={submitting}>Back</Button>
              <Button onClick={() => void submit()} disabled={submitting}>{submitting ? "Posting..." : "Post movement"}</Button>
            </>
          }
        >
          <div className="space-y-3">
            {submitError && <Notice>{submitError}</Notice>}
            <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
              <dt className="text-slate-500">Type</dt><dd className="col-span-2 font-medium">{MOVEMENT_LABELS[type]}{type === "adjustment" ? ` (${direction})` : ""}</dd>
              <dt className="text-slate-500">Item</dt><dd className="col-span-2 font-medium">{item.itemCode} · {item.description}</dd>
              <dt className="text-slate-500">Quantity</dt><dd className="col-span-2 font-medium">{formatNumber(amount)} {item.uom}</dd>
              {needsSource && <><dt className="text-slate-500">From</dt><dd className="col-span-2 font-medium">{binLocation(source?.bin)} <span className="text-xs font-normal text-slate-500">({formatNumber(source?.availableQuantity)} available → {formatNumber((source?.availableQuantity || 0) - amount)} after)</span></dd></>}
              {needsDestination && <><dt className="text-slate-500">To</dt><dd className="col-span-2 font-medium">{binLocation(destination)} <span className="text-xs font-normal text-slate-500">{levelPath(destination?.level)}</span></dd></>}
              <dt className="text-slate-500">Reference</dt><dd className="col-span-2 font-mono text-xs">{reference}</dd>
              <dt className="text-slate-500">Date</dt><dd className="col-span-2">{occurredAt ? new Date(occurredAt).toLocaleString() : "Now"}</dd>
              {remarks && <><dt className="text-slate-500">Remarks</dt><dd className="col-span-2">{remarks}</dd></>}
            </dl>
            <p className="text-xs text-slate-500">The server re-checks stock, capacity, and permissions before posting. Inventory and the transaction log are updated together in one database transaction.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

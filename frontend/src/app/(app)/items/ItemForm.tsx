"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import type { Item } from "@/lib/types";
import { Input } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Feedback";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

type ItemFormProps = {
  item: Item | null;
  open: boolean;
  onClose: () => void;
  onSaved: (item: Item) => void;
  options: { itemGroups: string[]; itemTypes: string[]; uoms: string[] };
};

type FormState = {
  itemCode: string;
  description: string;
  itemGroup: string;
  itemType: string;
  uom: string;
  bomType: string;
  minStock: string;
  reorderLevel: string;
  maxStock: string;
};

function toFormState(item: Item | null): FormState {
  return {
    itemCode: item?.itemCode || "",
    description: item?.description || "",
    itemGroup: item?.itemGroup || "",
    itemType: item?.itemType || "",
    uom: item?.uom || "Pieces",
    bomType: item?.bomType || "",
    minStock: String(item?.minStock ?? 0),
    reorderLevel: String(item?.reorderLevel ?? 0),
    maxStock: item?.maxStock === null || item?.maxStock === undefined ? "" : String(item.maxStock),
  };
}

function validate(form: FormState) {
  const errors: Partial<Record<keyof FormState, string>> = {};
  if (!form.itemCode.trim()) errors.itemCode = "Item code is required";
  if (!form.description.trim()) errors.description = "Description is required";
  if (!form.uom.trim()) errors.uom = "Unit of measure is required";
  for (const field of ["minStock", "reorderLevel", "maxStock"] as const) {
    if (form[field] === "" && field === "maxStock") continue;
    const value = Number(form[field]);
    if (form[field] === "" || !Number.isFinite(value) || value < 0) errors[field] = "Enter a number of zero or more";
  }
  if (!errors.maxStock && form.maxStock !== "") {
    if (!errors.minStock && Number(form.minStock) > Number(form.maxStock)) errors.minStock = "Cannot exceed maximum stock";
    if (!errors.reorderLevel && Number(form.reorderLevel) > Number(form.maxStock)) errors.reorderLevel = "Cannot exceed maximum stock";
  }
  return errors;
}

export default function ItemForm({ item, open, onClose, onSaved, options }: ItemFormProps) {
  const [form, setForm] = useState<FormState>(() => toFormState(item));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitError, setSubmitError] = useState("");
  const [saving, setSaving] = useState(false);

  const update = (field: keyof FormState, value: string) => setForm((current) => ({ ...current, [field]: value }));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    setSubmitError("");
    const body = {
      description: form.description.trim(),
      itemGroup: form.itemGroup.trim(),
      itemType: form.itemType.trim(),
      uom: form.uom.trim(),
      bomType: form.bomType.trim(),
      minStock: Number(form.minStock),
      reorderLevel: Number(form.reorderLevel),
      maxStock: form.maxStock === "" ? null : Number(form.maxStock),
    };
    try {
      const result = item
        ? await api.put<{ item: Item }>(`/items/${item._id}`, body)
        : await api.post<{ item: Item }>("/items", { ...body, itemCode: form.itemCode.trim() });
      onSaved(result.item);
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? `Edit ${item.itemCode}` : "New item"}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="item-form" disabled={saving}>{saving ? "Saving..." : item ? "Save changes" : "Create item"}</Button>
        </>
      }
    >
      <form id="item-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        {submitError && <Notice>{submitError}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Item code" required value={form.itemCode} onChange={(event) => update("itemCode", event.target.value)} error={errors.itemCode} disabled={Boolean(item)} hint={item ? "Item codes cannot be changed" : undefined} maxLength={60} />
          <Input label="Unit of measure" required value={form.uom} onChange={(event) => update("uom", event.target.value)} error={errors.uom} list="uom-options" hint="Must match the bin capacity unit for capacity-tracked bins" />
          <Input label="Description" required value={form.description} onChange={(event) => update("description", event.target.value)} error={errors.description} wrapperClassName="sm:col-span-2" maxLength={300} />
          <Input label="Item group" value={form.itemGroup} onChange={(event) => update("itemGroup", event.target.value)} list="group-options" />
          <Input label="Item type" value={form.itemType} onChange={(event) => update("itemType", event.target.value)} list="type-options" />
          <Input label="BOM type" value={form.bomType} onChange={(event) => update("bomType", event.target.value)} />
          <div className="hidden sm:block" />
          <Input label="Minimum stock" type="number" min={0} step="any" required value={form.minStock} onChange={(event) => update("minStock", event.target.value)} error={errors.minStock} />
          <Input label="Reorder level" type="number" min={0} step="any" required value={form.reorderLevel} onChange={(event) => update("reorderLevel", event.target.value)} error={errors.reorderLevel} />
          <Input label="Maximum stock" type="number" min={0} step="any" value={form.maxStock} onChange={(event) => update("maxStock", event.target.value)} error={errors.maxStock} hint="Leave empty for no maximum" />
        </div>
        <datalist id="uom-options">{options.uoms.map((value) => <option key={value} value={value} />)}</datalist>
        <datalist id="group-options">{options.itemGroups.map((value) => <option key={value} value={value} />)}</datalist>
        <datalist id="type-options">{options.itemTypes.map((value) => <option key={value} value={value} />)}</datalist>
      </form>
    </Modal>
  );
}

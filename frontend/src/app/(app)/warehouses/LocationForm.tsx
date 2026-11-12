"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { Input, Select } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Feedback";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import type { LocationConfig } from "./locationConfig";

export type LocationRecord = Record<string, unknown> & { _id: string; isActive: boolean };

type LocationFormProps = {
  config: LocationConfig;
  record: LocationRecord | null;
  parentId: string | null;
  parentLabel: string;
  onClose: () => void;
  onSaved: () => void;
};

function initialValue(record: LocationRecord | null, name: string, type?: string) {
  const value = record?.[name];
  if (type === "list") return Array.isArray(value) ? value.join(", ") : "";
  if (value === null || value === undefined) return name === "binType" ? "Mixed" : "";
  return String(value);
}

export default function LocationForm({ config, record, parentId, parentLabel, onClose, onSaved }: LocationFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(config.fields.map((field) => [field.name, initialValue(record, field.name, field.type)])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const found: Record<string, string> = {};
    for (const field of config.fields) {
      const value = values[field.name].trim();
      if (field.required && !value) found[field.name] = `${field.label} is required`;
      if (field.type === "number" && value && (!Number.isFinite(Number(value)) || Number(value) < (field.name === "levelNumber" ? 1 : 0))) {
        found[field.name] = field.name === "levelNumber" ? "Enter a number of 1 or more" : "Enter a number of zero or more";
      }
    }
    if (config.kind === "bin" && values.capacity.trim() && !values.capacityUnit.trim()) found.capacityUnit = "Capacity unit is required when capacity is set";
    setErrors(found);
    if (Object.keys(found).length) return;

    const body: Record<string, unknown> = {};
    for (const field of config.fields) {
      const value = values[field.name].trim();
      if (field.type === "number") body[field.name] = value === "" ? null : Number(value);
      else if (field.type === "list") body[field.name] = value ? value.split(",").map((entry) => entry.trim()).filter(Boolean) : [];
      else body[field.name] = value;
    }
    if (config.kind === "bin" && body.capacity === null) body.capacityUnit = values.capacityUnit.trim() || null;
    if (!record && config.parentField) body[config.parentField] = parentId;

    setSaving(true);
    setSubmitError("");
    try {
      if (record) await api.put(`${config.basePath}/${record._id}`, body);
      else await api.post(config.basePath, body);
      onSaved();
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={record ? `Edit ${config.label.toLowerCase()}` : `New ${config.label.toLowerCase()}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="location-form" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
        </>
      }
    >
      <form id="location-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        {submitError && <Notice>{submitError}</Notice>}
        {config.parentField && <p className="text-sm text-slate-500">Parent: <span className="font-medium text-slate-800">{parentLabel}</span></p>}
        <div className="grid gap-4 sm:grid-cols-2">
          {config.fields.map((field) =>
            field.type === "select" ? (
              <Select key={field.name} label={field.label} value={values[field.name]} hint={field.hint} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}>
                {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
              </Select>
            ) : (
              <Input
                key={field.name}
                label={field.label}
                type={field.type === "number" ? "number" : "text"}
                step={field.type === "number" ? "any" : undefined}
                min={field.type === "number" ? 0 : undefined}
                required={field.required}
                value={values[field.name]}
                hint={field.hint}
                error={errors[field.name]}
                onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
              />
            ),
          )}
        </div>
      </form>
    </Modal>
  );
}

"use client";

import { useId } from "react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const controlClass =
  "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500 aria-invalid:border-red-400";

type FieldWrapperProps = { id: string; label: string; hint?: string; error?: string; required?: boolean; children: ReactNode; className?: string };

function FieldWrapper({ id, label, hint, error, required, children, className = "" }: FieldWrapperProps) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-600" aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string; wrapperClassName?: string };

export function Input({ label, hint, error, wrapperClassName, className = "", ...props }: InputProps) {
  const id = useId();
  return (
    <FieldWrapper id={id} label={label} hint={hint} error={error} required={props.required} className={wrapperClassName}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={`${controlClass} h-10 ${className}`}
        {...props}
      />
    </FieldWrapper>
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string; error?: string; wrapperClassName?: string };

export function Select({ label, hint, error, wrapperClassName, className = "", children, ...props }: SelectProps) {
  const id = useId();
  return (
    <FieldWrapper id={id} label={label} hint={hint} error={error} required={props.required} className={wrapperClassName}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={`${controlClass} h-10 ${className}`}
        {...props}
      >
        {children}
      </select>
    </FieldWrapper>
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string; error?: string; wrapperClassName?: string };

export function Textarea({ label, hint, error, wrapperClassName, className = "", ...props }: TextareaProps) {
  const id = useId();
  return (
    <FieldWrapper id={id} label={label} hint={hint} error={error} required={props.required} className={wrapperClassName}>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        className={`${controlClass} min-h-20 py-2 ${className}`}
        {...props}
      />
    </FieldWrapper>
  );
}

// Compact search box used in table toolbars.
export function SearchInput({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder?: string; label: string }) {
  return (
    <input
      type="search"
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={`${controlClass} mt-0 h-10 max-w-full sm:w-72`}
    />
  );
}

// Compact select used in table toolbars.
export function FilterSelect({ value, onChange, label, children }: { value: string; onChange: (value: string) => void; label: string; children: ReactNode }) {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className={`${controlClass} mt-0 h-10 sm:w-auto`}>
      {children}
    </select>
  );
}

"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

type ModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg" | "xl";
};

const widths = { md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

// Uses the native <dialog> element: it traps focus, closes on Escape, and restores focus on close.
export default function Modal({ open, title, onClose, children, footer, size = "md" }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="modal-title"
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      className={`m-auto w-[calc(100%-2rem)] ${widths[size]} rounded-xl bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/50`}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <h2 id="modal-title" className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-md p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600">
              <X size={18} />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

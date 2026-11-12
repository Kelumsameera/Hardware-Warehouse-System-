"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, Printer } from "lucide-react";

const COMPANY_NAME = process.env.NEXT_PUBLIC_COMPANY_NAME || "Flexicare";
const COMPANY_TAGLINE = process.env.NEXT_PUBLIC_COMPANY_TAGLINE || "TOTAL QUALITY · TOTAL CARE";

// Company mark for printed forms. Put the real logo at frontend/public/company-logo.png;
// until then the company name is shown as text.
export function CompanyMark() {
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <div className="flex flex-col justify-center">
      {logoFailed ? (
        <>
          <span className="text-2xl font-bold italic leading-none tracking-tight text-[#0b6aa8]">{COMPANY_NAME}</span>
          <span className="mt-0.5 text-[7pt] font-semibold tracking-wide text-slate-600">{COMPANY_TAGLINE}</span>
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- optional static logo supplied by the company
        <img src="/company-logo.png" alt={COMPANY_NAME} className="h-12 w-auto max-w-[45mm] object-contain" onError={() => setLogoFailed(true)} />
      )}
    </div>
  );
}

// Waits for every image in the document before opening the print dialog, so photos are not missing in the PDF.
async function waitForImages(root: HTMLElement | null) {
  const images = Array.from(root?.querySelectorAll("img") || []);
  images.forEach((image) => { image.loading = "eager"; });
  await Promise.race([Promise.all(images.map((image) => (image.complete ? Promise.resolve() : new Promise<void>((resolve) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => resolve(), { once: true });
  })))), new Promise<void>((resolve) => setTimeout(resolve, 10000))]);
}

export function formatPrintDate(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

type DocumentShellProps = {
  title: string;
  backHref: string;
  watermark?: string;
  footer: string;
  defaultLandscape?: boolean;
  children: ReactNode;
};

export default function DocumentShell({ title, backHref, watermark, footer, defaultLandscape = false, children }: DocumentShellProps) {
  const sheet = useRef<HTMLDivElement>(null);
  const [landscape, setLandscape] = useState(defaultLandscape);
  const [preparing, setPreparing] = useState(false);
  const [printedAt, setPrintedAt] = useState("");

  // Covers Ctrl+P / the browser menu as well as the Print button.
  useEffect(() => {
    const stamp = () => setPrintedAt(formatPrintDate(new Date()));
    window.addEventListener("beforeprint", stamp);
    return () => window.removeEventListener("beforeprint", stamp);
  }, []);

  const print = async () => {
    setPreparing(true);
    setPrintedAt(formatPrintDate(new Date()));
    await document.fonts.ready;
    await waitForImages(sheet.current);
    setPreparing(false);
    window.print();
  };

  return (
    <div className="min-h-screen bg-slate-200 print:bg-white">
      <style>{`@page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 10mm; }
        @media print {
          html, body { background: #fff !important; }
          .doc-sheet { width: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; box-shadow: none !important; }
          .doc-table thead { display: table-header-group; }
          .doc-table tr, .doc-block { break-inside: avoid; page-break-inside: avoid; }
          .doc-watermark { position: fixed !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }`}</style>

      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-slate-300 bg-white px-4 py-2 shadow-sm">
        <a href={backHref} className="inline-flex h-9 items-center gap-1 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"><ArrowLeft size={16} /> Back</a>
        <span className="flex-1 truncate text-sm font-semibold text-slate-900">{title}</span>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={landscape} onChange={(event) => setLandscape(event.target.checked)} /> Landscape
        </label>
        <button type="button" onClick={() => void print()} disabled={preparing} className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
          <Printer size={16} /> {preparing ? "Loading images..." : "Print / Save as PDF"}
        </button>
      </div>
      <p className="no-print px-4 pt-3 text-center text-xs text-slate-500">Print preview (A4 {landscape ? "landscape" : "portrait"}). Choose “Save as PDF” as the printer to create a PDF. Printing does not change the request.</p>

      <div
        ref={sheet}
        className="doc-sheet relative mx-auto my-4 bg-white p-[10mm] text-[9.5pt] leading-snug text-black shadow-lg"
        style={{ width: landscape ? "297mm" : "210mm", minHeight: landscape ? "210mm" : "297mm" }}
      >
        {watermark && (
          <div className="doc-watermark pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden" aria-hidden="true">
            <span className="-rotate-30 select-none whitespace-nowrap text-[64pt] font-black tracking-widest text-slate-300/60">{watermark}</span>
          </div>
        )}
        <div className="relative">{children}</div>
        <div className="relative mt-6 flex justify-between border-t border-slate-400 pt-1 text-[7.5pt] text-slate-600">
          <span>{footer}</span>
          <span>{printedAt ? `Printed ${printedAt}` : ""}</span>
        </div>
      </div>
    </div>
  );
}

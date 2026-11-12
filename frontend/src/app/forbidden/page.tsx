import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export const metadata = { title: "Access denied · Engineering WMS" };

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <ShieldAlert size={32} className="mx-auto text-amber-500" aria-hidden="true" />
        <h1 className="mt-3 text-xl font-bold text-slate-900">Access denied</h1>
        <p className="mt-2 text-sm text-slate-500">Your account does not have permission to open this page. Ask a warehouse administrator if you need access.</p>
        <Link href="/" className="mt-5 inline-block text-sm font-medium text-blue-600 hover:underline">Back to dashboard</Link>
      </div>
    </main>
  );
}

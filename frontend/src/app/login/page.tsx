import { Suspense } from "react";
import { Warehouse } from "lucide-react";
import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in · Engineering WMS" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-950 text-white">
            <Warehouse size={24} aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Engineering WMS</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in with your warehouse account</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-4 text-center text-xs text-slate-500">Accounts are created by a warehouse administrator.</p>
      </div>
    </main>
  );
}

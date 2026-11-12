import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-500">The page you requested does not exist.</p>
        <Link href="/" className="mt-5 inline-block text-sm font-medium text-blue-600 hover:underline">Back to dashboard</Link>
      </div>
    </main>
  );
}

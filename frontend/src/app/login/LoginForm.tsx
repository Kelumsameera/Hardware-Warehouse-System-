"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { FormEvent } from "react";
import { Input } from "@/components/ui/Field";
import Button from "@/components/ui/Button";
import { Notice } from "@/components/ui/Feedback";

// Only allow redirects back into this app (blocks "//evil.example" style open redirects).
function safeNextPath(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/login") ? value : "/";
}

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const searchParams = useSearchParams();
  const notice = searchParams.get("expired") ? "Your session has expired. Please sign in again." : "";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wms-request": "1" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Sign in failed");
      // Full navigation so the new session cookie is used for every following request.
      window.location.replace(safeNextPath(searchParams.get("next")));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign in failed");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate={false}>
      {notice && !error && <Notice type="info">{notice}</Notice>}
      {error && <Notice>{error}</Notice>}
      <Input label="Email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
      <Input label="Password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}

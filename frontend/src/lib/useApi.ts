"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "./api";

type Result<T> = { key: string | null; data: T | null; error: string };

// Loads data from a GET endpoint. Pass null to skip loading (e.g. while a filter is incomplete).
// While a new request is in flight the previous data stays visible, so tables do not flash empty.
export function useApi<T>(path: string | null) {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<Result<T>>({ key: null, data: null, error: "" });
  const requestKey = path ? `${path}#${version}` : null;

  useEffect(() => {
    if (!path || !requestKey) return;
    let cancelled = false;
    api
      .get<T>(path)
      .then((data) => {
        if (!cancelled) setResult({ key: requestKey, data, error: "" });
      })
      .catch((reason) => {
        if (!cancelled) setResult((previous) => ({ key: requestKey, data: previous.data, error: errorMessage(reason) }));
      });
    return () => {
      cancelled = true;
    };
  }, [path, requestKey]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  return {
    data: result.data,
    error: result.key === requestKey ? result.error : "",
    loading: Boolean(requestKey) && result.key !== requestKey,
    reload,
  };
}

// Delays a fast-changing value (search boxes) so the API is not called on every keystroke.
export function useDebounced<T>(value: T, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

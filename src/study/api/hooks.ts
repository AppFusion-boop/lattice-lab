import { useState, useEffect, useCallback, useRef } from "react";
import { apiGet, apiPost, ApiError } from "./client";
import type { Job } from "./types";

export function useApi<T>(
  key: string | null,
  fetcher: () => Promise<T>,
): {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  refresh: () => void;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(key !== null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const runFetch = useCallback(async () => {
    if (!key) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetcherRef.current();
      setData(res);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err);
      } else {
        setError(new ApiError(0, "fetch_failed", (err as Error).message || "Unknown error"));
      }
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    runFetch();
  }, [runFetch]);

  return { data, error, loading, refresh: runFetch, setData };
}

export function useJob(
  jobId: string | null,
  onDone?: (job: Job) => void,
): {
  job: Job | null;
  loading: boolean;
  cancel: () => Promise<void>;
  error: ApiError | null;
} {
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState<boolean>(jobId !== null);
  const [error, setError] = useState<ApiError | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setLoading(false);
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const j = await apiGet<Job>(`/jobs/${jobId}`);
        if (!active) return;
        setJob(j);
        if (j.status === "done" || j.status === "failed" || j.status === "cancelled") {
          setLoading(false);
          if (j.status === "done" && onDoneRef.current) {
            onDoneRef.current(j);
          }
          return;
        }
        timer = setTimeout(poll, 1000);
      } catch (err) {
        if (!active) return;
        setLoading(false);
        if (err instanceof ApiError) {
          setError(err);
        }
      }
    }

    setLoading(true);
    poll();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    try {
      const updated = await apiPost<Job>(`/jobs/${jobId}/cancel`);
      setJob(updated);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err);
      }
    }
  }, [jobId]);

  return { job, loading, cancel, error };
}

export function useServerHealth(): {
  isOnline: boolean | null;
  checking: boolean;
  recheck: () => void;
} {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [checking, setChecking] = useState<boolean>(true);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const res = await apiGet<{ status: string }>("/health");
      setIsOnline(res && res.status === "ok");
    } catch {
      setIsOnline(false);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return { isOnline, checking, recheck: check };
}

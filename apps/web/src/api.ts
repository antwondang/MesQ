import { useEffect, useState } from 'react';

export function createRequestKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const deadline = AbortSignal.timeout(15000);
  const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  const response = await fetch(url, { ...init, signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? 'The request could not be completed.');
  return body as T;
}
export function usePoll<T>(url: string | null, refresh = 0) {
  const [state, setState] = useState<{ url: string | null; value?: T; error?: string; loading: boolean }>({
    url: null,
    loading: true,
  });
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const value = await fetchJson<T>(url!, { signal: controller.signal });
        if (live) setState({ url, value, loading: false });
      } catch (error) {
        if (live)
          setState((previous) => ({
            url,
            value: previous.url === url ? previous.value : undefined,
            loading: false,
            error: error instanceof Error ? error.message : 'Connection unavailable.',
          }));
      } finally {
        if (live)
          timer = setTimeout(() => {
            void poll();
          }, 2000);
      }
    }
    void poll();
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [url, refresh]);
  if (state.url !== url) return { value: undefined, error: undefined, loading: Boolean(url) };
  return state;
}
export function useDebounced(value: string, delay = 250) {
  const [result, setResult] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setResult(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return result;
}
export function duration(ms: number | null | undefined) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60000).toFixed(1)} min`;
}
export function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

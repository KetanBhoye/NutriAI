import { useCallback, useEffect, useRef, useState } from 'react';
import { cached, readCache } from './cache';

/**
 * Stale-while-revalidate for a GET.
 *
 * Screens used to fetch from empty on every mount, so switching tabs meant a
 * spinner and a layout jump even though the data was seconds old. This paints
 * the last good payload immediately, then refreshes in the background and
 * swaps it in.
 *
 * `stale` is true when the network failed and what's on screen came from the
 * cache — screens surface that rather than silently showing old numbers as if
 * they were current.
 */
export interface CachedResource<T> {
  data: T | null;
  /** Only true when there is nothing at all to show yet. */
  loading: boolean;
  /** A refresh is in flight over data already on screen. */
  refreshing: boolean;
  /** Showing cached data because the last fetch failed. */
  stale: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useCachedResource<T>(
  key: string,
  fetcher: () => Promise<T>,
  { errorMessage = "Couldn't load that." }: { errorMessage?: string } = {}
): CachedResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the latest fetcher without making it a dependency — callers usually
  // pass an inline closure, which would otherwise re-run this every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (isRefresh: boolean) => {
      if (isRefresh) setRefreshing(true);
      setError(null);
      try {
        const res = await cached(key, () => fetcherRef.current());
        if (!mounted.current) return;
        setData(res.data);
        setStale(res.stale);
      } catch {
        if (!mounted.current) return;
        setError(errorMessage);
      } finally {
        if (mounted.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [key, errorMessage]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Paint whatever we already have before the request even starts.
      const seed = await readCache<T>(key);
      if (!cancelled && seed !== null) {
        setData(seed);
        setLoading(false);
      }
      if (!cancelled) await load(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [key, load]);

  // Stable so callers can use it as an effect dependency without re-running.
  const refresh = useCallback(() => load(true), [load]);

  return { data, loading, refreshing, stale, error, refresh };
}

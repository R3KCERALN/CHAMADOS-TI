'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
const StockCountContext = createContext<number | null>(null);
export const useStockCount = (initialCount: number) =>
  useContext(StockCountContext) ?? initialCount;
export function StockCountProvider({
  initialCount,
  enabled,
  children,
}: {
  initialCount: number;
  enabled: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [count, setCount] = useState(initialCount);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/estoque/resumo', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) return;
        const result: unknown = await response.json();
        if (
          typeof result === 'object' &&
          result !== null &&
          'count' in result &&
          typeof result.count === 'number' &&
          Number.isSafeInteger(result.count) &&
          result.count >= 0 &&
          !controller.signal.aborted
        )
          setCount(result.count);
      } catch {
        /* Keep the last known count; the next navigation retries. */
      }
    })();
    return () => controller.abort();
  }, [pathname, search, enabled, initialCount]);
  return (
    <StockCountContext.Provider value={enabled ? count : 0}>{children}</StockCountContext.Provider>
  );
}

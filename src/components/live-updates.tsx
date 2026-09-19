'use client';
import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function LiveUpdates({ initialRevision }: { initialRevision: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [pending, startTransition] = useTransition();
  const [offline, setOffline] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [manual, setManual] = useState(0);
  useEffect(() => {
    let stopped = false,
      dirty = false,
      pauseUntil = 0,
      last = initialRevision,
      failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const onInput = (event: Event) => {
      if ((event.target as HTMLElement).closest('form')) dirty = true;
    };
    const onSubmit = () => {
      dirty = false;
      pauseUntil = Date.now() + 3000;
    };
    const poll = async () => {
      clearTimeout(timer);
      if (stopped || document.hidden || controller) return;
      const requestController = new AbortController();
      controller = requestController;
      const timeout = setTimeout(() => requestController.abort(), 10000);
      try {
        const response = await fetch('/api/operacao/revisao', {
          cache: 'no-store',
          signal: requestController.signal,
        });
        if ([401, 403].includes(response.status)) {
          stopped = true;
          startTransition(() => router.refresh());
          return;
        }
        if (!response.ok) throw new Error('Atualização indisponível');
        const { revision } = await response.json();
        if (stopped) return;
        setOffline(false);
        failures = 0;
        if (revision !== last) {
          const focused = document.activeElement?.matches(
            'input, textarea, select, [contenteditable="true"]',
          );
          if (dirty || focused || Date.now() < pauseUntil) setWaiting(true);
          else {
            last = revision;
            setWaiting(false);
            startTransition(() => router.refresh());
          }
        }
      } catch {
        if (!stopped) {
          setOffline(true);
          failures++;
        }
      } finally {
        clearTimeout(timeout);
        controller = undefined;
        if (!stopped && !document.hidden)
          timer = setTimeout(poll, Math.min(30000, 5000 * 2 ** failures));
      }
    };
    const onVisible = () => {
      if (!document.hidden) void poll();
      else controller?.abort();
    };
    document.addEventListener('input', onInput);
    document.addEventListener('change', onInput);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('input', onInput);
      document.removeEventListener('change', onInput);
      document.removeEventListener('submit', onSubmit);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [initialRevision, pathname, search, router, manual]);
  return (
    <div className="live-status" aria-live="polite">
      {offline
        ? 'Reconectando atualizações…'
        : pending
          ? 'Atualizando…'
          : waiting
            ? 'Há atualizações disponíveis.'
            : 'Atualização automática ativa'}
      {waiting && (
        <button type="button" className="text-link" onClick={() => setManual((n) => n + 1)}>
          Atualizar dados
        </button>
      )}
    </div>
  );
}

'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
export function OffTicketUseForm({ itemId, requestId }: { itemId: string; requestId: string }) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="form-stack"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy.current) return;
        busy.current = true;
        setPending(true);
        setError('');
        const form = new FormData(event.currentTarget);
        try {
          const response = await fetch('/api/estoque/uso-avulso', { method: 'POST', body: form });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Não foi possível registrar.');
          router.push('/estoque?aba=materiais');
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Não foi possível registrar. Tente novamente.');
        } finally {
          busy.current = false;
          setPending(false);
        }
      }}
    >
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="requestId" value={requestId} />
      <label>
        Quantidade
        <input name="quantity" inputMode="decimal" required />
      </label>
      <label>
        Observação
        <textarea name="note" maxLength={500} />
      </label>
      <label>
        Foto da autorização
        <input
          type="file"
          name="photo"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          required
        />
      </label>
      <p>JPEG, PNG ou WebP, até 5 MB.</p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary" disabled={pending}>
        {pending ? 'Enviando…' : 'Registrar uso'}
      </button>
    </form>
  );
}

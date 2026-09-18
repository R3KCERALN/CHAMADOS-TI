'use client';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { FormState } from '@/app/actions';
export function Submit({
  children,
  className = 'button primary',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? 'Aguarde…' : children}
    </button>
  );
}
export function ActionForm({
  action,
  children,
  className = 'form-stack',
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={className}>
      {children}
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="notice success" role="status">
          {state.success}
        </p>
      )}
    </form>
  );
}

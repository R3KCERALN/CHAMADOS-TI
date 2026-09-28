'use client';
import { createContext, useActionState, useContext, useEffect, useId, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import type { FormState } from '@/app/actions';

const FormErrorsContext = createContext<Record<string, string[]>>({});

export function FieldError({ name, id }: { name: string; id?: string }) {
  const errors = useContext(FormErrorsContext)[name];
  const generatedId = useId();
  if (!errors?.length) return null;
  return (
    <p id={id || generatedId} className="field-error" role="alert">
      {errors[0]}
    </p>
  );
}
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
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const submittedValuesRef = useRef<Map<string, string[]>>(new Map());
  const summaryId = useId();
  useEffect(() => {
    if (!state.error) return;
    const form = formRef.current;
    if (form) {
      for (const control of Array.from(form.elements)) {
        if (
          !(
            control instanceof HTMLInputElement ||
            control instanceof HTMLSelectElement ||
            control instanceof HTMLTextAreaElement
          ) ||
          !control.name
        )
          continue;
        const values = submittedValuesRef.current.get(control.name) || [];
        if (control instanceof HTMLInputElement && ['checkbox', 'radio'].includes(control.type))
          control.checked = values.includes(control.value);
        else if (!(control instanceof HTMLInputElement && control.type === 'file'))
          control.value = values.at(-1) || '';
        control.removeAttribute('aria-invalid');
      }
      for (const name of Object.keys(state.fieldErrors || {})) {
        const controls = form.querySelectorAll<HTMLElement>(`[name="${CSS.escape(name)}"]`);
        controls.forEach((control) => control.setAttribute('aria-invalid', 'true'));
      }
    }
    summaryRef.current?.focus();
  }, [state.error, state.fieldErrors]);
  const fieldErrors = state.fieldErrors || {};
  return (
    <form
      action={formAction}
      className={className}
      ref={formRef}
      onSubmit={(event) => {
        const values = new Map<string, string[]>();
        for (const [name, rawValue] of new FormData(event.currentTarget)) {
          if (typeof rawValue !== 'string') continue;
          const current = values.get(name) || [];
          current.push(rawValue);
          values.set(name, current);
        }
        submittedValuesRef.current = values;
      }}
    >
      {state.error && (
        <div
          className="notice error error-summary"
          role="alert"
          tabIndex={-1}
          ref={summaryRef}
          aria-labelledby={summaryId}
        >
          <strong id={summaryId}>{state.error}</strong>
          {Object.entries(fieldErrors).length > 0 && (
            <ul>
              {Object.entries(fieldErrors).map(([name, errors]) => (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => {
                      const control = summaryRef.current?.closest('form')?.elements.namedItem(name);
                      if (control instanceof HTMLElement) control.focus();
                      else if (control instanceof RadioNodeList) {
                        const first = control.item(0);
                        if (first instanceof HTMLElement) first.focus();
                      }
                    }}
                  >
                    {errors[0]}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <FormErrorsContext.Provider value={fieldErrors}>{children}</FormErrorsContext.Provider>
      {state.success && (
        <p className="notice success" role="status">
          {state.success}
        </p>
      )}
    </form>
  );
}

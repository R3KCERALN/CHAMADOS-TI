import { ActionForm, Submit } from './form';
import { createTicketAction } from '@/app/actions';
import { impactLabels } from '@/lib/labels';
export function TicketForm({
  children,
  quick = false,
}: {
  children?: React.ReactNode;
  quick?: boolean;
}) {
  return (
    <ActionForm action={createTicketAction}>
      {children}
      <div className="field">
        <label htmlFor="description">
          {quick ? 'O que está sendo atendido?' : 'O que aconteceu?'}
        </label>
        <textarea
          id="description"
          name="description"
          minLength={5}
          maxLength={5000}
          rows={quick ? 3 : 5}
          placeholder="Conte brevemente o que você precisa. Não é necessário usar termos técnicos."
          required
        />
        <p className="field-hint">Evite incluir senhas ou informações confidenciais.</p>
      </div>
      {quick ? (
        <div className="field">
          <label htmlFor="quick-impact">Impacto do atendimento</label>
          <select id="quick-impact" name="impact" defaultValue="BAIXO" required>
            {Object.entries(impactLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <fieldset>
          <legend>Como isso afeta seu trabalho?</legend>
          <div className="impact-options">
            {Object.entries(impactLabels).map(([key, label]) => (
              <label key={key} className="impact-option">
                <input type="radio" name="impact" value={key} required />
                <span>
                  <strong>
                    {key === 'BLOQUEADO'
                      ? 'Estou bloqueado'
                      : key === 'PARCIAL'
                        ? 'Está atrapalhando'
                        : 'Posso continuar'}
                  </strong>
                  <small>{label}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="form-end">
        <p className="muted small">
          {quick
            ? 'Você será o responsável e o atendimento começa agora.'
            : 'O TI receberá seu chamado. Você acompanha tudo por aqui.'}
        </p>
        <Submit>{quick ? 'Iniciar atendimento' : 'Enviar chamado'}</Submit>
      </div>
    </ActionForm>
  );
}

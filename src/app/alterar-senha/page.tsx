import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { passwordAction, logoutAction } from '@/app/actions';
import { ActionForm, Submit } from '@/components/form';
import { Brand } from '@/components/shell';
export default async function PasswordPage() {
  const user = await requireUser(undefined, true);
  return (
    <main id="main" className="standalone">
      <Brand />
      <section className="panel password-panel">
        <span className="eyebrow">SEGURANÇA DA CONTA</span>
        <h1>{user.mustChangePassword ? 'Crie sua própria senha' : 'Alterar senha'}</h1>
        <p className="muted">
          Olá, {user.name.split(' ')[0]}.{' '}
          {user.mustChangePassword
            ? 'Antes de continuar, substitua sua senha temporária.'
            : 'Use uma senha longa e exclusiva para esta conta.'}
        </p>
        <ActionForm action={passwordAction}>
          <div className="field">
            <label htmlFor="currentPassword">Senha atual</label>
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Nova senha</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
            <p className="field-hint">Pelo menos 12 caracteres. Você precisará entrar novamente.</p>
          </div>
          <div className="field">
            <label htmlFor="confirmation">Confirme a nova senha</label>
            <input
              id="confirmation"
              name="confirmation"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
          </div>
          <Submit>Salvar nova senha</Submit>
        </ActionForm>
        {!user.mustChangePassword && (
          <Link href="/" className="text-link">
            Voltar ao início
          </Link>
        )}
        <form action={logoutAction}>
          <Submit className="button subtle">Sair desta conta</Submit>
        </form>
      </section>
    </main>
  );
}

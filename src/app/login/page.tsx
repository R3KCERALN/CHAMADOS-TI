import { ticketReturnTo } from '@/lib/return-to';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ActionForm, Submit } from '@/components/form';
import { loginAction } from '@/app/actions';
import { getSessionUser } from '@/lib/auth-service';
import { SESSION_COOKIE } from '@/lib/auth';
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ alterada?: string; next?: string }>;
}) {
  const user = await getSessionUser((await cookies()).get(SESSION_COOKIE)?.value);
  const params = await searchParams;
  const destination = ticketReturnTo(params.next);
  if (user)
    redirect(
      user.mustChangePassword
        ? `/alterar-senha?next=${encodeURIComponent(destination)}`
        : destination,
    );
  return (
    <main id="main" className="simple-login">
      <section className="simple-login-card" aria-labelledby="login-title">
        <h1 id="login-title">Central de Suporte</h1>
        {params.alterada && (
          <p role="status" className="notice success">
            Senha alterada. Entre com sua nova senha.
          </p>
        )}
        <ActionForm action={loginAction}>
          <input type="hidden" name="next" value={destination} />
          <div className="field">
            <label htmlFor="username">Usuário</label>
            <input
              id="username"
              name="username"
              placeholder="seu.usuario"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              minLength={3}
              maxLength={40}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </div>
          <Submit>Entrar</Submit>
        </ActionForm>
        <p className="muted small login-internal">Uso interno</p>
      </section>
    </main>
  );
}

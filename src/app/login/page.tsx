import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ArrowRight, ShieldCheck, MessageSquareText, Check } from 'lucide-react';
import { Brand } from '@/components/shell';
import { ActionForm, Submit } from '@/components/form';
import { loginAction } from '@/app/actions';
import { getSessionUser } from '@/lib/auth-service';
import { SESSION_COOKIE } from '@/lib/auth';
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ alterada?: string }>;
}) {
  const user = await getSessionUser((await cookies()).get(SESSION_COOKIE)?.value);
  if (user) redirect(user.mustChangePassword ? '/alterar-senha' : '/');
  const params = await searchParams;
  return (
    <main id="main" className="login-page">
      <section className="login-story">
        <Brand />
        <div className="login-message">
          <span className="eyebrow light">MENOS BARREIRAS. MAIS APOIO.</span>
          <h1>
            O suporte que <br />
            move seu dia.
          </h1>
          <p>Um lugar para pedir ajuda, acompanhar a solução e seguir em frente.</p>
          <div className="story-line">
            <span>
              <MessageSquareText size={19} />
            </span>
            Conte o que precisa.
          </div>
          <div className="story-line">
            <span>
              <Check size={19} />
            </span>
            A gente cuida do próximo passo.
          </div>
        </div>
        <span className="login-footnote">Pessoas conectadas. Problemas resolvidos.</span>
      </section>
      <section className="login-form-area">
        <div className="login-card">
          <span className="eyebrow">SEU ESPAÇO DE TRABALHO</span>
          <h2>Bem-vindo de volta.</h2>
          <p className="muted">Entre com seu usuário corporativo para continuar.</p>
          {params.alterada && (
            <p role="status" className="notice success">
              Senha alterada. Entre com sua nova senha.
            </p>
          )}
          <ActionForm action={loginAction}>
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
            <Submit>
              Entrar na Central <ArrowRight size={18} />
            </Submit>
          </ActionForm>
          <p className="login-help">
            Precisa de acesso ou esqueceu sua senha?
            <br />
            <strong>Entre em contato com o administrador de TI.</strong>
          </p>
          <p className="secure-label">
            <ShieldCheck size={16} /> Acesso exclusivo para colaboradores
          </p>
        </div>
      </section>
    </main>
  );
}

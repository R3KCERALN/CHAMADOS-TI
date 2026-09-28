import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { locationOptions } from '@/lib/organization-service';
import { publicUserSelect } from '@/lib/auth-service';
import { ActionForm, FieldError, Submit } from '@/components/form';
import { UserFields } from '@/components/user-fields';
import { updateUserAction, resetPasswordAction } from '@/app/actions';
export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  if (actor.role !== 'ADMIN') notFound();
  const { id } = await params;
  const [user, departments] = await Promise.all([
    db.user.findUnique({
      where: { id, organizationId: actor.organizationId },
      select: { ...publicUserSelect, companyAccess: true, unitAccess: true },
    }),
    db.department.findMany({
      where: { active: true, organizationId: actor.organizationId },
      orderBy: { name: 'asc' },
    }),
  ]);
  if (!user) notFound();
  const companies = await locationOptions(actor.id, false);
  return (
    <div className="narrow">
      <Link className="back-link" href="/admin/usuarios">
        <ArrowLeft size={17} />
        Voltar aos usuários
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRAÇÃO</span>
          <h1>{user.name}</h1>
          <p>Atualize os dados e gerencie o acesso.</p>
        </div>
      </div>
      <section className="panel padded">
        <ActionForm action={updateUserAction}>
          <input type="hidden" name="id" value={id} />
          <UserFields companies={companies} departments={departments} user={user} />
          <Submit>Salvar alterações</Submit>
        </ActionForm>
      </section>
      <section className="panel padded reset-panel">
        <h2>Redefinir senha</h2>
        <p className="muted small">
          As sessões existentes serão encerradas. A pessoa deverá criar uma nova senha ao entrar.
        </p>
        <ActionForm action={resetPasswordAction}>
          <input type="hidden" name="id" value={id} />
          <div className="field">
            <label htmlFor="temporaryPassword">Nova senha temporária</label>
            <input
              id="temporaryPassword"
              name="password"
              type="password"
              minLength={6}
              maxLength={128}
              autoComplete="new-password"
              aria-describedby="temporaryPassword-hint password-error"
              required
            />
            <p id="temporaryPassword-hint" className="field-hint">
              Use pelo menos 6 caracteres. A troca será obrigatória no próximo login.
            </p>
            <FieldError name="password" id="password-error" />
          </div>
          <Submit className="button secondary">Redefinir senha</Submit>
        </ActionForm>
      </section>
    </div>
  );
}
